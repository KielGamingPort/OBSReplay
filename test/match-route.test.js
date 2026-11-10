const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

test('match route announces state and duration changes only after cleanup completes', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    const route = source.slice(source.indexOf('let transitionBusy = false;'), source.indexOf("app.post('/api/next-map'"));
    const events = [];
    let handler;
    let fail = true;
    let pending = false;
    const context = {
        app: { post: (_path, callback) => { handler = callback; } },
        activeCuts: new Set(),
        replaySaveGuard: { isResetInProgress: () => false },
        performRoundReset: async () => { events.push('reset'); },
        matchStore: {
            hasPending: () => pending,
            get: () => ({ match: { id: 2 }, map: 1 }),
            transition: async () => {
                pending = true;
                if (fail) throw new Error('locked');
                events.push('cleanup');
                pending = false;
            }
        },
        io: { emit: name => { events.push(name); } }
    };
    vm.runInNewContext(route, context);
    const response = { status(value) { this.code = value; return this; }, json(value) { this.body = value; } };
    await handler({ body: { id: 2, number: 2 } }, response);
    assert.equal(response.code, 500);
    assert.deepEqual(events, ['reset']);
    fail = false;
    await handler({ body: { id: 2, number: 2 } }, response);
    assert.deepEqual(events, ['reset', 'cleanup', 'match_state', 'clip_durations_changed']);
    assert.equal(response.body.match.id, 2);
});
