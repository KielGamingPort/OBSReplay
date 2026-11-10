const crypto = require('crypto');
const net = require('node:net');

const COOKIE_NAME = 'replay_session';

function isLoopback(address) {
    if (typeof address !== 'string') return false;
    const normalized = address.toLowerCase().replace(/^::ffff:/, '');
    return normalized === '::1'
        || (net.isIP(normalized) === 4 && normalized.startsWith('127.'));
}

function requestIsLocal(request) {
    // Use the TCP peer, never client-supplied forwarding headers.
    if (!isLoopback(request.socket?.remoteAddress)) return false;
    try {
        const host = new URL(`http://${request.headers.host}`);
        const hostname = host.hostname.replace(/^\[|\]$/g, '');
        if (hostname !== 'localhost' && !isLoopback(hostname)) return false;
        // Restrict browser origins as well, including WebSocket handshakes.
        return !request.headers.origin || new URL(request.headers.origin).host === host.host;
    } catch {
        return false;
    }
}

function safeEqual(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createAccessControl(controlToken) {
    if (typeof controlToken !== 'string' || controlToken.length < 24) {
        throw new Error('CONTROL_TOKEN muss gesetzt sein und mindestens 24 Zeichen enthalten.');
    }

    const sessionValue = crypto.createHash('sha256').update(controlToken).digest('base64url');

    function readCookie(cookieHeader = '') {
        for (const part of cookieHeader.split(';')) {
            const [name, ...valueParts] = part.trim().split('=');
            if (name === COOKIE_NAME) {
                try {
                    return decodeURIComponent(valueParts.join('='));
                } catch {
                    return null;
                }
            }
        }
        return null;
    }

    function requestIsAuthorized(request) {
        if (requestIsLocal(request)) return true;
        const authorization = request.headers.authorization || '';
        const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : null;
        const headerToken = request.headers['x-replay-token'];
        const sessionCookie = readCookie(request.headers.cookie);
        return safeEqual(bearerToken, controlToken)
            || safeEqual(headerToken, controlToken)
            || safeEqual(sessionCookie, sessionValue);
    }

    function socketIsAuthorized(socket) {
        return requestIsAuthorized(socket.request) || safeEqual(socket.handshake.auth?.token, controlToken);
    }

    function establishSession(request, response) {
        if (!safeEqual(request.body?.token, controlToken)) return false;
        response.setHeader(
            'Set-Cookie',
            `${COOKIE_NAME}=${encodeURIComponent(sessionValue)}; HttpOnly; SameSite=Strict; Path=/`
        );
        return true;
    }

    return { establishSession, requestIsAuthorized, socketIsAuthorized };
}

module.exports = { createAccessControl };
