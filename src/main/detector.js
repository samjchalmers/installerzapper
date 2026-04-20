const fs = require('fs');

// ── Extension lists ───────────────────────────────────────────────────────────

// These are always installers — no further checks needed
const DEFINITE_INSTALLER_EXTS = new Set([
  '.msi', '.msix', '.msixbundle', '.appx', '.appxbundle', '.msp', '.msu',
]);

const CANDIDATE_EXTS = new Set(['.exe', ...DEFINITE_INSTALLER_EXTS]);

// ── Tier 1: Filename heuristics ───────────────────────────────────────────────

const NAME_PATTERNS = [
  /\bsetup\b/i,               // setup.exe, myapp_setup.exe
  /\binstall(er)?\b/i,        // install.exe, installer.exe — NOT uninstall (separate pattern removed)
  /\bredist(ributable)?\b/i,  // vcredist_x64.exe, VC_redist.x64.exe
  /\bdeploy\b/i,              // deploy.exe
  /\bpatch\b/i,               // patch.exe (game/app patches, distinct from updater services)

  // Deliberately excluded — high false positive rate:
  //   \buninstall\b  — these live inside installed apps; deleting breaks the app's own uninstaller
  //   \bupdate\b     — matches updater service daemons (GoogleUpdate.exe, etc.), not standalone installers
  //   \bupgrade\b    — same problem as update
  //   \bwizard\b     — too generic; config/setup wizards inside apps are not standalone installers
  //   [-_]v?\d+...   — versioned filenames also match portable apps (VLC-3.0.18.exe, etc.)
];

function nameIsInstaller(filename) {
  return NAME_PATTERNS.some((re) => re.test(filename));
}

// ── Tier 2: PE header + binary signature scan ─────────────────────────────────

// Byte sequences to search for in the first 4 KB of an EXE.
// These are highly specific installer framework strings — very low false positive rate.
const FRAMEWORK_SIGS = [
  { label: 'NSIS',          buf: Buffer.from('Nullsoft Install') },  // more specific than just 'Nullsoft'
  { label: 'Inno Setup',    buf: Buffer.from('Inno Setup') },
  { label: 'InstallShield', buf: Buffer.from('InstallShield') },
  { label: 'WiX',           buf: Buffer.from('WiX Toolset') },
  { label: 'WISE',          buf: Buffer.from('WISE Installer') },
  { label: 'MSI wrapper',   buf: Buffer.from('MsiExec.exe') },      // more specific: includes .exe
  { label: 'Install4j',     buf: Buffer.from('install4j') },
  { label: 'Advanced Inst', buf: Buffer.from('Advanced Installer') },

  // Deliberately excluded:
  //   '7-Zip'  — 7z.exe and 7zFM.exe (the 7-Zip application itself) contain this string;
  //              would false-positive on the app. Removed — NSIS/InnoSetup covers 7z SFX anyway.
];

// UTF-16LE encoded strings found in PE version info resources.
// Only keep strings that are definitively installer-specific.
// 'setup' and 'Install' were removed — they appear in many non-installer app descriptions.
const VER_SIGS_UTF16 = [
  Buffer.from('installer', 'utf16le'),   // lowercase: FileDescription = "XYZ installer"
  Buffer.from('Installer', 'utf16le'),   // capitalised: ProductName = "XYZ Installer"

  // Deliberately excluded:
  //   'setup' / 'Setup'  — appears in "Network Setup Tools", "Windows Setup Components", etc.
  //   'Install'           — appears in any app description mentioning install as a verb/noun
];

const HEADER_READ_BYTES = 4096;

function readHeader(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEADER_READ_BYTES);
    const bytesRead = fs.readSync(fd, buf, 0, HEADER_READ_BYTES, 0);
    return buf.slice(0, bytesRead);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function isPeFile(buf) {
  if (!buf || buf.length < 0x40) return false;
  if (buf[0] !== 0x4D || buf[1] !== 0x5A) return false; // MZ
  const peOffset = buf.readUInt32LE(0x3C);
  if (peOffset + 4 > buf.length) return true; // PE offset beyond our read window — assume valid MZ
  return buf.readUInt32LE(peOffset) === 0x00004550; // PE\0\0
}

function scanSignatures(buf) {
  for (const sig of FRAMEWORK_SIGS) {
    if (buf.includes(sig.buf)) return sig.label;
  }
  for (const sig of VER_SIGS_UTF16) {
    if (buf.includes(sig)) return 'EXE Installer';
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns null if not an installer, or an object describing it.
 * @param {string} filePath
 * @param {number} fileSize  pre-fetched from stat to avoid extra syscall
 */
function classify(filePath, fileSize) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const name = filePath.slice(filePath.lastIndexOf('\\') + 1);

  // Definite by extension
  if (DEFINITE_INSTALLER_EXTS.has(ext)) {
    return { label: ext.slice(1).toUpperCase(), size: fileSize };
  }

  if (ext !== '.exe') return null;

  // Tier 1 — filename
  if (nameIsInstaller(name)) {
    // Still verify it's a PE file to filter out renamed non-exes
    const buf = readHeader(filePath);
    if (!buf || !isPeFile(buf)) return null;
    return { label: 'EXE Installer', size: fileSize };
  }

  // Tier 2 — binary scan
  const buf = readHeader(filePath);
  if (!buf || !isPeFile(buf)) return null;
  const framework = scanSignatures(buf);
  if (framework) {
    return { label: framework, size: fileSize };
  }

  return null;
}

module.exports = { classify, CANDIDATE_EXTS };
