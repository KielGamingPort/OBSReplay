const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

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
            '-ss', '2.5',
            '-i', path.join(directory, 'replay.mp4'),
            '-t', '5.5',
            '-map', '0:v:0', '-map', '0:a:0?',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
            '-pix_fmt', 'yuv420p', '-c:a', 'aac',
            '-movflags', '+faststart', '-f', 'mp4',
            '-y', 'output.mp4'
        ]);
    });
});

test('accepts OBS recording formats for both save targets', () => {
    withReplayDirectory((directory) => {
        for (const extension of ['mkv', 'MOV', 'm4v']) {
            const fileName = `Replay 2026-11-10.${extension}`;
            fs.writeFileSync(path.join(directory, fileName), 'test');
            for (const target of ['round', 'match']) {
                const cut = validateCutRequest({ fileName, inTime: 0, outTime: 1, target }, directory);
                assert.equal(cut.inputFile, path.join(directory, fileName));
            }
        }
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

test('cuts between keyframes retain video frames and the selected duration', t => {
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
    const ffprobe = process.env.FFPROBE_PATH || path.join(path.dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    if (spawnSync(ffmpeg, ['-version']).status !== 0 || spawnSync(ffprobe, ['-version']).status !== 0) return t.skip('FFmpeg and FFprobe required for media integration');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-cut-media-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const input = path.join(directory, 'source.mp4');
    const output = path.join(directory, 'cut.partial');
    const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=2:size=160x90:rate=25', '-c:v', 'libx264', '-g', '250', '-y', input]);
    assert.equal(generated.status, 0, generated.stderr?.toString());
    const cut = spawnSync(ffmpeg, buildFfmpegArgs({ inputFile: input, inTime: 0.4, duration: 0.8 }, output));
    assert.equal(cut.status, 0, cut.stderr?.toString());
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=nb_frames:format=duration', '-of', 'json', output]);
    assert.equal(probe.status, 0, probe.stderr?.toString());
    const result = JSON.parse(probe.stdout);
    assert.ok(Number(result.streams[0].nb_frames) >= 19);
    assert.ok(Math.abs(Number(result.format.duration) - 0.8) < 0.05);
});
