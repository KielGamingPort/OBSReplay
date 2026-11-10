const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const html = fs.readFileSync(require('node:path').join(__dirname, '../public/index.html'), 'utf8');

test('rollback add events do not duplicate clips or change the selected video', () => {
    const children = [];
    const handlers = {};
    let loads = 0;
    const context = vm.createContext({
        clipList: { children, prepend: node => children.unshift(node), append: node => children.push(node) },
        document: { createElement: () => ({ dataset: {} }) },
        socket: { on: (name, handler) => { handlers[name] = handler; } },
        logMessage() {},
        loadVideo() { loads++; }
    });
    vm.runInContext(html.match(/        function addClipToList\([\s\S]*?(?=        function loadVideo)/)[0], context);
    vm.runInContext(html.match(/        socket.on\('new_replay_available',[\s\S]*?\n        \}\);/)[0], context);
    vm.runInContext("addClipToList('existing.mp4')", context);
    handlers.new_replay_available('existing.mp4');
    assert.equal(children.length, 1);
    assert.equal(loads, 0);
    handlers.new_replay_available('new.mp4');
    assert.equal(children.length, 2);
    assert.equal(loads, 1);
});

test('dashboard displays replay save failures', () => {
    let handler;
    let message;
    vm.runInNewContext(html.match(/        socket.on\('replay_error'[^\n]*/)[0], {
        socket: { on: (_name, callback) => { handler = callback; } },
        logMessage: value => { message = value; }
    });
    handler('SaveReplayBuffer failed');
    assert.match(message, /SaveReplayBuffer failed/);
});
