const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listReplayFiles } = require('../lib/replay-files');

test('skips clips moved away by reset during metadata lookup', async () => {
    const fileSystem = {
        async readdir() {
            return ['moved.mp4', 'remaining.mp4'].map(name => ({ name, isFile: () => true }));
        },
        async stat(file) {
            if (path.basename(file) === 'moved.mp4') {
                throw Object.assign(new Error('moved'), { code: 'ENOENT' });
            }
            return { mtimeMs: 1 };
        }
    };
    assert.deepEqual(await listReplayFiles('Raw', fileSystem), ['remaining.mp4']);
    fileSystem.stat = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
    await assert.rejects(listReplayFiles('Raw', fileSystem), { code: 'EACCES' });
});

test('lists MP4 clips newest first and ignores other entries', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-files-'));
    const older = path.join(directory, 'older.mp4');
    const newer = path.join(directory, 'newer.MP4');
    fs.writeFileSync(older, 'old');
    fs.writeFileSync(newer, 'new');
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'ignore');
    fs.writeFileSync(path.join(directory, 'unsupported.flv'), 'ignore');
    fs.writeFileSync(path.join(directory, 'unsupported.ts'), 'ignore');
    fs.writeFileSync(path.join(directory, 'supported.mkv'), 'mkv');
    fs.mkdirSync(path.join(directory, 'folder.mp4'));
    fs.utimesSync(older, new Date('2026-01-01'), new Date('2026-01-01'));
    fs.utimesSync(newer, new Date('2026-02-01'), new Date('2026-02-01'));
    fs.utimesSync(path.join(directory, 'supported.mkv'), new Date('2026-03-01'), new Date('2026-03-01'));

    try {
        assert.deepEqual(await listReplayFiles(directory), ['supported.mkv', 'newer.MP4', 'older.mp4']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
