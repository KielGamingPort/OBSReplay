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
        fs: { existsSync: () => true, promises: { mkdir: async () => {}, cp: async () => {}, rename: async () => {}, writeFile: async (_p, value) => { manifest = JSON.parse(value); } } }
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

for (const failure of ['write', 'rename']) {
    test(`failed manifest ${failure} never publishes a completion marker`, async t => {
        const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'export-marker-'));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        let handler;
        const guard = createReplaySaveGuard(async () => {});
        const context = vm.createContext({
            app: { post: (_route, callback) => { handler = callback; } },
            activeCuts: new Set(), replaySaveGuard: guard,
            matchStore: { hasPending: () => false, get: () => ({ match: null, map: 1 }) },
            path, REPLAY_ROOT: root, BACKUP_DIR: 'backup', RAW_DIR: 'raw',
            HIGHLIGHTS_ROUND: 'round', HIGHLIGHTS_MATCH: 'match', HIGHLIGHTS_MAP: 'map',
            fs: { existsSync: () => false, promises: {
                ...fs.promises, cp: async () => {},
                writeFile: async (file, value) => {
                    await fs.promises.writeFile(file, failure === 'write' ? '{' : value);
                    if (failure === 'write') throw new Error('disk full');
                },
                rename: async () => { throw new Error('rename failed'); }
            } }
        });
        vm.runInContext('let transitionBusy = false;' + source.slice(source.indexOf("app.post('/api/end-tournament'"), source.indexOf('// --- OBS VERBINDUNG ---')), context);
        const response = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
        await handler({}, response);
        assert.equal(response.code, 500);
        const exports = path.join(root, 'Exports');
        const directory = path.join(exports, fs.readdirSync(exports)[0]);
        assert.equal(fs.existsSync(path.join(directory, 'manifest.json')), false);
        assert.equal(fs.existsSync(path.join(directory, 'manifest.json.tmp')), true);
        assert.equal(guard.isResetInProgress(), false);
        assert.equal(vm.runInContext('transitionBusy', context), false);
    });
}
