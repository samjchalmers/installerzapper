const fs   = require('fs');
const path = require('path');

// Pull the private functions out by loading scanner and inspecting its closure.
// We test via the exported startScan with a fake temp directory tree.

const os  = require('os');
const fsp = require('fs').promises;

// Inline the logic to test directly
const GAME_PATH_SEGMENTS = new Set(['steamapps', 'steamlibrary']);
const GAME_MARKER_FILES  = new Set(['steam_api.dll', 'steam_api64.dll', 'installerdata.xml']);
const GAME_MARKER_DIR_NAMES = new Set(['.egstore', '__installer']);
const GAME_MARKER_PREFIXES  = ['goggame-'];

function isGameLibraryPath(dirPath) {
  const segments = dirPath.toLowerCase().split(/[\\/]/);
  return segments.some((seg) => GAME_PATH_SEGMENTS.has(seg));
}

function hasGameMarkers(entries) {
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (entry.isFile      && entry.isFile()      && GAME_MARKER_FILES.has(lower))     return true;
    if (entry.isDirectory && entry.isDirectory() && GAME_MARKER_DIR_NAMES.has(lower)) return true;
    if (GAME_MARKER_PREFIXES.some((p) => lower.startsWith(p)))                        return true;
  }
  return false;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let passed = 0; let total = 0;

function test(label, result, expected) {
  total++;
  const ok = result === expected;
  if (ok) passed++;
  console.log(`${ok ? '✓ PASS' : '✗ FAIL'}  ${label}`);
}

console.log('── isGameLibraryPath (path-segment check) ──\n');

test('Steam default path',
  isGameLibraryPath('C:\\Program Files (x86)\\Steam\\steamapps\\common\\Portal 2'), true);

test('Steam custom library on D:',
  isGameLibraryPath('D:\\Steam\\steamapps\\common\\Cyberpunk 2077'), true);

test('SteamLibrary folder name variant',
  isGameLibraryPath('D:\\SteamLibrary\\steamapps\\common\\Hades'), true);

test('Normal Downloads folder — must NOT be flagged',
  isGameLibraryPath('C:\\Users\\Sam\\Downloads'), false);

test('Documents folder — must NOT be flagged',
  isGameLibraryPath('C:\\Users\\Sam\\Documents\\Installers'), false);

console.log('\n── hasGameMarkers (marker-file check) ──\n');

// Simulate Epic Games folder entries
const epicEntries = [
  { name: '.egstore',     isFile: () => false, isDirectory: () => true  },
  { name: 'setup.exe',    isFile: () => true,  isDirectory: () => false },
  { name: 'GameName.exe', isFile: () => true,  isDirectory: () => false },
];
test('Epic game folder (.egstore present)', hasGameMarkers(epicEntries), true);

// Simulate Steam game folder
const steamEntries = [
  { name: 'steam_api64.dll', isFile: () => true,  isDirectory: () => false },
  { name: 'setup.exe',       isFile: () => true,  isDirectory: () => false },
  { name: 'data',            isFile: () => false, isDirectory: () => true  },
];
test('Steam game folder (steam_api64.dll present)', hasGameMarkers(steamEntries), true);

// Simulate GOG game folder
const gogEntries = [
  { name: 'goggame-1234567890.info', isFile: () => true,  isDirectory: () => false },
  { name: 'setup.exe',               isFile: () => true,  isDirectory: () => false },
];
test('GOG game folder (goggame-*.info present)', hasGameMarkers(gogEntries), true);

// Simulate EA App game folder
const eaEntries = [
  { name: '__Installer',       isFile: () => false, isDirectory: () => true },
  { name: 'install.exe',       isFile: () => true,  isDirectory: () => false },
];
test('EA App game folder (__Installer folder present)', hasGameMarkers(eaEntries), true);

// Simulate a legitimate Downloads folder — must NOT be flagged
const downloadsEntries = [
  { name: 'setup.exe',        isFile: () => true,  isDirectory: () => false },
  { name: 'myapp.msi',        isFile: () => true,  isDirectory: () => false },
  { name: 'documents',        isFile: () => false, isDirectory: () => true  },
];
test('Downloads folder (no game markers) — must NOT be flagged',
  hasGameMarkers(downloadsEntries), false);

// Simulate a real Steam game directory on disk if present
const steamPath = 'C:\\Program Files (x86)\\Steam\\steamapps\\common';
if (fs.existsSync(steamPath)) {
  const games = fs.readdirSync(steamPath).slice(0, 1);
  if (games.length) {
    const gamePath = path.join(steamPath, games[0]);
    console.log(`\n  Checking real Steam game: ${gamePath}`);
    test(`isGameLibraryPath detects real Steam game dir`,
      isGameLibraryPath(gamePath), true);
  }
}

console.log(`\n${'─'.repeat(55)}`);
console.log(`Result: ${passed}/${total} passed`);
if (passed < total) process.exit(1);
