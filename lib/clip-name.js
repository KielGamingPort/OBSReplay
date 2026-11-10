function component(value, fallback) {
    return String(value || fallback).normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/g, '') || fallback;
}

function clipName(state, prefix, timestamp = Date.now()) {
    const match = state.match || {};
    const stem = `${component(match.tournament, 'Tournament')}_${component(match.number, '0')}_${component(match.team1, 'Team1')}_vs_${component(match.team2, 'Team2')}_Map_${state.map || 1}`;
    return `${stem}_${prefix}${timestamp}.mp4`;
}

module.exports = { clipName };
