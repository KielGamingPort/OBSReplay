const test = require('node:test');
const assert = require('node:assert/strict');
const { clipName } = require('../lib/clip-name');
test('names clips with tournament, match, teams and map while retaining umlauts', () => {
    assert.equal(clipName({match: {tournament: 'Kiel', number: 4, team1: 'B\u00e4ren', team2: 'L\u00f6wen'}, map: 2}, 'Round_', 123), 'Kiel_4_B\u00e4ren_vs_L\u00f6wen_Map_2_Round_123.mp4');
});
test('removes path separators from supplied names', () => {
    assert.equal(clipName({match: {tournament: '../Cup'}, map: 1}, '', 1), '.._Cup_0_Team1_vs_Team2_Map_1_1.mp4');
});
