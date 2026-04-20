const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { classify, CANDIDATE_EXTS } = require('./detector');

// ── Drive enumeration ─────────────────────────────────────────────────────────

function getDrives() {
  try {
    return getDrivesWmic();
  } catch {
    try {
      return getDrivesPowerShell();
    } catch {
      return ['C:\\'];
    }
  }
}

function getDrivesWmic() {
  const out = execSync('wmic logicaldisk get Caption,DriveType /format:csv', {
    timeout: 5000,
    encoding: 'utf8',
  });
  const drives = [];
  for (const line of out.split('\n')) {
    const parts = line.trim().split(',');
    // CSV columns: Node, Caption, DriveType
    if (parts.length >= 3) {
      const caption = parts[1].trim();
      const driveType = parseInt(parts[2].trim(), 10);
      if (driveType === 3 && /^[A-Z]:$/i.test(caption)) {
        drives.push(caption + '\\');
      }
    }
  }
  return drives.length ? drives : ['C:\\'];
}

function getDrivesPowerShell() {
  const out = execSync(
    'powershell -Command "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root"',
    { timeout: 8000, encoding: 'utf8' }
  );
  const drives = out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Z]:\\/i.test(l));
  return drives.length ? drives : ['C:\\'];
}

// ── Directories to skip entirely ──────────────────────────────────────────────

const SKIP_DIR_NAMES = new Set([
  // Windows OS internals
  'windows',
  'system32',
  'syswow64',
  'winsxs',
  'servicing',
  'assembly',
  'boot',
  'driverstore',

  // Installed application directories — these contain app components (updaters, uninstallers,
  // config wizards) that look like installers but must NOT be deleted.
  'program files',
  'program files (x86)',

  // User/system data caches — rarely contain standalone installers, high noise
  'programdata',
  'appdata',

  // System/recovery artefacts
  '$recycle.bin',
  '$winreagent',
  '$windows.~bt',
  '$windows.~ws',
  'system volume information',
  'recovery',
  'perflogs',
  'msocache',
]);

function shouldSkipDir(name) {
  return SKIP_DIR_NAMES.has(name.toLowerCase());
}

// ── Game platform detection ───────────────────────────────────────────────────
//
// Game directories frequently contain files named setup.exe, install.exe, etc.
// that are game-specific config/launcher tools — NOT standalone installers.
// We detect game directories two ways:
//
//   1. Path segment check (no I/O) — if a known game platform folder name appears
//      anywhere in the path, the whole subtree is a game library.
//
//   2. Marker file check (uses already-fetched readdir entries) — certain files
//      and folders are placed by game platforms in every game's root directory.

// If any of these folder names appear as a path SEGMENT (not just basename),
// everything under them is a game library — skip the whole subtree.
const GAME_PATH_SEGMENTS = new Set([
  'steamapps',     // Steam:      D:\Steam\steamapps\common\GameName\
  'steamlibrary',  // Common alt: D:\SteamLibrary\steamapps\...
]);

// Files/folders that game platforms place inside every individual game directory.
// If we find any of these while reading a directory's entries, skip it entirely.
const GAME_MARKER_FILES = new Set([
  'steam_api.dll',       // Steam (32-bit games)
  'steam_api64.dll',     // Steam (64-bit games)
  'installerdata.xml',   // EA App / Origin
]);

const GAME_MARKER_DIR_NAMES = new Set([
  '.egstore',    // Epic Games Store — present in every Epic game folder
  '__installer', // EA App / Origin
]);

const GAME_MARKER_PREFIXES = [
  'goggame-',    // GOG Galaxy — e.g. goggame-1234567890.info
];

/**
 * Returns true if the full directory path sits inside a known game library,
 * determined purely from the path string (zero extra I/O).
 */
function isGameLibraryPath(dirPath) {
  const lower = dirPath.toLowerCase();
  // Split on both separators and check each segment
  const segments = lower.split(/[\\/]/);
  return segments.some((seg) => GAME_PATH_SEGMENTS.has(seg));
}

/**
 * Returns true if the already-fetched directory entries contain a game platform
 * marker — meaning this directory is a game's root (or a subfolder of one).
 * Uses the entries array we already have from readdir, so no extra I/O.
 */
function hasGameMarkers(entries) {
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (entry.isFile() && GAME_MARKER_FILES.has(lower)) return true;
    if (entry.isDirectory() && GAME_MARKER_DIR_NAMES.has(lower)) return true;
    if (GAME_MARKER_PREFIXES.some((p) => lower.startsWith(p))) return true;
  }
  return false;
}

// ── Async recursive scanner ───────────────────────────────────────────────────

const BATCH_SIZE = 25;
const MIN_SIZE   = 100 * 1024; // 100 KB

/**
 * Recursively walk `drives`, detect installers, and stream batches to the renderer.
 *
 * Runs asynchronously so the main-process event loop stays live between directory
 * reads — this allows cancel IPC messages and progress events to be processed.
 *
 * @param {string[]} drives
 * @param {{ cancelled: boolean }} cancelToken
 * @param {(batch: object[]) => void} send
 * @returns {Promise<{ totalFound: number, totalBytes: number, cancelled: boolean }>}
 */
async function startScan(drives, cancelToken, send) {
  let totalFound = 0;
  let totalBytes = 0;
  let batch = [];

  // Tracks directories already walked so the Downloads pre-scan is never
  // double-counted when the full drive walk reaches the same path.
  const walkedDirs = new Set();

  function flush() {
    if (batch.length) {
      send([...batch]);
      batch = [];
    }
  }

  async function walkDir(dirPath) {
    if (cancelToken.cancelled) return;

    // De-duplicate: skip any path we have already walked (e.g. Downloads pre-scan)
    const dirKey = dirPath.toLowerCase();
    if (walkedDirs.has(dirKey)) return;
    walkedDirs.add(dirKey);

    // Path-segment check: bail immediately if inside a game library subtree
    if (isGameLibraryPath(dirPath)) return;

    let entries;
    try {
      entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return; // permission denied or other error — skip silently
    }

    // Marker-file check: skip game directories (steam_api.dll, .egstore, goggame-*, etc.)
    if (hasGameMarkers(entries)) return;

    for (const entry of entries) {
      if (cancelToken.cancelled) return;

      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          await walkDir(path.join(dirPath, entry.name));
        }
        continue;
      }

      if (!entry.isFile()) continue;

      // Fast extension pre-filter (no I/O)
      const dotIdx = entry.name.lastIndexOf('.');
      if (dotIdx === -1) continue;
      const ext = entry.name.slice(dotIdx).toLowerCase();
      if (!CANDIDATE_EXTS.has(ext)) continue;

      const fullPath = path.join(dirPath, entry.name);

      let size;
      try {
        size = (await fsp.stat(fullPath)).size;
      } catch {
        continue;
      }
      if (size < MIN_SIZE) continue;

      const result = classify(fullPath, size);
      if (!result) continue;

      totalFound++;
      totalBytes += size;

      batch.push({
        path: fullPath,
        name: entry.name,
        dir: dirPath,
        size: result.size,
        label: result.label,
      });

      if (batch.length >= BATCH_SIZE) flush();
    }
  }

  // ── Priority: scan Downloads first so results appear immediately ────────────
  const downloadsPath = path.join(os.homedir(), 'Downloads');
  const downloadsDrive = downloadsPath.slice(0, 3).toUpperCase(); // e.g. "C:\"
  if (drives.some((d) => d.toUpperCase() === downloadsDrive)) {
    await walkDir(downloadsPath);
    flush(); // push Downloads results to the renderer right away
  }

  // ── Full drive walk (Downloads is skipped via walkedDirs) ───────────────────
  for (const drive of drives) {
    if (cancelToken.cancelled) break;
    await walkDir(drive);
  }

  flush();
  return { totalFound, totalBytes, cancelled: cancelToken.cancelled };
}

module.exports = { getDrives, startScan };
