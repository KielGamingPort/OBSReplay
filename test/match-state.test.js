const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createMatchStore } = require('../lib/match-state');

function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'match-state-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const highlights = path.join(root, 'highlights');
    fs.mkdirSync(highlights);
    fs.writeFileSync(path.join(highlights, 'old.mp4'), 'video');
    fs.writeFileSync(path.join(root, 'match-state.json'), JSON.stringify({ match: { id: 1, number: 1 }, map: 2 }));
    return { root, highlights };
}

test('archives old highlights and commits the next match after cleanup', async t => {
    const { root, highlights } = fixture(t);
    const store = createMatchStore(root, highlights);
    await store.transition({ id: 2, number: 2 });
    assert.equal(store.get().match.id, 2);
    assert.deepEqual(fs.readdirSync(highlights), []);
    const archives = fs.readdirSync(path.join(root, 'Matches'));
    assert.match(archives[0], /^Match_1_/);
    assert.equal(fs.readFileSync(path.join(root, 'Matches', archives[0], 'old.mp4'), 'utf8'), 'video');
    assert.equal(store.hasPending(), false);
});

for (const restart of [false, true]) {
    test(`cleanup failure retains old state and recovers on ${restart ? 'restart' : 'retry'}`, async t => {
        const { root, highlights } = fixture(t);
        let fail = true;
        const store = createMatchStore(root, highlights, {
            ...fs,
            unlinkSync(file) {
                if (fail && file.endsWith('old.mp4')) throw Object.assign(new Error('locked'), { code: 'EPERM' });
                fs.unlinkSync(file);
            }
        });
        await assert.rejects(store.transition({ id: 2, number: 2 }), /locked/);
        assert.equal(store.get().match.id, 1);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'match-state.json'))).match.id, 1);
        assert.equal(store.hasPending(), true);
        fail = false;
        const recovered = restart ? createMatchStore(root, highlights) : store;
        if (!restart) await recovered.transition({ id: 2, number: 2 });
        assert.equal(recovered.get().match.id, 2);
        assert.deepEqual(fs.readdirSync(highlights), []);
        assert.equal(fs.readdirSync(path.join(root, 'Matches')).length, 1);
        assert.equal(recovered.hasPending(), false);
    });
}

test('restart completes a transaction interrupted after publishing state', async t => {
    const { root, highlights } = fixture(t);
    const store = createMatchStore(root, highlights, {
        ...fs,
        unlinkSync(file) {
            if (file.endsWith('.pending')) throw new Error('interrupted');
            fs.unlinkSync(file);
        }
    });
    await assert.rejects(store.transition({ id: 2, number: 2 }), /interrupted/);
    const recovered = createMatchStore(root, highlights);
    assert.equal(recovered.get().match.id, 2);
    assert.deepEqual(fs.readdirSync(highlights), []);
    assert.equal(recovered.hasPending(), false);
});

for (const restart of [false, true]) {
    test(`map cleanup failure recovers exactly once on ${restart ? 'restart' : 'retry'} and retains match clips`, async t => {
        const { root, highlights } = fixture(t);
        const map = path.join(root, 'map');
        fs.mkdirSync(map);
        fs.writeFileSync(path.join(map, 'map.mp4'), 'map video');
        let fail = true;
        const store = createMatchStore(root, highlights, { ...fs, unlinkSync(file) {
            if (fail && file.endsWith('map.mp4')) throw Object.assign(new Error('locked'), { code: 'EPERM' });
            fs.unlinkSync(file);
        } }, map);
        await assert.rejects(store.nextMap(), /locked/);
        assert.equal(store.get().map, 2);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'match-state.json'))).map, 2);
        fail = false;
        const recovered = restart ? createMatchStore(root, highlights, fs, map) : store;
        if (!restart) await recovered.nextMap();
        assert.equal(recovered.get().map, 3);
        assert.deepEqual(fs.readdirSync(map), []);
        assert.equal(fs.readFileSync(path.join(highlights, 'old.mp4'), 'utf8'), 'video');
        const archive = path.join(root, 'Matches', 'Match_1');
        assert.equal(fs.readdirSync(archive).length, 1);
        assert.equal(fs.readFileSync(path.join(archive, fs.readdirSync(archive)[0], 'map.mp4'), 'utf8'), 'map video');
    });
}

test('match transition archives and clears both current map and match clips', async t => {
    const { root, highlights } = fixture(t);
    const map = path.join(root, 'map');
    fs.mkdirSync(map);
    fs.writeFileSync(path.join(map, 'map.mp4'), 'map video');
    const store = createMatchStore(root, highlights, fs, map);
    await store.transition({ id: 2, number: 2 });
    const archive = path.join(root, 'Matches', fs.readdirSync(path.join(root, 'Matches'))[0]);
    assert.equal(fs.readFileSync(path.join(archive, 'Match', 'old.mp4'), 'utf8'), 'video');
    assert.equal(fs.readFileSync(path.join(archive, 'Map_2', 'map.mp4'), 'utf8'), 'map video');
    assert.deepEqual(fs.readdirSync(map), []);
    assert.deepEqual(fs.readdirSync(highlights), []);
    assert.equal(store.get().map, 1);
});
