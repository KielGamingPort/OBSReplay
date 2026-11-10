function createObsController({ client, url, password, onStatus = () => {}, schedule = setTimeout }) {
    let pendingConnection = Promise.resolve();
    let updating = false;
    let connected = false;
    let connecting = false;
    let stopped = false;
    let retryDelay = 1000;
    let retryTimer = null;

    function publish(error = null) {
        onStatus({ connected, error: error?.message || null });
    }

    function scheduleReconnect() {
        if (stopped || retryTimer) return;
        const delay = retryDelay;
        retryDelay = Math.min(retryDelay * 2, 30000);
        retryTimer = schedule(() => {
            retryTimer = null;
            connect().catch(() => {});
        }, delay);
    }

    async function connect() {
        if (stopped || connecting || connected) return;
        connecting = true;
        try {
            pendingConnection = client.connect(url, password || undefined);
            await pendingConnection;
            connected = true;
            retryDelay = 1000;
            publish();
        } catch (error) {
            connected = false;
            publish(error);
            scheduleReconnect();
            throw error;
        } finally {
            connecting = false;
        }
    }

    client.on('ConnectionClosed', () => {
        connected = false;
        publish(new Error('OBS-Verbindung wurde getrennt.'));
        scheduleReconnect();
    });

    async function call(requestType, requestData) {
        if (!connected) throw new Error('OBS ist nicht verbunden.');
        return client.call(requestType, requestData);
    }

    return {
        call,
        getSettings: () => ({ url, hasPassword: Boolean(password) }),
        async configure(settings) {
            if (updating) {
                const error = new Error('Verbindung wird bereits aktualisiert.');
                error.statusCode = 409;
                throw error;
            }
            updating = true;
            this.stop();
            try {
                await client.disconnect();
                await pendingConnection.catch(() => {});
                connected = false;
                url = settings.url;
                if (settings.password !== undefined) password = settings.password;
                retryDelay = 1000;
                stopped = false;
                connect().catch(() => {});
                return this.getStatus();
            } finally {
                updating = false;
                stopped = false;
                if (!connected && !connecting) scheduleReconnect();
            }
        },
        getStatus: () => ({ connected }),
        start() {
            stopped = false;
            connect().catch(() => {});
        },
        stop() {
            stopped = true;
            if (retryTimer && typeof clearTimeout === 'function') clearTimeout(retryTimer);
            retryTimer = null;
        }
    };
}

module.exports = { createObsController };
