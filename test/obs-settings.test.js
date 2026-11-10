const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { createSettingsStore } = require('../lib/obs-settings');

test('settings survive restart, preserve omitted passwords and allow clearing', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-settings-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'settings.json');
    const defaults = { url: 'ws://localhost:4455', password: 'initial' };
    const store = createSettingsStore(file, defaults);
    store.save({ url: 'ws://other:4455' });
    assert.deepEqual(createSettingsStore(file, defaults).get(), { url: 'ws://other:4455', password: 'initial' });
    store.save({ url: defaults.url, password: 'new secret' });
    assert.equal(createSettingsStore(file, defaults).get().password, 'new secret');
    store.save({ url: defaults.url, password: '' });
    assert.equal(createSettingsStore(file, defaults).get().password, '');
});
