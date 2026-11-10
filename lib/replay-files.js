const fs = require('node:fs/promises');
const path = require('node:path');

async function listReplayFiles(directory, fileSystem = fs) {
    const entries = await fileSystem.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
        .map(async (entry) => {
            try {
                const stats = await fileSystem.stat(path.join(directory, entry.name));
                return { name: entry.name, modifiedAt: stats.mtimeMs };
            } catch (error) {
                if (error.code === 'ENOENT') return null;
                throw error;
            }
        }));

    return files
        .filter(Boolean)
        .sort((left, right) => right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name))
        .map((file) => file.name);
}

module.exports = { listReplayFiles };
