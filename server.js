const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const OBSWebSocket = require('obs-websocket-js').default;
const chokidar = require('chokidar');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const BACKUP_DIR = 'C:/Live-Replays/Backups';

// --- KONFIGURATION ---
const OBS_PASSWORD = 'GmRgmHIMIANBHFGA'; // <-- HIER PASSWORT EINTRAGEN
const RAW_DIR = 'C:/Live-Replays/Raw';
const HIGHLIGHTS_ROUND = 'C:/Live-Replays/Highlights_Round';
const HIGHLIGHTS_MATCH = 'C:/Live-Replays/Highlights_Match';
const PORT = 3000;
const ffmpegPath = path.join(__dirname, 'ffmpeg.exe');

// Ordner automatisch erstellen, falls sie nicht existieren
[RAW_DIR, HIGHLIGHTS_ROUND, HIGHLIGHTS_MATCH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const obs = new OBSWebSocket();

app.use(express.static(__dirname));
app.use('/raw_videos', express.static(RAW_DIR));

// --- NEU: STREAM DECK / COMPANION API ---
// Wenn Companion diese URL aufruft, speichert OBS den Puffer
app.get('/api/save-buffer', async (req, res) => {
    console.log('🕹️ Stream Deck Befehl: Replay speichern');
    try {
        await obs.call('SaveReplayBuffer');
        res.send('OK');
    } catch (error) {
        res.status(500).send(error.message);
    }
});
// Universal-Route für alle anderen Stream Deck Buttons
app.get('/api/remote/:command', (req, res) => {
    const cmd = req.params.command;
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
        try { await obs.call('SaveReplayBuffer'); } catch (err) { }
    });

    socket.on('cut_video', (data) => {
        const { fileName, inTime, outTime, target } = data;

        // Zielordner bestimmen
        const targetDir = target === 'match' ? HIGHLIGHTS_MATCH : HIGHLIGHTS_ROUND;
        const prefix = target === 'match' ? 'MATCH_' : 'ROUND_';

        const inputFile = path.join(RAW_DIR, fileName);
        const outputFile = path.join(targetDir, `${prefix}${Date.now()}.mp4`);

        console.log(`✂️ Schneide für ${target.toUpperCase()}: ${fileName}`);

        const cmd = `"${ffmpegPath}" -i "${inputFile}" -ss ${inTime} -to ${outTime} -c copy -y "${outputFile}"`;

        exec(cmd, (error) => {
            if (error) {
                socket.emit('cut_error', error.message);
                return;
            }
            socket.emit('cut_success', { file: path.basename(outputFile), target: target });
        });
    });
});

server.listen(PORT, () => {
    console.log(`🚀 System läuft auf http://localhost:${PORT}`);
});
// --- OSC FERNSTEUERUNG FÜR COMPANION ---
const osc = require('osc');

const udpPort = new osc.UDPPort({
    localAddress: "0.0.0.0",
    localPort: 3333 // Auf diesem Port lauschen wir für das Stream Deck
});

udpPort.on("message", function (oscMsg) {
    console.log("🕹️ OSC Befehl empfangen:", oscMsg.address);

    // Routen der OSC-Adressen zu unseren Funktionen
    if (oscMsg.address === "/replay/save") {
        obs.call('SaveReplayBuffer').catch(err => console.error(err));
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
        performRoundReset();
    }
});

// --- RUNDEN-RESET & ARCHIVIERUNG ---
function performRoundReset() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const currentBackupPath = path.join(BACKUP_DIR, `Runde_${timestamp}`);

    console.log(`🧹 Starte Runden-Reset... Archiviere nach: ${currentBackupPath}`);

    try {
        // 1. Backup-Ordner für diese Runde erstellen
        const rawBackup = path.join(currentBackupPath, 'Raw');
        const roundBackup = path.join(currentBackupPath, 'Highlights_Round');
        fs.mkdirSync(rawBackup, { recursive: true });
        fs.mkdirSync(roundBackup, { recursive: true });

        // 2. Roh-Clips verschieben (statt kopieren, damit der Ordner leer wird)
        if (fs.existsSync(RAW_DIR)) {
            fs.readdirSync(RAW_DIR).forEach(file => {
                if (file.endsWith('.mp4')) {
                    fs.renameSync(path.join(RAW_DIR, file), path.join(rawBackup, file));
                }
            });
        }

        // 3. Runden-Highlights verschieben (Match-Highlights bleiben unberührt!)
        if (fs.existsSync(HIGHLIGHTS_ROUND)) {
            fs.readdirSync(HIGHLIGHTS_ROUND).forEach(file => {
                if (file.endsWith('.mp4')) {
                    fs.renameSync(path.join(HIGHLIGHTS_ROUND, file), path.join(roundBackup, file));
                }
            });
        }

        // 4. Signal an alle verbundenen Web-Dashboards senden, um die UI zu leeren
        io.emit('reset_dashboard');
        console.log('✅ Runden-Reset erfolgreich abgeschlossen!');
    } catch (err) {
        console.error('❌ Fehler beim Runden-Reset:', err.message);
    }
}

// HTTP-Route für das Web-Dashboard
app.get('/api/reset-round', (req, res) => {
    performRoundReset();
    res.send('OK');
});


udpPort.open();