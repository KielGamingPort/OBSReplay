const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { clipName } = require('../lib/clip-name');
test('names clips with tournament, match, teams and map while retaining umlauts', () => {
    assert.equal(clipName({match: {tournament: 'Kiel', number: 4, team1: 'B\u00e4ren', team2: 'L\u00f6wen'}, map: 2}, 'Round_', 123), 'Kiel_4_B\u00e4ren_vs_L\u00f6wen_Map_2_Round_123.mp4');
});
test('removes path separators from supplied names', () => {
    assert.equal(clipName({match: {tournament: '../Cup'}, map: 1}, '', 1), '.._Cup_0_Team1_vs_Team2_Map_1_1.mp4');
});

for (const label of ['x'.repeat(80), '\u{1f43b}Ba\u0308ren'.repeat(40)]) {
    test(`long ${label.startsWith('x') ? 'ASCII' : 'Unicode'} names produce a writable filename with all identifiers`, () => {
        const name = clipName({ match: { tournament: label, number: 4, team1: label, team2: label }, map: 2 }, 'ROUND_', 123);
        assert.ok(Buffer.byteLength(name, 'utf8') <= 200);
        assert.match(name, /_4_.+_vs_.+_Map_2_ROUND_123\.mp4$/);
        assert.equal(name, name.normalize('NFC'));
        assert.equal(name.isWellFormed(), true);
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clip-name-'));
        try {
            fs.writeFileSync(path.join(directory, name), 'clip');
            assert.equal(fs.readFileSync(path.join(directory, name), 'utf8'), 'clip');
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });
}

test('legacy malformed metadata falls back without invoking object coercion', () => {
    const invalid = { toString: null, valueOf: null };
    assert.equal(clipName({ match: { tournament: invalid, number: 4, team1: invalid, team2: null }, map: 2 }, 'ROUND_', 123), 'Tournament_4_Team1_vs_Team2_Map_2_ROUND_123.mp4');
});

test('cut handler reports a naming failure without starting FFmpeg', () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const start = source.indexOf("    socket.on('cut_video',");
    const handlerSource = source.slice(start, source.indexOf('\n});', start));
    const events = [];
    const handlers = {};
    const activeCuts = new Set();
    vm.runInNewContext(handlerSource, {
        socket: { on: (event, handler) => { handlers[event] = handler; }, emit: (...event) => events.push(event) },
        transitionBusy: false,
        matchStore: { hasPending: () => false, get: () => ({}) },
        replaySaveGuard: { isResetInProgress: () => false },
        activeCuts,
        validateCutRequest: () => ({ directoryKey: 'round', prefix: 'ROUND_' }),
        RAW_DIR: 'raw', HIGHLIGHTS_ROUND: 'round', HIGHLIGHTS_MATCH: 'match', HIGHLIGHTS_MAP: 'map',
        path,
        randomUUID: () => 'test-id',
        clipName: () => { throw new Error('Cannot name clip'); },
        execFile: () => assert.fail('FFmpeg must not start after a naming failure')
    });
    assert.doesNotThrow(() => handlers.cut_video({}));
    assert.deepEqual(events, [['cut_error', 'Cannot name clip']]);
    assert.equal(activeCuts.size, 0);
});
