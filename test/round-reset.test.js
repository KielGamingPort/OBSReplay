const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { archiveRound } = require('../lib/round-reset');

test('archives raw and round-highlight clips in one timestamped backup', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-reset-'));
    const raw = path.join(root, 'Raw');
    const highlights = path.join(root, 'Highlights_Round');
    const backups = path.join(root, 'Backups');
    fs.mkdirSync(raw);
    fs.mkdirSync(highlights);
    fs.writeFileSync(path.join(raw, 'raw.mp4'), 'raw');
    fs.writeFileSync(path.join(highlights, 'highlight.mp4'), 'highlight');
    fs.writeFileSync(path.join(raw, 'keep.txt'), 'keep');

    try {
        const result = await archiveRound({
            rawDirectory: raw,
            highlightsDirectory: highlights,
            backupDirectory: backups,
            now: new Date('2026-11-10T12:00:00.000Z')
        });

        assert.equal(result.rawCount, 1);
        assert.equal(result.highlightCount, 1);
        assert.equal(fs.existsSync(path.join(raw, 'raw.mp4')), false);
        assert.equal(fs.existsSync(path.join(raw, 'keep.txt')), true);
        assert.equal(fs.readFileSync(path.join(result.backupPath, 'Raw', 'raw.mp4'), 'utf8'), 'raw');
        assert.equal(
            fs.readFileSync(path.join(result.backupPath, 'Highlights_Round', 'highlight.mp4'), 'utf8'),
            'highlight'
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('rolls completed moves back when a later move fails', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-reset-'));
    const raw = path.join(root, 'Raw');
    const highlights = path.join(root, 'Highlights_Round');
    const backups = path.join(root, 'Backups');
    const timestamp = 'Runde_2026-11-10T12-00-00-000Z';
    fs.mkdirSync(raw);
    fs.mkdirSync(highlights);
    fs.writeFileSync(path.join(raw, 'raw.mp4'), 'raw');
    fs.writeFileSync(path.join(highlights, 'highlight.mp4'), 'highlight');
    fs.mkdirSync(path.join(backups, timestamp, 'Highlights_Round', 'highlight.mp4'), { recursive: true });

    try {
        await assert.rejects(archiveRound({
            rawDirectory: raw,
            highlightsDirectory: highlights,
            backupDirectory: backups,
            now: new Date('2026-11-10T12:00:00.000Z')
        }), /zurückgesetzt/);

        assert.equal(fs.readFileSync(path.join(raw, 'raw.mp4'), 'utf8'), 'raw');
        assert.equal(fs.readFileSync(path.join(highlights, 'highlight.mp4'), 'utf8'), 'highlight');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('reports rollback failures instead of claiming every file was restored', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-reset-'));
    const raw = path.join(root, 'Raw');
    const highlights = path.join(root, 'Highlights_Round');
    const backups = path.join(root, 'Backups');
    fs.mkdirSync(raw);
    fs.mkdirSync(highlights);
    fs.writeFileSync(path.join(raw, 'raw.mp4'), 'raw');
    fs.writeFileSync(path.join(highlights, 'highlight.mp4'), 'highlight');

    let renameCall = 0;
    const fileSystem = {
        ...require('node:fs/promises'),
        async rename(source, destination) {
            renameCall += 1;
            if (renameCall === 1) return require('node:fs/promises').rename(source, destination);
            if (renameCall === 2) throw new Error('archive move failed');
            throw new Error('rollback failed');
        }
    };

    try {
        await assert.rejects(archiveRound({
            rawDirectory: raw,
            highlightsDirectory: highlights,
            backupDirectory: backups,
            now: new Date('2026-11-10T12:00:00.000Z'),
            fileSystem
        }), (error) => {
            assert.match(error.message, /Rücksetzung von 1 Datei/);
            assert.equal(error.rollbackErrors.length, 1);
            return true;
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
