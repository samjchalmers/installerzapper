const fs = require('fs');
const { classify } = require('./src/main/detector');

// ── Helpers ───────────────────────────────────────────────────────────────────

function test(path, size, expect, note) {
  const result = classify(path, size);
  const got    = result !== null;
  const ok     = got === expect;
  const tag    = ok ? '✓ PASS' : '✗ FAIL';
  const exp    = expect ? 'installer    ' : 'not-installer';
  const got2   = got    ? 'installer    ' : 'not-installer';
  const label  = result ? ` [${result.label}]` : '';
  console.log(`${tag}  expect=${exp}  got=${got2}${label}  (${note})`);
  return ok;
}

function exists(p) {
  try { fs.statSync(p); return true; } catch { return false; }
}

let passed = 0;
let total  = 0;

function run(path, size, expect, note) {
  total++;
  if (test(path, size, expect, note)) passed++;
}

console.log('── FALSE POSITIVE tests (real system files that must NOT be flagged) ──\n');

// These are real executables on every Windows machine — none are installers.
// If any of these are classified as installers, we have a bug.
const nonInstallers = [
  { path: 'C:\\Windows\\notepad.exe',                               note: 'notepad' },
  { path: 'C:\\Windows\\System32\\cmd.exe',                         note: 'cmd' },
  { path: 'C:\\Windows\\System32\\calc.exe',                        note: 'calculator' },
  { path: 'C:\\Windows\\System32\\msiexec.exe',                     note: 'msiexec itself' },
  { path: 'C:\\Windows\\explorer.exe',                               note: 'explorer' },
];

for (const { path, note } of nonInstallers) {
  if (exists(path)) {
    const size = fs.statSync(path).size;
    run(path, size, false, note);
  } else {
    console.log(`  SKIP (not found): ${path}`);
  }
}

// If 7-Zip is installed, its own exe must NOT be flagged (was a bug before fix)
const sevenZipPaths = [
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files\\7-Zip\\7zFM.exe',
];
for (const path of sevenZipPaths) {
  if (exists(path)) {
    const size = fs.statSync(path).size;
    run(path, size, false, `7-Zip app binary (${path.split('\\').pop()})`);
  }
}

console.log('\n── TRUE POSITIVE tests (definite installers by extension) ──\n');

// Extension-based detection requires no file I/O — test with fake paths
run('C:\\Downloads\\something.msi',         80000000, true, 'MSI package');
run('C:\\Downloads\\something.msix',        20000000, true, 'MSIX package');
run('C:\\Downloads\\something.msixbundle',  30000000, true, 'MSIX bundle');
run('C:\\Downloads\\something.appx',        15000000, true, 'APPX package');
run('C:\\Downloads\\something.msp',          5000000, true, 'MSP patch');
run('C:\\Downloads\\something.msu',          8000000, true, 'MSU update package');

console.log('\n── NAME pattern tests (require real files — skipped if not present) ──\n');

// EXE classification requires reading the actual file for the PE header check.
// We can only test with real files on disk.
const exeTests = [
  // Common false-positive candidates — must not be flagged
  { path: 'C:\\Windows\\System32\\wuauclt.exe',  expect: false, note: 'Windows Update client (update in binary but not installer)' },
];

for (const { path, expect, note } of exeTests) {
  if (exists(path)) {
    run(path, fs.statSync(path).size, expect, note);
  } else {
    console.log(`  SKIP (not found): ${path}`);
  }
}

console.log(`\n${'─'.repeat(60)}`);
console.log(`Result: ${passed}/${total} passed`);
if (passed < total) process.exit(1);
