function component(value, fallback, maxBytes) {
    const clean = (typeof value === 'string' ? value : fallback)
        .normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    let result = '';
    for (const character of clean) {
        const bytes = Buffer.byteLength(character, 'utf8');
        if (bytes > maxBytes) break;
        result += character;
        maxBytes -= bytes;
    }
    return result.replace(/[ .]+$/g, '') || fallback;
}

function clipName(state, prefix, timestamp = Date.now()) {
    const match = state.match || {};
    const number = Number.isSafeInteger(match.number) && match.number > 0 ? match.number : 0;
    const map = Number.isSafeInteger(state.map) && state.map > 0 ? state.map : 1;
    const suffix = `_Map_${map}_${prefix}${timestamp}.mp4`;
    // Reserve all separators and identifiers, then share the remaining bytes
    // between display names. Count UTF-8 bytes without splitting code points.
    const nameBudget = Math.floor((200 - Buffer.byteLength(`_${number}__vs_${suffix}`, 'utf8')) / 3);
    return `${component(match.tournament, 'Tournament', nameBudget)}_${number}_${component(match.team1, 'Team1', nameBudget)}_vs_${component(match.team2, 'Team2', nameBudget)}${suffix}`;
}

module.exports = { clipName };
