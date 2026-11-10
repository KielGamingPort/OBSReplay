const assert = require('node:assert/strict');
const test = require('node:test');

const { createReplaySaveGuard } = require('../lib/replay-save-guard');

function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

test('blocks reset while a replay save is still active', async () => {
    const pending = deferred();
    const guard = createReplaySaveGuard(() => pending.promise);
    const save = guard.saveReplay();

    assert.throws(() => guard.beginReset(), /Replay-Speichervorgang/);

    pending.resolve();
    await save;
    guard.beginReset();
    assert.equal(guard.isResetInProgress(), true);
    guard.endReset();
});

test('blocks every replay save entry point while reset is active', async () => {
    let saveCalls = 0;
    const guard = createReplaySaveGuard(async () => { saveCalls += 1; });
    guard.beginReset();

    await assert.rejects(guard.saveReplay(), /Runden-Resets/);
    assert.equal(saveCalls, 0);

    guard.endReset();
    await guard.saveReplay();
    assert.equal(saveCalls, 1);
});
