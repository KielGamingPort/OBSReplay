const assert = require('node:assert/strict');
const test = require('node:test');

const { createAccessControl } = require('../lib/auth');

const TOKEN = 'a-secure-control-token-with-32-chars';

function localRequest(address = '127.0.0.1', headers = {}) {
    return { socket: { remoteAddress: address }, headers: { host: 'localhost:3000', ...headers } };
}

test('allows loopback HTTP and Socket.IO access without a token', () => {
    const access = createAccessControl(TOKEN);
    for (const address of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) {
        const request = localRequest(address);
        assert.equal(access.requestIsAuthorized(request), true, address);
        assert.equal(access.socketIsAuthorized({ request, handshake: {} }), true, address);
    }
    for (const host of ['127.0.0.1:3000', '[::1]:3000', 'localhost:3000']) {
        assert.equal(access.requestIsAuthorized(localRequest('::1', { host, origin: `http://${host}` })), true);
    }
});

test('remote clients cannot bypass authentication with local-looking headers', () => {
    const access = createAccessControl(TOKEN);
    for (const address of ['192.168.1.20', '::ffff:192.168.1.20', '2001:db8::1', undefined]) {
        const request = localRequest(address, {
            'x-forwarded-for': '127.0.0.1', 'x-real-ip': '::1', forwarded: 'for=127.0.0.1'
        });
        if (address === undefined) delete request.socket;
        assert.equal(access.requestIsAuthorized(request), false);
        assert.equal(access.socketIsAuthorized({ request, handshake: {} }), false);
        request.headers['x-replay-token'] = TOKEN;
        assert.equal(access.requestIsAuthorized(request), true);
    }
});

test('loopback bypass rejects external hosts and browser origins', () => {
    const access = createAccessControl(TOKEN);
    for (const headers of [
        { host: 'attacker.example:3000' },
        { host: '192.168.1.10:3000' },
        { host: undefined },
        { host: 'invalid host' },
        { origin: 'https://attacker.example' },
        { origin: 'null' },
        { origin: 'http://localhost:4000' }
    ]) {
        assert.equal(access.requestIsAuthorized(localRequest('127.0.0.1', headers)), false);
    }
});

test('tokenless local access does not mint a session usable remotely', () => {
    const access = createAccessControl(TOKEN);
    assert.equal(access.establishSession(localRequest(), {
        setHeader() { assert.fail('a local bypass must not create a session cookie'); }
    }), false);
});

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

test('rejects malformed percent-encoding in the session cookie without throwing', () => {
    const access = createAccessControl(TOKEN);
    assert.equal(access.requestIsAuthorized({
        headers: { cookie: 'replay_session=%E0%A4%A' }
    }), false);
});
