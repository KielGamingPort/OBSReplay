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

## Match and map workflow

Set CHALLONGE_API_KEY in the server environment. Match setup loads numbered matches from the Challonge v1 API using a tournament ID (community tournaments use community-slug). Selecting a new match archives current clips and resets the map counter to 1. Next map archives round/raw and map clips, then increments the map counter. Match clips survive map transitions.

End tournament exports all archived matches, rounds, and current clips under REPLAY_ROOT/Exports. A manifest.json marks a completed export. Source files are retained, and failures can be retried. The export contains individual clips, not concatenated videos.

## Operator workspace and Companion

The desktop workspace fits a match at 1280×720 or larger without scrolling. Clip pages and previous/next selection remain available as backup controls; IN/OUT drafts are retained when switching clips. Companion commands go to one active panel, shown by `Companion aktiv`. Another panel can take over with `Companion übernehmen`; closing the active panel transfers control to the next connected panel. HTTP commands return 503 when no panel is connected.

Map cuts are available through `POST /api/remote/cut-map` and OSC `/replay/cut/map`, alongside round and match cuts. Reconnecting reloads the clip library, match state and totals, removing clips archived while the panel was offline.

Selections are encoded to H.264/AAC MP4 with accurate trim boundaries (x264 veryfast, CRF 18). Encoding uses more CPU than stream copying and introduces a generation of compression; originals are retained. In-progress files use `.partial` and become visible as completed MP4s only after encoding succeeds. A failed match/map cleanup must be retried with the original operation before a different transition can start.
