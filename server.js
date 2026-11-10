const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const OBSWebSocket = require('obs-websocket-js').default;
const chokidar = require('chokidar');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { buildFfmpegArgs, validateCutRequest } = require('./lib/cut-video');
const { createAccessControl } = require('./lib/auth');
const { archiveRound } = require('./lib/round-reset');
const { isVideoFile } = require('./lib/video-files');
const { createReplaySaveGuard } = require('./lib/replay-save-guard');
const { createObsController } = require('./lib/obs-controller');
const { readObsPassword } = require('./lib/environment');
const { handleReplayTrigger } = require('./lib/replay-trigger');
const { listReplayFiles } = require('./lib/replay-files');

// --- KONFIGURATION ---
const { createSettingsStore } = require('./lib/obs-settings');
const settingsStore = createSettingsStore(path.join(__dirname, '.obs-settings.json'), {
    url: process.env.OBS_URL || 'ws://127.0.0.1:4455',
    password: readObsPassword() || ''
});
const CONTROL_TOKEN = process.env.CONTROL_TOKEN;
const REPLAY_ROOT = process.env.REPLAY_ROOT || 'C:/Live-Replays';
const RAW_DIR = process.env.RAW_DIR || path.join(REPLAY_ROOT, 'Raw');
const HIGHLIGHTS_ROUND = process.env.HIGHLIGHTS_ROUND || path.join(REPLAY_ROOT, 'Highlights_Round');
const HIGHLIGHTS_MATCH = process.env.HIGHLIGHTS_MATCH || path.join(REPLAY_ROOT, 'Highlights_Match');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(REPLAY_ROOT, 'Backups');
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const OSC_HOST = process.env.OSC_HOST || '127.0.0.1';
const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

// Ordner automatisch erstellen, falls sie nicht existieren
[RAW_DIR, HIGHLIGHTS_ROUND, HIGHLIGHTS_MATCH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const obs = new OBSWebSocket();
const obsController = createObsController({
    client: obs,
    persistSettings: settings => settingsStore.save(settings),
    ...settingsStore.get(),
    onStatus(status) {
        io.emit('obs_status', status);
        if (status.connected) console.log(' Erfolgreich mit OBS verbunden!');
        else if (status.error) console.error(' OBS Verbindungsfehler:', status.error);
    }
});
const access = createAccessControl(CONTROL_TOKEN);
const activeCuts = new Set();
const replaySaveGuard = createReplaySaveGuard(() => obsController.call('SaveReplayBuffer'));
const publicDirectory = path.join(__dirname, 'public');
const remoteCommands = new Set([
    'set-in', 'set-out', 'cut-round', 'cut-match', 'play-pause',
    'next-clip', 'prev-clip', 'ff-start', 'rw-start', 'seek-stop'
]);

app.use(express.json({ limit: '4kb' }));
app.get('/', (_req, res) => res.sendFile(path.join(publicDirectory, 'index.html')));

app.post('/api/session', (req, res) => {
    if (!access.establishSession(req, res)) {
        res.status(401).json({ error: 'Ungültiger Zugriffstoken.' });
        return;
    }
    res.sendStatus(204);
});

function requireHttpAuth(req, res, next) {
    if (access.requestIsAuthorized(req)) {
        next();
        return;
    }
    res.status(401).json({ error: 'Authentifizierung erforderlich.' });
}

app.use('/api', requireHttpAuth);
app.get('/api/session', (_req, res) => res.sendStatus(204));
app.get('/api/obs-settings', (_req, res) => res.json(obsController.getSettings()));
app.put('/api/obs-settings', async (req, res) => {
    const { url, password } = req.body || {};
    try {
        const parsed = new URL(url);
        if (typeof url !== 'string' || !['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || (password !== undefined && typeof password !== 'string')) throw new Error();
    } catch { return res.status(400).json({ error: 'Invalid WebSocket URL or password.' }); }
    try { res.json(await obsController.configure({ url, password })); }
    catch (error) { res.status(error.statusCode || 500).json({ error: 'Could not update OBS connection.' }); }
});
app.use('/raw_videos', requireHttpAuth, express.static(RAW_DIR));

io.use((socket, next) => {
    if (access.socketIsAuthorized(socket)) {
        next();
        return;
    }
    next(new Error('Authentifizierung erforderlich.'));
});

// --- NEU: STREAM DECK / COMPANION API ---
// Wenn Companion diese URL aufruft, speichert OBS den Puffer
app.post('/api/save-buffer', async (req, res) => {
    console.log(' Stream Deck Befehl: Replay speichern');
    try {
        await replaySaveGuard.saveReplay();
        res.send('OK');
    } catch (error) {
        res.status(error.statusCode || 500).send(error.message);
    }
});
// Universal-Route für alle anderen Stream Deck Buttons
app.post('/api/remote/:command', (req, res) => {
    const cmd = req.params.command;
    if (!remoteCommands.has(cmd)) {
        res.status(400).json({ error: 'Unbekannter Fernsteuerungsbefehl.' });
        return;
    }
    console.log(` Stream Deck Fernsteuerung: ${cmd}`);
    // Leitet den Befehl live an den Webbrowser weiter
    io.emit('remote_command', cmd);
    res.send('OK');
});

// Liefert alle bisherigen Clips für die Web-Galerie
app.get('/api/files', async (_req, res) => {
    res.json(await listReplayFiles(RAW_DIR));
});

// Probe the saved files so totals also include clips from earlier sessions.
app.get('/api/clip-durations', async (_req, res) => {
    try {
        const totals = {};
        for (const [target, directory] of Object.entries({ round: HIGHLIGHTS_ROUND, match: HIGHLIGHTS_MATCH })) {
            let seconds = 0;
            const entries = await fs.promises.readdir(directory, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile() || !isVideoFile(entry.name)) continue;
                const duration = await new Promise((resolve, reject) => {
                    execFile(process.env.FFPROBE_PATH || path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
                        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(directory, entry.name)],
                        { windowsHide: true }, (error, stdout) => {
                            const value = Number(stdout.trim());
                            if (error || !stdout.trim() || !Number.isFinite(value) || value < 0) reject(error || new Error('Invalid video duration'));
                            else resolve(value);
                        });
                });
                seconds += duration;
            }
            totals[target] = seconds;
        }
        res.set('Cache-Control', 'no-store').json(totals);
    } catch {
        res.status(503).json({ error: 'Clip durations unavailable. Check FFPROBE_PATH.' });
    }
});

// Match state is stored on disk before acknowledging a transition.
const { createMatchStore } = require('./lib/match-state');
const matchStore = createMatchStore(REPLAY_ROOT, HIGHLIGHTS_MATCH);
app.get('/api/match', (_req, res) => res.json(matchStore.get()));
app.get('/api/challonge/matches', async (req, res) => {
    const tournament = req.query.tournament;
    if (typeof tournament !== 'string' || !/^[\w-]+$/.test(tournament)) return res.status(400).json({ error: 'Invalid tournament ID' });
    if (!process.env.CHALLONGE_API_KEY) return res.status(503).json({ error: 'Set CHALLONGE_API_KEY on the server' });
    try {
        const url = new URL(`https://api.challonge.com/v1/tournaments/${tournament}/matches.json`);
        url.searchParams.set('api_key', process.env.CHALLONGE_API_KEY);
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error();
        const matches = (await response.json()).map(({ match }) => ({ id: match.id, number: match.suggested_play_order, state: match.state }));
        res.json(matches);
    } catch { res.status(502).json({ error: 'Could not load Challonge matches' }); }
});
let transitionBusy = false;
app.post('/api/match', async (req, res) => {
    if (transitionBusy || activeCuts.size || replaySaveGuard.isResetInProgress()) return res.status(409).json({ error: 'Replay operation in progress' });
    const match = req.body;
    if (!Number.isSafeInteger(match?.id) || match.id < 1 || !Number.isSafeInteger(match.number) || match.number < 1) return res.status(400).json({ error: 'Select a numbered Challonge match' });
    transitionBusy = true;
    try {
        if (!matchStore.hasPending()) await performRoundReset();
        await matchStore.transition(match);
        io.emit('match_state', matchStore.get());
        io.emit('clip_durations_changed');
        res.json(matchStore.get());
    } catch { res.status(500).json({ error: 'Match transition failed; archived clips retained' }); }
    finally { transitionBusy = false; }
});

// --- OBS VERBINDUNG ---
obsController.start();

// --- ORDNER ÜBERWACHUNG ---
chokidar.watch(RAW_DIR, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 }
}).on('add', (filePath) => {
    const fileName = path.basename(filePath);
    if (!isVideoFile(fileName)) return;
    console.log(` Neues Replay fertig: ${fileName}`);
    io.emit('new_replay_available', fileName);
});

// --- WEB-DASHBOARD LOGIK ---
io.on('connection', (socket) => {
    socket.emit('obs_status', obsController.getStatus());
    socket.on('trigger_replay', (acknowledge) => handleReplayTrigger(
        () => replaySaveGuard.saveReplay(),
        acknowledge
    ));

    socket.on('cut_video', (data) => {
        if (transitionBusy || matchStore.hasPending() || replaySaveGuard.isResetInProgress()) {
            socket.emit('cut_error', 'Während des Runden-Resets kann kein Schnitt gestartet werden.');
            return;
        }

        let cut;
        try {
            cut = validateCutRequest(data, RAW_DIR);
        } catch (error) {
            socket.emit('cut_error', error.message);
            return;
        }

        const targetDir = cut.directoryKey === 'match' ? HIGHLIGHTS_MATCH : HIGHLIGHTS_ROUND;
        const outputFile = path.join(targetDir, `${cut.prefix}${Date.now()}.mp4`);

        console.log(` Schneide für ${cut.target.toUpperCase()}: ${cut.fileName}`);

        const child = execFile(ffmpegPath, buildFfmpegArgs(cut, outputFile), { windowsHide: true }, (error) => {
            activeCuts.delete(child);
            if (error) {
                socket.emit('cut_error', error.message);
                return;
            }
            io.emit('clip_durations_changed');
            socket.emit('cut_success', { file: path.basename(outputFile), target: cut.target });
        });
        activeCuts.add(child);
    });
});

server.listen(PORT, HOST, () => {
    console.log(` System läuft auf http://${HOST}:${PORT}`);
});
// --- OSC FERNSTEUERUNG FÜR COMPANION ---
const osc = require('osc');

const udpPort = new osc.UDPPort({
    localAddress: OSC_HOST,
    localPort: 3333 // Auf diesem Port lauschen wir für das Stream Deck
});

udpPort.on("message", function (oscMsg) {
    console.log(" OSC Befehl empfangen:", oscMsg.address);

    // Routen der OSC-Adressen zu unseren Funktionen
    if (oscMsg.address === "/replay/save") {
        replaySaveGuard.saveReplay().catch(err => console.error(err));
    } else if (oscMsg.address === "/replay/in") {
        io.emit('remote_command', 'set-in');
    } else if (oscMsg.address === "/replay/out") {
        io.emit('remote_command', 'set-out');
    } else if (oscMsg.address === "/replay/cut/round") {
        io.emit('remote_command', 'cut-round');
    } else if (oscMsg.address === "/replay/cut/match") {
        io.emit('remote_command', 'cut-match');
    } else if (oscMsg.address === "/replay/playpause") {
        io.emit('remote_command', 'play-pause');
        // --- NEU: DYNAMISCHES SPULEN ---
    } else if (oscMsg.address === "/replay/ff/start") {
        io.emit('remote_command', 'ff-start');
    } else if (oscMsg.address === "/replay/rw/start") {
        io.emit('remote_command', 'rw-start');
    } else if (oscMsg.address === "/replay/seek/stop") {
        io.emit('remote_command', 'seek-stop');
    } else if (oscMsg.address === "/replay/reset") {
        performRoundReset().catch(err => console.error(' Fehler beim Runden-Reset:', err.message));
    }
});

// --- RUNDEN-RESET & ARCHIVIERUNG ---
async function performRoundReset() {
    if (matchStore.hasPending() || activeCuts.size > 0) {
        const error = new Error('Der Runden-Reset wartet auf laufende Video-Schnitte.');
        error.statusCode = 409;
        throw error;
    }

    replaySaveGuard.beginReset();
    console.log(' Starte Runden-Reset...');
    try {
        const result = await archiveRound({
            rawDirectory: RAW_DIR,
            highlightsDirectory: HIGHLIGHTS_ROUND,
            backupDirectory: BACKUP_DIR
        });
        io.emit('reset_dashboard');
        console.log(` Runden-Reset erfolgreich abgeschlossen: ${result.backupPath}`);
        return result;
    } finally {
        replaySaveGuard.endReset();
    }
}

// HTTP-Route für das Web-Dashboard
app.post('/api/reset-round', async (_req, res) => {
    try {
        const result = await performRoundReset();
        res.json(result);
    } catch (error) {
        console.error(' Fehler beim Runden-Reset:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});


udpPort.open();
