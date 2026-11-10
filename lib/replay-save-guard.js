function conflict(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
}

function createReplaySaveGuard(saveReplayBuffer) {
    let resetInProgress = false;
    let activeSaveCount = 0;

    async function saveReplay() {
        if (resetInProgress) {
            throw conflict('Während des Runden-Resets kann kein Replay gespeichert werden.');
        }

        activeSaveCount += 1;
        try {
            return await saveReplayBuffer();
        } finally {
            activeSaveCount -= 1;
        }
    }

    function beginReset() {
        if (resetInProgress) {
            throw conflict('Ein Runden-Reset läuft bereits.');
        }
        if (activeSaveCount > 0) {
            throw conflict('Der Runden-Reset wartet auf einen laufenden Replay-Speichervorgang.');
        }
        resetInProgress = true;
    }

    function endReset() {
        resetInProgress = false;
    }

    function isResetInProgress() {
        return resetInProgress;
    }

    return { beginReset, endReset, isResetInProgress, saveReplay };
}

module.exports = { createReplaySaveGuard };
