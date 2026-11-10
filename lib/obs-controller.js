function createObsController({ client, url, password, onStatus = () => {}, schedule = setTimeout }) {
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
            await client.connect(url, password || undefined);
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
