const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(require('node:path').join(__dirname, '../public/index.html'), 'utf8');

for (const staleFailure of [false, true]) {
    test(`duration refresh ignores stale ${staleFailure ? 'failures' : 'successes'} after reset`, async () => {
        const requests = [];
        const display = { textContent: '' };
        const context = vm.createContext({
            document: { getElementById: () => display },
            fetch: () => new Promise((resolve, reject) => requests.push({ resolve, reject }))
        });
        vm.runInContext(html.match(/        let durationRequestGeneration[\s\S]*?(?=        socket.on\('clip_durations_changed')/)[0], context);
        const older = vm.runInContext('loadClipDurations()', context);
        const newer = vm.runInContext('loadClipDurations()', context);
        requests[1].resolve({ ok: true, json: async () => ({ round: 0, match: 3661 }) });
        await newer;
        assert.equal(display.textContent, 'Runde: 0:00:00 · Match: 1:01:01');
        if (staleFailure) requests[0].reject(new Error('old failure'));
        else requests[0].resolve({ ok: true, json: async () => ({ round: 10, match: 20 }) });
        await older;
        assert.equal(display.textContent, 'Runde: 0:00:00 · Match: 1:01:01');
        const failed = vm.runInContext('loadClipDurations()', context);
        requests[2].resolve({ ok: false });
        await failed;
        assert.equal(display.textContent, 'Cliplängen nicht verfügbar');
    });
}

test('rollback add events do not duplicate clips or change the selected video', () => {
    const children = [];
    const handlers = {};
    let loads = 0;
    const context = vm.createContext({
        clipList: { children, prepend: node => children.unshift(node), append: node => children.push(node) },
        document: { createElement: () => ({ dataset: {} }) },
        socket: { on: (name, handler) => { handlers[name] = handler; } },
        logMessage() {},
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
