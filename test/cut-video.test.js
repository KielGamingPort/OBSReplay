const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildFfmpegArgs, validateCutRequest } = require('../lib/cut-video');

function withReplayDirectory(callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-replay-'));
    fs.writeFileSync(path.join(directory, 'replay.mp4'), 'test');
    try {
        return callback(directory);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
}

test('validates a cut and creates shell-free ffmpeg arguments', () => {
    withReplayDirectory((directory) => {
        const cut = validateCutRequest({
            fileName: 'replay.mp4',
            inTime: 2.5,
            outTime: 8,
            target: 'round'
        }, directory);

        assert.equal(cut.duration, 5.5);
        assert.deepEqual(buildFfmpegArgs(cut, 'output.mp4'), [
            '-i', path.join(directory, 'replay.mp4'),
            '-ss', '2.5',
            '-t', '5.5',
            '-c', 'copy',
            '-y', 'output.mp4'
        ]);
    });
});

test('rejects directory traversal and shell payloads', () => {
    withReplayDirectory((directory) => {
        assert.throws(() => validateCutRequest({
            fileName: '..\\outside.mp4', inTime: 0, outTime: 1, target: 'round'
        }, directory), /Dateiname/);
        assert.throws(() => validateCutRequest({
            fileName: 'replay.mp4', inTime: '0 & whoami', outTime: 1, target: 'round'
        }, directory), /IN-Punkt/);
    });
});

test('rejects unknown targets and invalid time ranges', () => {
    withReplayDirectory((directory) => {
        assert.throws(() => validateCutRequest({
            fileName: 'replay.mp4', inTime: 5, outTime: 4, target: 'round'
        }, directory), /OUT-Punkt/);
        assert.throws(() => validateCutRequest({
            fileName: 'replay.mp4', inTime: 0, outTime: 1, target: 'archive'
        }, directory), /Schnittziel/);
    });
});
