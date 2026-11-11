function createRemoteControl() {
    const panels = new Map();
    let controllerId = null;
    function publish() {
        for (const panel of panels.values()) panel.emit('remote_control_status', { active: panel.id === controllerId });
    }
    return {
        add(panel) {
            panels.set(panel.id, panel);
            if (!controllerId) controllerId = panel.id;
            panel.on('claim_remote_control', () => {
                if (!panels.has(panel.id)) return;
                controllerId = panel.id;
                publish();
            });
            panel.on('disconnect', () => {
                panels.delete(panel.id);
                if (controllerId === panel.id) controllerId = panels.keys().next().value || null;
                publish();
            });
            publish();
        },
        dispatch(command) {
            const controller = panels.get(controllerId);
            if (!controller) return false;
            controller.emit('remote_command', command);
            return true;
        }
    };
}
module.exports = { createRemoteControl };
