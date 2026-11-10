const fs = require('node:fs/promises');
const path = require('node:path');

async function listMp4Files(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
        .map((entry) => entry.name);
}

async function archiveRound({ rawDirectory, highlightsDirectory, backupDirectory, now = new Date() }) {
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const roundBackup = path.join(backupDirectory, `Runde_${timestamp}`);
    const rawBackup = path.join(roundBackup, 'Raw');
    const highlightsBackup = path.join(roundBackup, 'Highlights_Round');

    const [rawFiles, highlightFiles] = await Promise.all([
        listMp4Files(rawDirectory),
        listMp4Files(highlightsDirectory)
    ]);
    const moves = [
        ...rawFiles.map((file) => ({
            source: path.join(rawDirectory, file),
            destination: path.join(rawBackup, file)
        })),
        ...highlightFiles.map((file) => ({
            source: path.join(highlightsDirectory, file),
            destination: path.join(highlightsBackup, file)
        }))
    ];

    await fs.mkdir(rawBackup, { recursive: true });
    await fs.mkdir(highlightsBackup, { recursive: true });

    const completed = [];
    try {
        for (const move of moves) {
            await fs.rename(move.source, move.destination);
            completed.push(move);
        }
    } catch (error) {
        const rollbackErrors = [];
        for (const move of completed.reverse()) {
            try {
                await fs.rename(move.destination, move.source);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        const resetError = new Error('Runden-Reset fehlgeschlagen; bereits verschobene Dateien wurden zurückgesetzt.', { cause: error });
        resetError.rollbackErrors = rollbackErrors;
        throw resetError;
    }

    return {
        backupPath: roundBackup,
        rawCount: rawFiles.length,
        highlightCount: highlightFiles.length
    };
}

module.exports = { archiveRound };
