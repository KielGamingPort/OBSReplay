const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { listReplayFiles } = require('../lib/replay-files');

test('lists MP4 clips newest first and ignores other entries', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-files-'));
    const older = path.join(directory, 'older.mp4');
    const newer = path.join(directory, 'newer.MP4');
    fs.writeFileSync(older, 'old');
    fs.writeFileSync(newer, 'new');
    fs.writeFileSync(path.join(directory, 'notes.txt'), 'ignore');
    fs.mkdirSync(path.join(directory, 'folder.mp4'));
    fs.utimesSync(older, new Date('2026-01-01'), new Date('2026-01-01'));
    fs.utimesSync(newer, new Date('2026-02-01'), new Date('2026-02-01'));

    try {
        assert.deepEqual(await listReplayFiles(directory), ['newer.MP4', 'older.mp4']);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
