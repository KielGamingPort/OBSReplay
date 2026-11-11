const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(require('node:path').join(__dirname, '../public/index.html'), 'utf8');

for (const staleFailure of [false, true]) {
    test(`duration refresh ignores stale ${staleFailure ? 'failures' : 'successes'} after reset`, async () => {
        const requests = [];
        const display = { content: '', get innerHTML() { return this.content; }, set innerHTML(value) { this.content = value; }, get textContent() { return this.content; }, set textContent(value) { this.content = value; } };
        const context = vm.createContext({
            document: { getElementById: () => display },
            fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject }))
        });
        vm.runInContext(html.match(/        let durationRequestGeneration[\s\S]*?(?=        socket.on\('clip_durations_changed')/)[0], context);
        const older = vm.runInContext('loadClipDurations()', context);
        const newer = vm.runInContext('loadClipDurations()', context);
        requests[1].resolve({ ok: true, json: async () => ({ round: 0, match: 3661 }) });
        await newer;
        const newest = '<span>Runde<strong>0:00:00</strong></span><span>Map<strong>0:00:00</strong></span><span>Match<strong>1:01:01</strong></span>';
        assert.equal(display.innerHTML, newest);
        if (staleFailure) requests[0].reject(new Error('old failure'));
        else requests[0].resolve({ ok: true, json: async () => ({ round: 10, match: 20 }) });
        await older;
        assert.equal(display.innerHTML, newest);
        const failed = vm.runInContext('loadClipDurations()', context);
        requests[2].resolve({ ok: false });
        await failed;
        assert.equal(display.textContent, 'Cliplängen nicht verfügbar');
    });
}

for (const scenario of [
    { name: 'local or existing session', status: 204, prompts: 0, connections: 1 },
    { name: 'remote client without a session', status: 401, prompts: 1, connections: 1 },
    { name: 'unavailable authentication endpoint', status: 500, prompts: 0, connections: 0 }
]) {
    test(`dashboard authentication handles ${scenario.name}`, async () => {
        let prompts = 0;
        let connections = 0;
        let loads = 0;
        const requests = [];
        const context = vm.createContext({
            fetch: async (url, options) => {
                requests.push({ url, options });
                if (url === '/api/match') return { ok: true, json: async () => ({ match: null, map: 1 }) };
                return options ? { ok: true, status: 204 } : {
                    ok: scenario.status === 204, status: scenario.status
                };
            },
            sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
            requestAccessToken: async () => { prompts++; return 'test-token'; },
            document: { getElementById: () => ({ hidden: true }) },
            socket: { connect: () => { connections++; } },
            loadClipList: async () => { loads++; },
            showMatch() {},
            logMessage() {},
            loadClipDurations: async () => {}
        });
        vm.runInContext(html.match(/        async function authenticate\(\)[\s\S]*?(?=        \/\/)/)[0], context);
        const result = vm.runInContext('authenticate()', context);
        if (scenario.status === 500) await assert.rejects(result, /Authentifizierung fehlgeschlagen/);
        else await result;
        assert.equal(prompts, scenario.prompts);
        assert.equal(connections, scenario.connections);
        assert.equal(loads, 0, 'state loads when the socket connects, including reconnects');
        assert.equal(requests.length, scenario.prompts + 1);
        if (scenario.prompts) {
            assert.equal(requests[1].options.method, 'POST');
            assert.deepEqual(JSON.parse(requests[1].options.body), { token: 'test-token' });
        }
    });
}

test('rollback add events do not duplicate clips or change the selected video', () => {
    const children = [];
    const handlers = {};
    let loads = 0;
    const context = vm.createContext({
        clipList: { children, prepend: node => children.unshift(node), append: node => children.push(node) },
        document: { createElement: () => ({ dataset: {}, append() {}, setAttribute() {} }) },
        socket: { on: (name, handler) => { handlers[name] = handler; } },
        logMessage() {},
        updateClipCount() {},
        loadClipList: async () => {},
        loadVideo() { loads++; }
    });
    vm.runInContext(html.match(/        function addClipToList\([\s\S]*?(?=        function loadVideo)/)[0], context);
    vm.runInContext(html.match(/        socket.on\('new_replay_available',[\s\S]*?\n        \}\);/)[0], context);
    vm.runInContext("addClipToList('existing.mp4')", context);
    handlers.new_replay_available('existing.mp4');
    assert.equal(children.length, 1);
    assert.equal(loads, 0);
    handlers.new_replay_available('new.mp4');
    assert.equal(children.length, 2);
    assert.equal(loads, 1);
});

test('dashboard displays replay save failures', () => {
    let handler;
    let message;
    vm.runInNewContext(html.match(/        socket.on\('replay_error'[^\n]*/)[0], {
        socket: { on: (_name, callback) => { handler = callback; } },
        logMessage: value => { message = value; }
    });
    handler('SaveReplayBuffer failed');
    assert.match(message, /SaveReplayBuffer failed/);
});

function trimContext() {
    const nodes = new Map();
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { textContent: '', classList: { toggle() {} }, style: { setProperty() {} }, setAttribute() {} });
        return nodes.get(id);
    };
    const cuts = [{}, {}, {}];
    const sessions = [{}, {}];
    const sent = [];
    const context = vm.createContext({
        currentFileName: null, player: { readyState: 0, duration: NaN, currentTime: 0 },
        inTime: 0, outTime: null, sessionBusy: false, captureBusy: false, cutPending: false,
        obsConnected: false, matchState: { match: null },
        socket: { connected: true, emit: (...args) => sent.push(args) },
        document: { getElementById: node, querySelectorAll: selector => selector === '[data-cut-target]' ? cuts : sessions },
        notify() {}
    });
    vm.runInContext(html.match(/        function clipReady\([\s\S]*?(?=        player.addEventListener)/)[0], context);
    vm.runInContext(html.match(/        function setIn\([\s\S]*?(?=        socket.on\('cut_success')/)[0], context);
    return { context, node, cuts, sent };
}

test('trim controls require media metadata and recover from an invalid range', () => {
    const { context, node, cuts } = trimContext();
    vm.runInContext('updateControls()', context);
    assert.equal(node('trim-fields').disabled, true);
    assert.ok(cuts.every(button => button.disabled));
    vm.runInContext("currentFileName = 'clip.mp4'; player.readyState = 1; player.duration = 12; updateControls()", context);
    assert.equal(node('trim-fields').disabled, false);
    assert.ok(cuts.every(button => !button.disabled));
    vm.runInContext('player.currentTime = 0; setOut()', context);
    assert.ok(cuts.every(button => button.disabled), 'explicit OUT at zero is an invalid range, not the end sentinel');
    vm.runInContext('resetMarks()', context);
    assert.ok(cuts.every(button => !button.disabled));
    assert.match(node('selection-status').textContent, /12.00/);
});

test('cut submission snapshots the current end without replacing the end sentinel and prevents duplicates', () => {
    const { context, sent } = trimContext();
    vm.runInContext("currentFileName = 'clip.mp4'; player.readyState = 1; player.duration = 12; cutVideo('map'); cutVideo('map')", context);
    assert.equal(sent.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), ['cut_video', { fileName: 'clip.mp4', inTime: 0, outTime: 12, target: 'map' }]);
    assert.equal(vm.runInContext('outTime', context), null);
});

test('clip pagination reveals Companion selection and keeps every clip reachable without scrolling', () => {
    const items = Array.from({ length: 15 }, (_, index) => ({ dataset: { fileName: `${index}.mp4` }, hidden: false }));
    const nodes = {};
    const context = vm.createContext({
        clipList: { clientHeight: 250, querySelectorAll: () => items },
        currentFileName: null,
        document: { getElementById: id => nodes[id] ||= {} },
        ResizeObserver: class { observe() {} },
        window: { addEventListener() {} }
    });
    vm.runInContext(html.match(/        let clipPage = 0;[\s\S]*?(?=        function addClipToList)/)[0], context);
    vm.runInContext('renderClipPage()', context);
    assert.equal(nodes['clip-page'].textContent, '1–4 / 15');
    vm.runInContext('changeClipPage(1)', context);
    assert.equal(nodes['clip-page'].textContent, '5–8 / 15');
    vm.runInContext("renderClipPage('14.mp4')", context);
    assert.equal(nodes['clip-page'].textContent, '13–15 / 15');
    assert.equal(items[14].hidden, false);
    assert.equal(nodes['clips-next-page'].disabled, true);
    context.clipList.clientHeight = 130;
    vm.runInContext("renderClipPage('14.mp4')", context);
    assert.equal(items[14].hidden, false);
    assert.equal(nodes['clip-page'].textContent, '15 / 15');
});

test('Companion loads the only unselected clip and then avoids reloading its draft', () => {
    let clicks = 0;
    let active = false;
    const context = vm.createContext({ document: { querySelectorAll: () => [{ classList: { contains: () => active }, click() { clicks++; active = true; } }] } });
    vm.runInContext(html.match(/        function selectNextClip\([\s\S]*?(?=        \/\/ --- DYNAMISCHES)/)[0], context);
    vm.runInContext('selectNextClip(); selectPrevClip()', context);
    assert.equal(clicks, 1);
});

test('every socket connection, including reconnect, reloads dashboard state', () => {
    let handler;
    let reloads = 0;
    vm.runInNewContext(html.match(/        socket.on\('connect', \(\) => \{ const badge[^\n]*/)[0], {
        socket: { on: (_name, callback) => { handler = callback; } },
        document: { getElementById: () => ({ classList: { add() {} } }) },
        updateControls() {}, synchronizeDashboard() { reloads++; }
    });
    handler(); handler();
    assert.equal(reloads, 2);
});

test('library reconciliation ignores old responses and removes an archived selected clip', async () => {
    const requests = [];
    let cleared = 0;
    const list = { innerHTML: 'old', querySelectorAll: () => [] };
    const context = vm.createContext({
        fetch: () => new Promise(resolve => requests.push(resolve)),
        currentFileName: 'old.mp4', clipDrafts: new Map([['old.mp4', {}]]), clipList: list,
        clearPlayer() { context.currentFileName = null; cleared++; },
        addClipToList: () => assert.fail('stale response must not repopulate archived clips'),
        updateClipCount() {}
    });
    vm.runInContext(html.match(/        let libraryRequestGeneration = 0;[\s\S]*?(?=        async function synchronizeDashboard)/)[0], context);
    const old = vm.runInContext('loadClipList()', context);
    const fresh = vm.runInContext('loadClipList()', context);
    requests[1]({ ok: true, json: async () => [] });
    await fresh;
    requests[0]({ ok: true, json: async () => [{ name: 'old.mp4', modifiedAt: 1 }] });
    await old;
    assert.equal(cleared, 1);
    assert.equal(context.currentFileName, null);
    assert.equal(context.clipDrafts.size, 0);
    assert.match(list.innerHTML, /Keine Clips/);
});

test('switching clips restores independent trim drafts and selecting the same clip does not reload media', () => {
    const nodes = {};
    let loads = 0;
    const player = { currentTime: 4, src: '/raw_videos/a.mp4', pause() {}, removeAttribute() { this.src = ''; }, getAttribute() { return this.src; }, load() { loads++; } };
    const context = vm.createContext({
        player, currentFileName: 'a.mp4', inTime: 2, outTime: 6, previewingSelection: false,
        clipDrafts: new Map(), pendingClipPosition: null,
        stopSeek() {}, updateControls() {}, renderClipPage() {},
        document: { getElementById: id => nodes[id] ||= {}, querySelectorAll: () => [] }
    });
    vm.runInContext(html.match(/        function loadVideo\([\s\S]*?(?=        function clearPlayer)/)[0], context);
    vm.runInContext("loadVideo('b.mp4'); inTime = 1; outTime = 3; player.currentTime = 2; loadVideo('a.mp4')", context);
    assert.equal(context.inTime, 2);
    assert.equal(context.outTime, 6);
    assert.equal(context.pendingClipPosition, 4);
    const previousLoads = loads;
    vm.runInContext("loadVideo('a.mp4')", context);
    assert.equal(loads, previousLoads);
});
