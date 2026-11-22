# PulseDeck

A dark-first, glassmorphic Windows desktop music player with local library indexing, DSP audio analysis (BPM, Camelot musical key, ReplayGain, energy, waveform peaks, intro/outro cues), and Dual-Deck Web Audio Auto-DJ transitions.

## Prerequisites

- **Windows 10/11 (x64)**
- **Node.js LTS** (`C:\Program Files\nodejs`)

> **Note on `better-sqlite3`:** PulseDeck pins `electron@42.11.18` (Node ABI `146`) and `better-sqlite3@12.11.1` so `electron-rebuild` downloads the prebuilt Electron binary (`electron-v146-win32-x64`) without requiring Visual Studio C++ Build Tools or Python.

## Setup & Native Module Rebuild

```powershell
# Ensure Node.js is on PATH if running from a fresh shell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"

# Use npm.cmd in PowerShell if execution policy restricts npm.ps1
npm.cmd install
node node_modules/electron/install.js
npm.cmd run rebuild
```

Verify `better-sqlite3` and `music-metadata` load in Electron's Node runtime:

```powershell
$env:ELECTRON_RUN_AS_NODE = "1"
.\node_modules\.bin\electron.cmd -e "const D = require('better-sqlite3'); console.log(new D(':memory:').prepare('SELECT 1 AS ok').get());"
```

## Development

```powershell
npm.cmd run dev
```

## Typechecking & Tests

```powershell
npm.cmd run typecheck
npm.cmd test
```

## Production Build & Windows Packaging

```powershell
npm.cmd run build
npm.cmd run package:win
```

Output installers (`nsis` and `portable`) are generated in `dist/`.
