Installer Zapper
================

A Windows desktop app that scans your hard drives for installer files (.exe,
.msi, .msix, etc.) and moves them to the Recycle Bin to reclaim disk space.

Installer files are detected with a three-tier classifier: file extension,
filename patterns (setup*, *installer*, *redist*, *patch*, etc.), and binary
signature scanning for frameworks like Nullsoft, Inno Setup, InstallShield,
WiX, and Advanced Installer.


Features
--------

- Scans all fixed drives plus the Downloads folder (prioritised for fast
  initial results).
- Skips Windows system directories, Program Files, AppData, and game
  libraries (Steam, Epic, GOG, EA) to avoid flagging installed-app
  components.
- Classifies candidates in three tiers before flagging to minimise false
  positives.
- Deletions go to the Recycle Bin, not permanent deletion — everything is
  recoverable.
- Minimum file size threshold (100 KB) to filter out stub launchers.
- Dark-themed UI with sortable columns, filtering, and bulk selection.


Requirements
------------

- Windows 10 or 11
- Node.js 18+ (for building from source)


Build from source
-----------------

    npm install
    npm start          # run in development (no UAC — some dirs skipped)
    npm run build      # produce dist/Installer Zapper Setup 1.0.0.exe
    npm run build:dir  # produce unpacked app in dist/win-unpacked/


Tech stack
----------

- Electron 33
- Vanilla JS / HTML / CSS (no frontend framework)
- electron-builder (NSIS installer, UAC elevation via app manifest)


Security notes
--------------

- Uses Electron's standard security model: contextIsolation on,
  nodeIntegration off, sandbox off, all renderer-to-main communication
  through a preload contextBridge.
- Packaged app requests admin privileges via the NSIS manifest so it can
  scan directories like the root of C:\ and user profiles other than the
  current user. During `npm start` it runs without elevation and silently
  skips inaccessible directories.
- No network access. No telemetry. No external dependencies at runtime —
  only `electron` at build time.


Known limitations
-----------------

- Windows only. The drive enumeration uses WMIC with a PowerShell
  fallback; neither is available on macOS or Linux.
- The bundled icon is a placeholder. The build is unsigned, so Windows
  SmartScreen will show an "Unknown publisher" warning on first run.


Licence
-------

MIT. See LICENSE.
