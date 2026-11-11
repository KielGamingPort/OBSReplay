const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRemoteControl } = require('../lib/remote-control');

function panel(id) {
    const handlers = {};
    const events = [];
    return { id, handlers, events, on: (name, callback) => { handlers[name] = callback; }, emit: (...event) => events.push(event) };
}

test('Companion commands reach exactly one panel, support takeover and fail over after disconnect', () => {
    const control = createRemoteControl();
    assert.equal(control.dispatch('cut-map'), false);
    const first = panel('first');
    const second = panel('second');
    control.add(first); control.add(second);
    control.dispatch('cut-map');
    assert.equal(first.events.filter(([name]) => name === 'remote_command').length, 1);
    assert.equal(second.events.filter(([name]) => name === 'remote_command').length, 0);
    second.handlers.claim_remote_control();
    control.dispatch('set-in');
    assert.deepEqual(second.events.at(-1), ['remote_command', 'set-in']);
    second.handlers.disconnect();
    control.dispatch('cut-match');
    assert.deepEqual(first.events.at(-1), ['remote_command', 'cut-match']);
    second.handlers.claim_remote_control();
    control.dispatch('set-out');
    assert.deepEqual(first.events.at(-1), ['remote_command', 'set-out']);
    first.handlers.disconnect();
    assert.equal(control.dispatch('cut-round'), false);
});

for (const command of ['ff-start', 'rw-start']) {
    test(`takeover releases the previous browser's ${command} interval before stop routes to the new panel`, () => {
        const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
        function browserPanel(id) {
            const client = panel(id);
            const browserHandlers = {};
            const timers = new Set();
            const player = { paused: true, currentTime: 4, playbackRate: 1, pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
            const context = vm.createContext({
                remoteControlActive: false, isSeeking: false, wasPlaying: false, seekMultiplier: 1, seekInterval: null, seekDirection: 'ff', sessionBusy: false, cutPending: false,
                player, clipReady: () => true, updatePlaybackReadout() {}, logMessage() {},
                setInterval() { const timer = {}; timers.add(timer); return timer; }, clearInterval: timer => timers.delete(timer),
                document: { getElementById: () => ({ classList: { toggle() {} } }) },
                socket: { on: (name, handler) => { browserHandlers[name] = handler; } }
            });
            vm.runInContext(html.match(/        function startFF\([\s\S]*?(?=        \/\/ Empfängt)/)[0], context);
            vm.runInContext(html.match(/        socket.on\('remote_control_status',[\s\S]*?\n        \}\);/)[0], context);
            vm.runInContext(html.match(/        socket.on\('remote_command',[\s\S]*?(?=        \/\/ --- NAVIGATION)/)[0], context);
            client.emit = (name, data) => browserHandlers[name]?.(data);
            return { client, context, player, timers };
        }
        const control = createRemoteControl();
        const a = browserPanel('a'); const b = browserPanel('b');
        control.add(a.client); control.add(b.client);
        control.dispatch(command);
        assert.equal(a.context.isSeeking, true);
        assert.equal(a.timers.size, 1);
        b.client.handlers.claim_remote_control();
        control.dispatch('seek-stop');
        assert.equal(a.context.isSeeking, false);
        assert.equal(a.timers.size, 0);
        assert.equal(a.player.playbackRate, 1);
        assert.equal(b.context.isSeeking, false);
    });
}
