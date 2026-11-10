async function handleReplayTrigger(saveReplay, acknowledge) {
    const sendAcknowledgement = typeof acknowledge === 'function' ? acknowledge : () => {};
    try {
        await saveReplay();
        sendAcknowledgement({ ok: true });
    } catch (error) {
        sendAcknowledgement({ ok: false, error: error.message });
    }
}

module.exports = { handleReplayTrigger };
