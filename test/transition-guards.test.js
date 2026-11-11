const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createReplaySaveGuard } = require('../lib/replay-save-guard');
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('all replay-save entry points refuse active or pending match transitions', async () => {
    const context = vm.createContext({
        createReplaySaveGuard, transitionBusy: true,
        matchStore: { hasPending: () => false }, obsController: { call: async () => 'saved' }
    });
    vm.runInContext(source.match(/const replaySaveGuard = createReplaySaveGuard\([\s\S]*?(?=const publicDirectory)/)[0], context);
    await assert.rejects(vm.runInContext('replaySaveGuard.saveReplay()', context), { statusCode: 409 });
    context.transitionBusy = false;
    context.matchStore.hasPending = () => true;
    await assert.rejects(vm.runInContext('replaySaveGuard.saveReplay()', context), { statusCode: 409 });
    context.matchStore.hasPending = () => false;
    assert.equal(await vm.runInContext('replaySaveGuard.saveReplay()', context), 'saved');
});

test('external round reset refuses transitions and exports in progress', async () => {
    let resets = 0;
    const context = vm.createContext({ transitionBusy: true, performRoundReset: async () => { resets++; } });
    vm.runInContext(source.match(/async function requestRoundReset\([\s\S]*?(?=app.post\('\/api\/reset-round')/)[0], context);
    await assert.rejects(vm.runInContext('requestRoundReset()', context), { statusCode: 409 });
    assert.equal(resets, 0);
    context.transitionBusy = false;
    await vm.runInContext('requestRoundReset()', context);
    assert.equal(resets, 1);
});
