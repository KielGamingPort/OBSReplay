const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseEnv } = require('node:util');
const test = require('node:test');

test('Windows PowerShell writes separately loadable environment values', { skip: process.platform !== 'win32' }, () => {
    const source = fs.readFileSync(path.join(__dirname, '../scripts/setup.ps1'), 'utf8');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-setup-'));
    try {
        const environmentFile = path.join(directory, '.env');
        const script = path.join(directory, 'write.ps1');
        const block = source.match(/        \[string\[\]\]\$lines = @[\s\S]*?\[System.IO.File\]::WriteAllLines[^\n]*/)[0];
        fs.writeFileSync(script, `
function ConvertTo-EnvironmentValue([string]$Value) { return '"' + $Value + '"' }
$environmentFile = '${environmentFile.replaceAll("'", "''")}'
$ReplayRoot = 'C:\\Replay Test'
$BindAddress = '127.0.0.1'
$controlToken = 'test-control-token'
$obsPasswordBase64 = 'cGFzc3dvcmQ='
$ffmpegValue = 'C:\\Program Files\\ffmpeg.exe'
${block}
`);
        const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual({ ...parseEnv(fs.readFileSync(environmentFile, 'utf8')) }, {
            REPLAY_ROOT: 'C:\\Replay Test', HOST: '127.0.0.1', PORT: '3000',
            OSC_HOST: '127.0.0.1', CONTROL_TOKEN: 'test-control-token',
            OBS_PASSWORD_BASE64: 'cGFzc3dvcmQ=', FFMPEG_PATH: 'C:\\Program Files\\ffmpeg.exe'
        });
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
