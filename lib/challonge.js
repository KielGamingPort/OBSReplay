const invalid = message => Object.assign(new Error(message), { status: 400 });
async function fetchMatch(tournament, id, { apiKey = process.env.CHALLONGE_API_KEY, request = fetch } = {}) {
    if (typeof tournament !== 'string' || !/^[\w-]+$/.test(tournament)) throw invalid('Invalid tournament ID');
    if (!Number.isSafeInteger(id) || id < 1) throw invalid('Invalid match ID');
    if (!apiKey) throw Object.assign(new Error('Set CHALLONGE_API_KEY on the server'), { status: 503 });
    const get = async suffix => {
        const url = new URL(`https://api.challonge.com/v1/tournaments/${tournament}${suffix}.json`);
        url.searchParams.set('api_key', apiKey);
        const response = await request(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw Object.assign(new Error('Could not load Challonge data'), { status: 502 });
        return response.json();
    };
    const [details, result, entries] = await Promise.all([get(''), get(`/matches/${id}`), get('/participants')]);
    const match = result.match;
    if (match?.id !== id || !details.tournament || !Array.isArray(entries)) throw new Error('Invalid Challonge response');
    const participants = entries.map(entry => entry.participant);
    const player = playerId => participants.find(p => p.id === playerId || p.group_player_ids?.includes(playerId)) || null;
    const player1 = player(match.player1_id);
    const player2 = player(match.player2_id);
    return {
        id, number: match.suggested_play_order || id,
        tournament: details.tournament.name || tournament,
        team1: player1?.display_name || player1?.name || 'TBD',
        team2: player2?.display_name || player2?.name || 'TBD',
        state: match.state,
        challonge: { tournamentId: tournament, tournament: details.tournament, match, player1, player2 }
    };
}
module.exports = { fetchMatch };
