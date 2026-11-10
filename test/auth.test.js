const assert = require('node:assert/strict');
const test = require('node:test');

const { createAccessControl } = require('../lib/auth');

const TOKEN = 'a-secure-control-token-with-32-chars';

test('requires a sufficiently long control token', () => {
    assert.throws(() => createAccessControl('short'), /mindestens 24 Zeichen/);
});

test('accepts bearer and dedicated token headers', () => {
    const access = createAccessControl(TOKEN);
    assert.equal(access.requestIsAuthorized({ headers: { authorization: `Bearer ${TOKEN}` } }), true);
    assert.equal(access.requestIsAuthorized({ headers: { 'x-replay-token': TOKEN } }), true);
    assert.equal(access.requestIsAuthorized({ headers: { authorization: 'Bearer wrong' } }), false);
});

test('establishes an HTTP-only browser session', () => {
    const access = createAccessControl(TOKEN);
    let cookie;
    const response = { setHeader: (_name, value) => { cookie = value; } };
    assert.equal(access.establishSession({ body: { token: TOKEN } }, response), true);
    assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\//);

    const cookieValue = cookie.split(';')[0];
    assert.equal(access.requestIsAuthorized({ headers: { cookie: cookieValue } }), true);
});
