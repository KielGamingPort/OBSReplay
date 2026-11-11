const assert = require('node:assert/strict');
const test = require('node:test');
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
