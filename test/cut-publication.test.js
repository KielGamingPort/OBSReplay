const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { buildFfmpegArgs } = require('../lib/cut-video');
const { clipName } = require('../lib/clip-name');

for (const failure of [null, 'encode', 'rename']) {
    test(`cut publication ${failure ? 'handles ' + failure + ' failure' : 'publishes only completed media'}`, async () => {
        const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
        const start = source.indexOf("    socket.on('cut_video',");
        const events = [];
        const jobs = [];
        const activeCuts = new Set();
        let handler;
        let deleted;
        let renamed;
        vm.runInNewContext(source.slice(start, source.indexOf('\n});', start)), {
            socket: { on: (_event, callback) => { handler = callback; }, emit: (...event) => events.push(event) },
            io: { emit: (...event) => events.push(event) },
            transitionBusy: false, matchStore: { hasPending: () => false, get: () => ({ map: 1 }) },
            replaySaveGuard: { isResetInProgress: () => false }, activeCuts,
            validateCutRequest: () => ({ fileName: 'sample.mp4', inputFile: 'sample.mp4', inTime: 2, duration: 3, target: 'map', directoryKey: 'map', prefix: 'MAP_' }),
            RAW_DIR: 'raw', HIGHLIGHTS_ROUND: 'round', HIGHLIGHTS_MATCH: 'match', HIGHLIGHTS_MAP: 'map',
            path, clipName, randomUUID: () => 'unique-id', buildFfmpegArgs, ffmpegPath: 'ffmpeg',
            execFile: (_program, args, _options, callback) => { const child = {}; jobs.push({ args, callback, child }); return child; },
            fs: { promises: {
                rename: async (from, to) => { if (failure === 'rename') throw new Error('rename failed'); renamed = { from, to }; },
                unlink: async file => { deleted = file; }
            } }, console: { log() {} }
        });
        handler({});
        assert.equal(activeCuts.size, 1);
        assert.ok(jobs[0].args.at(-1).endsWith('.partial'));
        assert.equal(events.length, 0);
        await jobs[0].callback(failure === 'encode' ? new Error('encode failed') : null);
        assert.equal(activeCuts.size, 0);
        if (failure) {
            assert.match(events[0][1], new RegExp(failure + ' failed'));
            assert.equal(events[0][0], 'cut_error');
            assert.equal(deleted, jobs[0].args.at(-1));
        } else {
            assert.equal(renamed.from, jobs[0].args.at(-1));
            assert.ok(renamed.to.endsWith('.mp4'));
            assert.equal(events[1][0], 'cut_success');
        }
    });
}
