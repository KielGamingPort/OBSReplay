const fs = require('node:fs/promises');
const path = require('node:path');

async function listReplayFiles(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.mp4'))
        .map(async (entry) => {
            const stats = await fs.stat(path.join(directory, entry.name));
            return { name: entry.name, modifiedAt: stats.mtimeMs };
        }));

    return files
        .sort((left, right) => right.modifiedAt - left.modifiedAt || left.name.localeCompare(right.name))
        .map((file) => file.name);
}

module.exports = { listReplayFiles };
