const fs = require('node:fs/promises');
const path = require('node:path');
const { isVideoFile } = require('./video-files');

async function listMp4Files(directory, fileSystem) {
    const entries = await fileSystem.readdir(directory, { withFileTypes: true });
    return entries
        .filter((entry) => entry.isFile() && isVideoFile(entry.name))
        .map((entry) => entry.name);
}

async function archiveRound({
    rawDirectory,
    highlightsDirectory,
    backupDirectory,
    now = new Date(),
    fileSystem = fs
}) {
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const roundBackup = path.join(backupDirectory, `Runde_${timestamp}`);
    const rawBackup = path.join(roundBackup, 'Raw');
    const highlightsBackup = path.join(roundBackup, 'Highlights_Round');

    const [rawFiles, highlightFiles] = await Promise.all([
        listMp4Files(rawDirectory, fileSystem),
        listMp4Files(highlightsDirectory, fileSystem)
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

    await fileSystem.mkdir(rawBackup, { recursive: true });
    await fileSystem.mkdir(highlightsBackup, { recursive: true });

    const completed = [];
    try {
        for (const move of moves) {
            await fileSystem.rename(move.source, move.destination);
            completed.push(move);
        }
    } catch (error) {
        const rollbackErrors = [];
        for (const move of completed.reverse()) {
            try {
                await fileSystem.rename(move.destination, move.source);
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        const rollbackMessage = rollbackErrors.length === 0
            ? 'bereits verschobene Dateien wurden zurückgesetzt.'
            : `die Rücksetzung von ${rollbackErrors.length} Datei(en) ist ebenfalls fehlgeschlagen.`;
        const resetError = new Error(`Runden-Reset fehlgeschlagen; ${rollbackMessage}`, { cause: error });
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
