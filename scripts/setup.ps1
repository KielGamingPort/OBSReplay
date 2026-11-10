[CmdletBinding()]
param(
    [string]$ReplayRoot = 'C:\Live-Replays',
    [string]$ObsPassword = '',
    [string]$BindAddress = '127.0.0.1',
    [switch]$SkipFfmpegInstall
)

$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$environmentFile = Join-Path $projectDirectory '.env'

function Assert-LastCommand([string]$Description) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Description ist mit Exit-Code $LASTEXITCODE fehlgeschlagen."
    }
}

function ConvertTo-EnvironmentValue([string]$Value) {
    if ($Value.Contains("`r") -or $Value.Contains("`n")) {
        throw 'Konfigurationswerte dürfen keine Zeilenumbrüche enthalten.'
    }
    # Node expands backslash-n/backslash-r inside double-quoted dotenv values.
    foreach ($delimiter in @("'", '`', '"')) {
        if (-not $Value.Contains($delimiter)) {
            if ($delimiter -eq '"' -and ($Value.Contains('\n') -or $Value.Contains('\r'))) {
                continue
            }
            return $delimiter + $Value + $delimiter
        }
    }
    throw 'Konfigurationswert kann nicht verlustfrei als dotenv-Wert gespeichert werden.'
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    throw 'Node.js >= 22.22 ist erforderlich.'
}
$nodeVersion = [version]((& node --version).Trim().TrimStart('v').Split('-')[0])
if ($nodeVersion -lt [version]'22.22.0') {
    throw "Node.js >= 22.22 ist erforderlich; gefunden wurde $nodeVersion."
}

Push-Location $projectDirectory
try {
    & npm ci --ignore-scripts
    Assert-LastCommand 'npm ci'

    $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    if (-not $ffmpegCommand -and -not $SkipFfmpegInstall) {
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
            throw 'ffmpeg fehlt und winget wurde nicht gefunden. Installiere Gyan.FFmpeg oder nutze FFMPEG_PATH.'
        }
        & winget install --id Gyan.FFmpeg --exact --accept-package-agreements --accept-source-agreements
        Assert-LastCommand 'ffmpeg-Installation'
        $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $env:Path = (@($env:Path, $machinePath, $userPath) | Where-Object { $_ }) -join ';'
        $ffmpegCommand = Get-Command ffmpeg.exe -ErrorAction SilentlyContinue
    }
    if (-not $ffmpegCommand) {
        if ($SkipFfmpegInstall) {
            throw 'ffmpeg wurde nicht gefunden. Entferne -SkipFfmpegInstall oder setze FFMPEG_PATH manuell.'
        }
        throw 'ffmpeg wurde nach der Installation nicht gefunden. Öffne ein neues Terminal oder setze FFMPEG_PATH manuell.'
    }

    @('Raw', 'Highlights_Round', 'Highlights_Match', 'Backups') | ForEach-Object {
        New-Item -ItemType Directory -Force -Path (Join-Path $ReplayRoot $_) | Out-Null
    }

    if (-not (Test-Path -LiteralPath $environmentFile)) {
        $tokenBytes = New-Object byte[] 32
        $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $generator.GetBytes($tokenBytes)
        } finally {
            $generator.Dispose()
        }
        $controlToken = [Convert]::ToBase64String($tokenBytes)
        $obsPasswordBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($ObsPassword))
        $ffmpegValue = $ffmpegCommand.Source
        [string[]]$lines = @(
            'REPLAY_ROOT=' + (ConvertTo-EnvironmentValue $ReplayRoot)
            'HOST=' + (ConvertTo-EnvironmentValue $BindAddress)
            'PORT=3000'
            'OSC_HOST=' + (ConvertTo-EnvironmentValue $BindAddress)
            'CONTROL_TOKEN=' + (ConvertTo-EnvironmentValue $controlToken)
            'OBS_PASSWORD_BASE64=' + (ConvertTo-EnvironmentValue $obsPasswordBase64)
            'FFMPEG_PATH=' + (ConvertTo-EnvironmentValue $ffmpegValue)
        )
        [System.IO.File]::WriteAllLines($environmentFile, $lines, [System.Text.UTF8Encoding]::new($false))
        Write-Host "Konfiguration erstellt: $environmentFile"
        Write-Host "Dashboard-Zugriffstoken: $controlToken"
    } else {
        Write-Host "Vorhandene Konfiguration bleibt unverändert: $environmentFile"
    }

    Write-Host 'Setup abgeschlossen. Starte die Anwendung mit: npm start'
} finally {
    Pop-Location
}
