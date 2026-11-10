const fs = require('fs');
const path = require('path');
const { isVideoFile } = require('./video-files');

const TARGETS = Object.freeze({
    round: { directoryKey: 'round', prefix: 'ROUND_' },
    match: { directoryKey: 'match', prefix: 'MATCH_' }
});

function pathIsInside(parent, candidate) {
    const relative = path.relative(parent, candidate);
    return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function validateCutRequest(data, rawDirectory) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new TypeError('Ungültiger Schnittauftrag.');
    }

    const { fileName, inTime, outTime, target } = data;
    if (!isVideoFile(fileName) || /[\\/\0]/.test(fileName) || fileName !== path.basename(fileName)) {
        throw new TypeError('Ungültiger Dateiname.');
    }
    if (!Number.isFinite(inTime) || inTime < 0) {
        throw new TypeError('Der IN-Punkt muss eine positive Zahl sein.');
    }
    if (!Number.isFinite(outTime) || outTime <= inTime) {
        throw new TypeError('Der OUT-Punkt muss nach dem IN-Punkt liegen.');
    }
    if (!Object.hasOwn(TARGETS, target)) {
        throw new TypeError('Ungültiges Schnittziel.');
    }

    const rawRoot = fs.realpathSync(rawDirectory);
    const requestedPath = path.resolve(rawRoot, fileName);
    if (!pathIsInside(rawRoot, requestedPath)) {
        throw new TypeError('Die Quelldatei liegt außerhalb des Replay-Ordners.');
    }

    const inputFile = fs.realpathSync(requestedPath);
    if (!pathIsInside(rawRoot, inputFile) || !fs.statSync(inputFile).isFile()) {
        throw new TypeError('Die Quelldatei ist kein gültiger Replay-Clip.');
    }

    return {
        fileName,
        inTime,
        outTime,
        duration: outTime - inTime,
        target,
        inputFile,
        ...TARGETS[target]
    };
}

function buildFfmpegArgs(cut, outputFile) {
    return [
        '-i', cut.inputFile,
        '-ss', String(cut.inTime),
        '-t', String(cut.duration),
        '-c', 'copy',
        '-y', outputFile
    ];
}

module.exports = { buildFfmpegArgs, validateCutRequest };
