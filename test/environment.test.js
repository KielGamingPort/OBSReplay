const assert = require('node:assert/strict');
const test = require('node:test');

const { readObsPassword } = require('../lib/environment');

test('decodes setup-generated OBS passwords containing both quote types', () => {
    const password = `double" and single' quotes`;
    assert.equal(readObsPassword({
        OBS_PASSWORD_BASE64: Buffer.from(password, 'utf8').toString('base64')
    }), password);
});

test('retains support for manually configured plain-text OBS passwords', () => {
    assert.equal(readObsPassword({ OBS_PASSWORD: 'legacy-password' }), 'legacy-password');
});

test('rejects malformed base64 OBS passwords', () => {
    assert.throws(() => readObsPassword({ OBS_PASSWORD_BASE64: '%' }), /Base64/);
});
