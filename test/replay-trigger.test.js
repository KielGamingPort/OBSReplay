const assert = require('node:assert/strict');
const test = require('node:test');

const { handleReplayTrigger } = require('../lib/replay-trigger');

test('ignores malformed acknowledgement arguments without rejecting', async () => {
    await handleReplayTrigger(async () => {}, { not: 'a function' });
    await handleReplayTrigger(async () => { throw new Error('offline'); }, 'not a function');
});

test('acknowledges replay success and failure when a callback is supplied', async () => {
    const acknowledgements = [];
    await handleReplayTrigger(async () => {}, (result) => acknowledgements.push(result));
    await handleReplayTrigger(
        async () => { throw new Error('offline'); },
        (result) => acknowledgements.push(result)
    );

    assert.deepEqual(acknowledgements, [
        { ok: true },
        { ok: false, error: 'offline' }
    ]);
});
