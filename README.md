# OBS Replay

Lokales Replay-Dashboard für OBS, Stream Deck/Companion und OSC.

## Einrichtung unter Windows

Voraussetzungen: Node.js 22.22 oder neuer, OBS mit aktiviertem WebSocket-Server und Windows Package Manager (`winget`).

```powershell
npm run setup
npm start
```

Das Setup installiert die Node-Abhängigkeiten, installiert ffmpeg über `Gyan.FFmpeg`, erstellt die Ordner unter `C:\Live-Replays` und legt eine nicht versionierte `.env` mit einem zufälligen Zugriffstoken an. Eine vorhandene `.env` wird nicht überschrieben.

Das Dashboard ist standardmäßig nur unter `http://127.0.0.1:3000` erreichbar. Für einen absichtlich freigegebenen LAN-Betrieb müssen `HOST` und gegebenenfalls `OSC_HOST` in `.env` gesetzt sowie Firewall und Zugriffstoken passend konfiguriert werden.

Auf dem lokalen Rechner öffnet sich das Panel unter `http://localhost:3000` oder `http://127.0.0.1:3000` ohne Zugriffstoken. Dies gilt auch für API, Videos und Socket.IO über Loopback (IPv4/IPv6). Zugriffe über eine LAN-Adresse benötigen weiterhin den Token. Lokale Reverse-Proxys dürfen keine entfernten Clients als Loopback-Anfragen mit lokalem Host und ohne fremden Origin weiterleiten. `CONTROL_TOKEN` bleibt für entfernte Clients erforderlich.

Companion-Aufrufe verwenden `POST` und senden das Token aus `.env` entweder als `Authorization: Bearer <token>` oder `X-Replay-Token: <token>`.

## Entwicklung

```powershell
npm test
```

The dashboard accepts MP4, MKV, MOV and M4V replay containers with browser-compatible codecs (such as H.264/AAC). FLV and MPEG-TS must be remuxed to MP4 in OBS before use; they are excluded because the browser player cannot load those containers.

OBS connection settings saved in the web interface persist across server restarts in .obs-settings.json in the application directory. Saved values override OBS_URL and OBS_PASSWORD defaults. Delete this file to return to environment defaults. The file contains the OBS password; restrict access to the application directory and include it only in private backups. A failed disk write is reported as a settings update failure.
