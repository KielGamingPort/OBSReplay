const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { createObsController } = require('../lib/obs-controller');

test('retries a failed OBS connection and becomes callable after recovery', async () => {
    const client = new EventEmitter();
    let attempts = 0;
    client.connect = async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
    };
    client.call = async (requestType) => requestType;
    let retry;
    const statuses = [];
    const controller = createObsController({
        client,
        url: 'ws://127.0.0.1:4455',
        password: 'secret',
        onStatus: (status) => statuses.push(status),
        schedule: (callback) => { retry = callback; return 1; }
    });

    controller.start();
    await new Promise(setImmediate);
    await assert.rejects(controller.call('SaveReplayBuffer'), /nicht verbunden/);
    retry();
    await new Promise(setImmediate);

    assert.equal(attempts, 2);
    assert.equal(await controller.call('SaveReplayBuffer'), 'SaveReplayBuffer');
    assert.equal(statuses.at(-1).connected, true);
});

test('publishes disconnects and schedules a reconnect', async () => {
    const client = new EventEmitter();
    client.connect = async () => {};
    client.call = async () => {};
    const scheduled = [];
    const statuses = [];
    const controller = createObsController({
        client,
        url: 'ws://127.0.0.1:4455',
        onStatus: (status) => statuses.push(status),
        schedule: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; }
    });

    controller.start();
    await new Promise(setImmediate);
    client.emit('ConnectionClosed');

    assert.equal(statuses.at(-1).connected, false);
    assert.equal(scheduled.at(-1).delay, 1000);
});

test('settings cancel a pending handshake before waiting for it', async () => {
    const client = new EventEmitter();
    let rejectHandshake;
    let attempts = 0;
    client.connect = () => ++attempts === 1
        ? new Promise((_resolve, reject) => { rejectHandshake = reject; })
        : Promise.resolve();
    client.disconnect = async () => { rejectHandshake(new Error('closed')); };
    const controller = createObsController({ client, url: 'ws://old:4455' });
    controller.start();
    const status = await controller.configure({ url: 'ws://new:4455' });
    assert.equal(status.connected, true);
    assert.equal(attempts, 2);
    assert.equal(controller.getSettings().url, 'ws://new:4455');
    controller.stop();
});
