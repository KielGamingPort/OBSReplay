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
const { createReplaySaveGuard } = require('./lib/replay-save-guard');
const BACKUP_DIR = 'C:/Live-Replays/Backups';

// --- KONFIGURATION ---
const OBS_PASSWORD = process.env.OBS_PASSWORD;
const CONTROL_TOKEN = process.env.CONTROL_TOKEN;
const RAW_DIR = 'C:/Live-Replays/Raw';
const HIGHLIGHTS_ROUND = 'C:/Live-Replays/Highlights_Round';
const HIGHLIGHTS_MATCH = 'C:/Live-Replays/Highlights_Match';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const OSC_HOST = process.env.OSC_HOST || '127.0.0.1';
const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');

// Ordner automatisch erstellen, falls sie nicht existieren
[RAW_DIR, HIGHLIGHTS_ROUND, HIGHLIGHTS_MATCH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const obs = new OBSWebSocket();
const access = createAccessControl(CONTROL_TOKEN);
const activeCuts = new Set();
const replaySaveGuard = createReplaySaveGuard(() => obs.call('SaveReplayBuffer'));
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
    console.log('🕹️ Stream Deck Befehl: Replay speichern');
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
    console.log(`🕹️ Stream Deck Fernsteuerung: ${cmd}`);
    // Leitet den Befehl live an den Webbrowser weiter
    io.emit('remote_command', cmd);
    res.send('OK');
});

// Liefert alle bisherigen Clips für die Web-Galerie
app.get('/api/files', (req, res) => {
    const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.mp4'));
    res.json(files);
});

// --- OBS VERBINDUNG ---
async function connectOBS() {
    try {
        await obs.connect('ws://127.0.0.1:4455', OBS_PASSWORD);
        console.log('✅ Erfolgreich mit OBS verbunden!');
    } catch (error) {
        console.error('❌ OBS Verbindungsfehler:', error.message);
    }
}
connectOBS();

// --- ORDNER ÜBERWACHUNG ---
chokidar.watch(RAW_DIR, {
    ignored: /(^|[\/\\])\../,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 200 }
}).on('add', (filePath) => {
    const fileName = path.basename(filePath);
    console.log(`🎥 Neues Replay fertig: ${fileName}`);
    io.emit('new_replay_available', fileName);
});

// --- WEB-DASHBOARD LOGIK ---
io.on('connection', (socket) => {
    socket.on('trigger_replay', async () => {
        try {
            await replaySaveGuard.saveReplay();
        } catch (error) {
            socket.emit('replay_error', error.message);
        }
    });

    socket.on('cut_video', (data) => {
        if (replaySaveGuard.isResetInProgress()) {
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

        console.log(`✂️ Schneide für ${cut.target.toUpperCase()}: ${cut.fileName}`);

        const child = execFile(ffmpegPath, buildFfmpegArgs(cut, outputFile), { windowsHide: true }, (error) => {
            activeCuts.delete(child);
            if (error) {
                socket.emit('cut_error', error.message);
                return;
            }
            socket.emit('cut_success', { file: path.basename(outputFile), target: cut.target });
        });
        activeCuts.add(child);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`🚀 System läuft auf http://${HOST}:${PORT}`);
});
// --- OSC FERNSTEUERUNG FÜR COMPANION ---
const osc = require('osc');

const udpPort = new osc.UDPPort({
    localAddress: OSC_HOST,
    localPort: 3333 // Auf diesem Port lauschen wir für das Stream Deck
});

udpPort.on("message", function (oscMsg) {
    console.log("🕹️ OSC Befehl empfangen:", oscMsg.address);

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
        performRoundReset().catch(err => console.error('❌ Fehler beim Runden-Reset:', err.message));
    }
});

// --- RUNDEN-RESET & ARCHIVIERUNG ---
async function performRoundReset() {
    if (activeCuts.size > 0) {
        const error = new Error('Der Runden-Reset wartet auf laufende Video-Schnitte.');
        error.statusCode = 409;
        throw error;
    }

    replaySaveGuard.beginReset();
    console.log('🧹 Starte Runden-Reset...');
    try {
        const result = await archiveRound({
            rawDirectory: RAW_DIR,
            highlightsDirectory: HIGHLIGHTS_ROUND,
            backupDirectory: BACKUP_DIR
        });
        io.emit('reset_dashboard');
        console.log(`✅ Runden-Reset erfolgreich abgeschlossen: ${result.backupPath}`);
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
        console.error('❌ Fehler beim Runden-Reset:', error.message);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});


udpPort.open();
