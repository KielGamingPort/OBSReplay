const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchMatch } = require('../lib/challonge');
test('loads tournament, match and group participant metadata from IDs', async () => {
    const result = await fetchMatch('community-cup', 42, { apiKey: 'secret', request: async url => ({ ok: true, json: async () => url.pathname.includes('/matches/') ? { match: { id: 42, player1_id: 9, player2_id: null, scores_csv: '1-0' } } : url.pathname.includes('/participants') ? [{ participant: { id: 2, group_player_ids: [9], name: 'Alpha' } }] : { tournament: { name: 'Cup', game_name: 'Game' } } }) });
    assert.equal(result.team1, 'Alpha');
    assert.equal(result.team2, 'TBD');
    assert.equal(result.number, 42);
    assert.equal(result.challonge.match.scores_csv, '1-0');
    assert.equal(result.challonge.tournament.game_name, 'Game');
});
test('rejects invalid IDs and upstream failures', async () => {
    await assert.rejects(fetchMatch('../bad', 1), /Invalid tournament/);
    await assert.rejects(fetchMatch('cup', 0), /Invalid match/);
    await assert.rejects(fetchMatch('cup', 1, { apiKey: 'key', request: async () => ({ ok: false }) }), /Could not load/);
});
