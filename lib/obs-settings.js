const fs = require('node:fs');

function createSettingsStore(file, defaults) {
    let settings = { ...defaults };
    try {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        const parsed = new URL(saved.url);
        if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || typeof saved.password !== 'string') throw new Error('Invalid saved OBS settings');
        settings = { url: saved.url, password: saved.password };
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    return {
        get: () => ({ ...settings }),
        save(update) {
            const next = { url: update.url, password: update.password === undefined ? settings.password : update.password };
            const temporary = `${file}.tmp`;
            try {
                fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
                fs.renameSync(temporary, file);
                settings = next;
            } finally {
                fs.rmSync(temporary, { force: true });
            }
        }
    };
}

module.exports = { createSettingsStore };
