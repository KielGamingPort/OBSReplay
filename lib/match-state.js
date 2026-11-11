const fs = require('node:fs');
const path = require('node:path');
const { isVideoFile } = require('./video-files');

function createMatchStore(root, highlights, fileSystem = fs, mapHighlights) {
    const stateFile = path.join(root, 'match-state.json');
    const journalFile = stateFile + '.pending';
    let state = fileSystem.existsSync(stateFile) ? JSON.parse(fileSystem.readFileSync(stateFile, 'utf8')) : { match: null, map: 1 };

    function recover() {
        if (!fileSystem.existsSync(journalFile)) return;
        const pending = JSON.parse(fileSystem.readFileSync(journalFile, 'utf8'));
        // The archive is complete before the journal is published. Repeating
        // cleanup is safe after interruption, including after state publication.
        for (const name of pending.files) {
            try { fileSystem.unlinkSync(typeof name === 'string' ? path.join(highlights, name) : path.join(name.directory, name.name)); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        fileSystem.writeFileSync(stateFile + '.tmp', JSON.stringify(pending.next));
        fileSystem.renameSync(stateFile + '.tmp', stateFile);
        fileSystem.unlinkSync(journalFile);
        state = pending.next;
    }

    recover();
    function transitionKey(next) {
        const match = next.match;
        return JSON.stringify([next.map, match?.id, match?.number, match?.tournament || '', match?.team1 || '', match?.team2 || '']);
    }
    async function transition(next, directories, archive) {
        if (fileSystem.existsSync(journalFile)) {
            const pending = JSON.parse(fileSystem.readFileSync(journalFile, 'utf8'));
            if (transitionKey(pending.next) !== transitionKey(next)) {
                const error = new Error(`Unerledigter Wechsel zu Match ${pending.next.match?.number || 'unbekannt'}, Map ${pending.next.map}. Zuerst den ursprünglichen Wechsel wiederholen.`);
                error.statusCode = 409;
                throw error;
            }
            recover();
            return state;
        }
        const files = [];
        for (const [directory, destination] of directories) {
            await fileSystem.promises.cp(directory, path.join(archive, destination), { recursive: true, errorOnExist: true, force: false });
            files.push(...fileSystem.readdirSync(directory, { withFileTypes: true })
                .filter(entry => entry.isFile() && isVideoFile(entry.name))
                .map(entry => ({ directory, name: entry.name })));
        }
        fileSystem.writeFileSync(journalFile + '.tmp', JSON.stringify({ next, files }));
        fileSystem.renameSync(journalFile + '.tmp', journalFile);
        recover();
        return state;
    }
    return {
        get: () => state,
        hasPending: () => fileSystem.existsSync(journalFile),
        recover,
        transition(match) {
            const archive = path.join(root, 'Matches', `Match_${state.match?.id || 'unassigned'}_${Date.now()}`);
            const directories = [[highlights, mapHighlights ? 'Match' : '']];
            if (mapHighlights) directories.push([mapHighlights, `Map_${state.map}`]);
            return transition({ match, map: 1 }, directories, archive);
        },
        nextMap() {
            const archive = path.join(root, 'Matches', `Match_${state.match?.id || 'unassigned'}`, `Map_${state.map}_${Date.now()}`);
            return transition({ ...state, map: state.map + 1 }, [[mapHighlights, '']], archive);
        }
    };
}

module.exports = { createMatchStore };
