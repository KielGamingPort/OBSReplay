const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { createReplaySaveGuard } = require('../lib/replay-save-guard');

test('export conflict during active save releases busy flag and retry exports current state', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    let handler, release, manifest;
    const guard = createReplaySaveGuard(() => new Promise(resolve => { release = resolve; }));
    const state = { match: { id: 12, number: 4 }, map: 3 };
    const context = vm.createContext({
        app: { post: (_route, callback) => { handler = callback; } },
        activeCuts: new Set(), replaySaveGuard: guard,
        matchStore: { hasPending: () => false, get: () => state },
        path, REPLAY_ROOT: 'root', BACKUP_DIR: 'backup', RAW_DIR: 'raw',
        HIGHLIGHTS_ROUND: 'round', HIGHLIGHTS_MATCH: 'match', HIGHLIGHTS_MAP: 'map',
        fs: { existsSync: () => true, promises: { mkdir: async () => {}, cp: async () => {}, writeFile: async (_p, value) => { manifest = JSON.parse(value); } } }
    });
    vm.runInContext('let transitionBusy = false;' + source.slice(source.indexOf("app.post('/api/end-tournament'"), source.indexOf('// --- OBS VERBINDUNG ---')), context);
    const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
    const saving = guard.saveReplay();
    const conflict = response();
    await handler({}, conflict);
    assert.equal(conflict.code, 409);
    assert.equal(vm.runInContext('transitionBusy', context), false);
    release(); await saving;
    const success = response();
    await handler({}, success);
    assert.ok(success.body.exportPath);
    assert.deepEqual(manifest.match, state.match);
    assert.equal(manifest.map, 3);
    assert.equal(manifest.complete, true);
    assert.equal(guard.isResetInProgress(), false);
});
