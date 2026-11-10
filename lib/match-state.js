const fs = require('node:fs');
const path = require('node:path');
const { isVideoFile } = require('./video-files');

function createMatchStore(root, highlights, fileSystem = fs) {
    const stateFile = path.join(root, 'match-state.json');
    const journalFile = stateFile + '.pending';
    let state = fileSystem.existsSync(stateFile) ? JSON.parse(fileSystem.readFileSync(stateFile, 'utf8')) : { match: null, map: 1 };

    function recover() {
        if (!fileSystem.existsSync(journalFile)) return;
        const pending = JSON.parse(fileSystem.readFileSync(journalFile, 'utf8'));
        // The archive is complete before the journal is published. Repeating
        // cleanup is safe after interruption, including after state publication.
        for (const name of pending.files) {
            try { fileSystem.unlinkSync(path.join(highlights, name)); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        fileSystem.writeFileSync(stateFile + '.tmp', JSON.stringify(pending.next));
        fileSystem.renameSync(stateFile + '.tmp', stateFile);
        fileSystem.unlinkSync(journalFile);
        state = pending.next;
    }

    recover();
    return {
        get: () => state,
        hasPending: () => fileSystem.existsSync(journalFile),
        recover,
        async transition(match) {
            if (fileSystem.existsSync(journalFile)) {
                recover();
                return state;
            }
            const archive = path.join(root, 'Matches', `Match_${state.match?.id || 'unassigned'}_${Date.now()}`);
            await fileSystem.promises.cp(highlights, archive, { recursive: true, errorOnExist: true, force: false });
            const files = fileSystem.readdirSync(highlights, { withFileTypes: true })
                .filter(entry => entry.isFile() && isVideoFile(entry.name)).map(entry => entry.name);
            fileSystem.writeFileSync(journalFile + '.tmp', JSON.stringify({ next: { match, map: 1 }, files }));
            fileSystem.renameSync(journalFile + '.tmp', journalFile);
            recover();
            return state;
        }
    };
}

module.exports = { createMatchStore };
