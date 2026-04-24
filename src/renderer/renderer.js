'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let files = [];             // all found installer objects
let selected = new Set();   // file paths that are checked
let scanning = false;
let sortCol = 'size';
let sortDir = 'desc';       // 'asc' | 'desc'
let filterText = '';        // current search string, lowercased

// ── DOM refs ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const driveList     = $('drive-list');
const btnScan       = $('btn-scan');
const btnCancel     = $('btn-cancel');
const statusText    = $('status-text');
const foundCount    = $('found-count');
const spinner       = $('spinner');
const resultsBody   = $('results-body');
const resultsTable  = $('results-table');
const emptyState    = $('empty-state');
const checkAll      = $('check-all');
const btnSelectAll  = $('btn-select-all');
const btnDeselectAll = $('btn-deselect-all');
const selectionSummary = $('selection-summary');
const btnDelete     = $('btn-delete');
const dialog        = $('confirm-dialog');
const dialogBody    = $('dialog-body');
const dialogConfirm = $('dialog-confirm');
const dialogCancel  = $('dialog-cancel');
const toast         = $('toast');
const toastMsg      = $('toast-msg');
const toastClose    = $('toast-close');
const filterInput   = $('filter-input');
const filterClear   = $('filter-clear');
const filterCount   = $('filter-count');
const btnExport     = $('btn-export');
const exportMenu    = $('export-menu');

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  for (let i = 0; i < units.length - 1; i++) {
    if (v < 1024) return `${v.toFixed(1)} ${units[i]}`;
    v /= 1024;
  }
  return `${v.toFixed(2)} TB`;
}

function typeBadgeClass(label) {
  const l = (label || '').toLowerCase();
  if (l.startsWith('msi') || l === 'msp' || l === 'msu') return 'type-msi';
  if (l.startsWith('exe')) return 'type-exe';
  if (l.startsWith('msix') || l.startsWith('appx')) return 'type-msix';
  return 'type-other';
}

// ── Drive chips ───────────────────────────────────────────────────────────────

function renderDrives(drives) {
  driveList.innerHTML = '';
  if (!drives || drives.length === 0) {
    driveList.innerHTML = '<span class="drive-loading">No drives found</span>';
    return;
  }
  drives.forEach((drive, idx) => {
    const chip = document.createElement('label');
    chip.className = 'drive-chip' + (idx === 0 ? ' selected' : '');
    chip.title = drive;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = drive;
    input.checked = idx === 0;

    input.addEventListener('change', () => {
      chip.classList.toggle('selected', input.checked);
      const anySelected = [...driveList.querySelectorAll('input')].some((i) => i.checked);
      btnScan.disabled = !anySelected;
    });

    chip.appendChild(input);
    chip.appendChild(document.createTextNode(drive.replace('\\', '')));
    driveList.appendChild(chip);
  });
  btnScan.disabled = false;
}

function getSelectedDrives() {
  return [...driveList.querySelectorAll('input:checked')].map((i) => i.value);
}

// ── Table rendering ───────────────────────────────────────────────────────────

let renderScheduled = false;

function scheduleRender() {
  if (!renderScheduled) {
    renderScheduled = true;
    requestAnimationFrame(renderTable);
  }
}

function getVisible() {
  const sorted = sortFiles([...files]);
  if (!filterText) return sorted;
  return sorted.filter((f) =>
    f.name.toLowerCase().includes(filterText) ||
    f.dir.toLowerCase().includes(filterText) ||
    f.label.toLowerCase().includes(filterText)
  );
}

function renderTable() {
  renderScheduled = false;
  const visible = getVisible();

  // Update filter count badge
  if (filterText) {
    filterCount.textContent = `${visible.length} of ${files.length} shown`;
  } else {
    filterCount.textContent = files.length ? `${files.length} found` : '';
  }

  if (visible.length === 0) {
    resultsBody.innerHTML = '';
    if (files.length === 0) {
      // No scan results at all
      emptyState.classList.remove('hidden');
      resultsTable.style.visibility = 'hidden';
    } else {
      // Filter is hiding everything — show table structure but empty body
      emptyState.classList.add('hidden');
      resultsTable.style.visibility = 'visible';
    }
    updateFooter(visible);
    return;
  }

  emptyState.classList.add('hidden');
  resultsTable.style.visibility = 'visible';

  const tbody = document.createDocumentFragment();
  visible.forEach((f) => {
    const isChecked = selected.has(f.path);
    const tr = document.createElement('tr');
    if (isChecked) tr.classList.add('checked-row');
    tr.dataset.path = f.path;

    tr.innerHTML = `
      <td class="col-check">
        <label class="checkbox-wrap">
          <input type="checkbox" data-path="${escHtml(f.path)}" ${isChecked ? 'checked' : ''} />
          <span class="checkmark"></span>
        </label>
      </td>
      <td class="td-name col-name" title="${escHtml(f.name)}">${escHtml(f.name)}</td>
      <td class="td-type col-type">
        <span class="type-badge ${typeBadgeClass(f.label)}">${escHtml(f.label)}</span>
      </td>
      <td class="td-size col-size">${fmtSize(f.size)}</td>
      <td class="td-path col-path" title="${escHtml(f.dir)}">${escHtml(f.dir)}</td>
      <td class="td-reveal col-reveal">
        <button class="btn-reveal" data-path="${escHtml(f.path)}" title="Show in folder">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
                  stroke="currentColor" stroke-width="2"/>
          </svg>
        </button>
      </td>`;

    tbody.appendChild(tr);
  });

  resultsBody.replaceChildren(tbody);

  resultsBody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => onRowCheck(cb.dataset.path, cb.checked));
  });

  resultsBody.querySelectorAll('.btn-reveal').forEach((btn) => {
    btn.addEventListener('click', () => window.api.revealFile(btn.dataset.path));
  });

  updateHeaderCheckbox();
  updateFooter(visible);
}

function sortFiles(arr) {
  return arr.sort((a, b) => {
    let va = a[sortCol];
    let vb = b[sortCol];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1  : -1;
    return 0;
  });
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Selection ─────────────────────────────────────────────────────────────────

function onRowCheck(path, checked) {
  if (checked) selected.add(path);
  else selected.delete(path);

  // Update row highlight without full re-render
  const tr = resultsBody.querySelector(`tr[data-path="${CSS.escape(path)}"]`);
  if (tr) tr.classList.toggle('checked-row', checked);

  updateHeaderCheckbox();
  updateFooter(getVisible());
}

function updateHeaderCheckbox() {
  // Header checkbox reflects visible rows only
  const visible = getVisible();
  const visiblePaths = new Set(visible.map((f) => f.path));
  const selVisible = [...selected].filter((p) => visiblePaths.has(p)).length;
  checkAll.indeterminate = selVisible > 0 && selVisible < visible.length;
  checkAll.checked = visible.length > 0 && selVisible === visible.length;
}

// visible: the currently filtered+sorted list — passed in from renderTable to
// avoid recomputing it, or computed fresh when called from onRowCheck.
function updateFooter(visible) {
  // Count and total only the selected files that are currently visible
  const selectedVisible = visible.filter((f) => selected.has(f.path));
  const n = selectedVisible.length;

  if (n === 0) {
    selectionSummary.textContent = files.length ? 'Nothing selected' : '';
    btnDelete.disabled = true;
  } else {
    const totalBytes = selectedVisible.reduce((s, f) => s + f.size, 0);
    selectionSummary.textContent = `${n} file${n > 1 ? 's' : ''} selected — ${fmtSize(totalBytes)} will be freed`;
    btnDelete.disabled = false;
  }

  btnExport.disabled = visible.length === 0;
}

// ── Export ────────────────────────────────────────────────────────────────────

function escMdCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function toMarkdown(rows) {
  const header = '| Filename | Type | Size | Folder |\n| --- | --- | --- | --- |';
  const body = rows.map((f) =>
    `| ${escMdCell(f.name)} | ${escMdCell(f.label)} | ${fmtSize(f.size)} | ${escMdCell(f.dir)} |`
  ).join('\n');
  return `${header}\n${body}\n`;
}

function escCsvCell(s) {
  const v = String(s);
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(rows) {
  const header = 'Filename,Type,Size,Bytes,Folder';
  const body = rows.map((f) =>
    [f.name, f.label, fmtSize(f.size), f.size, f.dir].map(escCsvCell).join(',')
  ).join('\r\n');
  return `${header}\r\n${body}\r\n`;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

async function handleExport(action) {
  const rows = getVisible();
  if (!rows.length) return;

  const isMd = action.endsWith('md');
  const content = isMd ? toMarkdown(rows) : toCsv(rows);

  if (action.startsWith('copy')) {
    try {
      await window.api.writeClipboard(content);
      showToast(`${rows.length} row${rows.length !== 1 ? 's' : ''} copied as ${isMd ? 'Markdown' : 'CSV'}.`);
    } catch (err) {
      showToast(`Copy failed: ${err.message}`);
    }
    return;
  }

  const defaultName = `installers-${timestamp()}.${isMd ? 'md' : 'csv'}`;
  try {
    const res = await window.api.saveExport({ content, defaultName, format: isMd ? 'md' : 'csv' });
    if (!res.canceled) {
      showToast(`Saved ${rows.length} row${rows.length !== 1 ? 's' : ''} to ${res.filePath}`);
    }
  } catch (err) {
    showToast(`Save failed: ${err.message}`);
  }
}

btnExport.addEventListener('click', (e) => {
  e.stopPropagation();
  exportMenu.classList.toggle('hidden');
});

exportMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('.export-menu-item');
  if (!btn) return;
  exportMenu.classList.add('hidden');
  handleExport(btn.dataset.action);
});

document.addEventListener('click', (e) => {
  if (!exportMenu.classList.contains('hidden') &&
      !e.target.closest('.export-wrap')) {
    exportMenu.classList.add('hidden');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !exportMenu.classList.contains('hidden')) {
    exportMenu.classList.add('hidden');
  }
});

// ── Sort headers ──────────────────────────────────────────────────────────────

document.querySelectorAll('thead th.sortable').forEach((th) => {
  th.addEventListener('click', () => {
    const col = th.dataset.col;
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = col === 'size' ? 'desc' : 'asc';
    }
    document.querySelectorAll('thead th').forEach((h) => {
      h.classList.remove('sort-asc', 'sort-desc');
    });
    th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    scheduleRender();
  });
});

// ── Scan ──────────────────────────────────────────────────────────────────────

btnScan.addEventListener('click', async () => {
  const drives = getSelectedDrives();
  if (!drives.length) return;

  files = [];
  selected.clear();
  filterInput.value = '';
  filterText = '';
  filterClear.classList.add('hidden');
  filterCount.textContent = '';
  scheduleRender();

  scanning = true;
  btnScan.disabled = true;
  btnCancel.disabled = false;
  spinner.classList.remove('hidden');
  statusText.textContent = 'Preparing scan…';
  foundCount.textContent = '';

  window.api.offProgress();
  window.api.onProgress((batch) => {
    files.push(...batch);
    foundCount.textContent = `${files.length} found`;
    // Show the current directory being scanned
    if (batch.length) {
      const lastDir = batch[batch.length - 1].dir;
      const short = lastDir.length > 60 ? '…' + lastDir.slice(-57) : lastDir;
      statusText.textContent = `Scanning ${short}`;
    }
    scheduleRender();
  });

  try {
    const summary = await window.api.startScan(drives);
    const cancelled = summary && summary.cancelled;
    statusText.textContent = cancelled
      ? `Scan stopped — ${files.length} installer${files.length !== 1 ? 's' : ''} found.`
      : `Scan complete — ${files.length} installer${files.length !== 1 ? 's' : ''} found.`;
  } catch (err) {
    statusText.textContent = `Scan error: ${err.message}`;
  } finally {
    scanning = false;
    btnScan.disabled = false;
    btnCancel.disabled = true;
    spinner.classList.add('hidden');
    foundCount.textContent = '';
    scheduleRender();
  }
});

btnCancel.addEventListener('click', () => {
  window.api.cancelScan();
  btnCancel.disabled = true;
  statusText.textContent = 'Cancelling…';
});

// ── Select all / none ─────────────────────────────────────────────────────────

// Select/deselect operates on visible (filtered) rows only
checkAll.addEventListener('change', () => {
  const visible = getVisible();
  if (checkAll.checked) {
    visible.forEach((f) => selected.add(f.path));
  } else {
    visible.forEach((f) => selected.delete(f.path));
  }
  scheduleRender();
});

btnSelectAll.addEventListener('click', () => {
  getVisible().forEach((f) => selected.add(f.path));
  scheduleRender();
});

btnDeselectAll.addEventListener('click', () => {
  getVisible().forEach((f) => selected.delete(f.path));
  scheduleRender();
});

// ── Delete ────────────────────────────────────────────────────────────────────

btnDelete.addEventListener('click', () => {
  const visible = getVisible();
  const selectedVisible = visible.filter((f) => selected.has(f.path));
  const n = selectedVisible.length;
  if (!n) return;
  const totalBytes = selectedVisible.reduce((s, f) => s + f.size, 0);

  dialogBody.textContent =
    `You are about to move ${n} file${n > 1 ? 's' : ''} (${fmtSize(totalBytes)}) to the Recycle Bin.`;
  dialog.showModal();
});

dialogCancel.addEventListener('click', () => dialog.close());

dialogConfirm.addEventListener('click', async () => {
  dialog.close();

  // Only delete files that are both selected AND currently visible
  const paths = getVisible().filter((f) => selected.has(f.path)).map((f) => f.path);
  btnDelete.disabled = true;
  statusText.textContent = `Moving ${paths.length} file${paths.length > 1 ? 's' : ''} to Recycle Bin…`;
  spinner.classList.remove('hidden');

  let results;
  try {
    results = await window.api.deleteFiles(paths);
  } catch (err) {
    showToast(`Delete error: ${err.message}`);
    spinner.classList.add('hidden');
    statusText.textContent = 'Error during deletion.';
    return;
  }

  const failed = results.filter((r) => !r.success);
  const succeeded = results.filter((r) => r.success);

  // Remove succeeded files from state
  const deletedSet = new Set(succeeded.map((r) => r.path));
  files = files.filter((f) => !deletedSet.has(f.path));
  deletedSet.forEach((p) => selected.delete(p));

  scheduleRender();
  spinner.classList.add('hidden');

  if (failed.length) {
    const msg = `Moved ${succeeded.length} file${succeeded.length !== 1 ? 's' : ''} to Recycle Bin. ${failed.length} could not be moved (may be in use or access denied).`;
    statusText.textContent = msg;
    showToast(msg);
  } else {
    statusText.textContent = `Moved ${succeeded.length} file${succeeded.length !== 1 ? 's' : ''} to Recycle Bin.`;
    showToast(`${succeeded.length} file${succeeded.length !== 1 ? 's' : ''} moved to Recycle Bin.`);
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(msg) {
  toastMsg.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 5000);
}

toastClose.addEventListener('click', () => {
  clearTimeout(toastTimer);
  toast.classList.add('hidden');
});

// ── Filter ────────────────────────────────────────────────────────────────────

filterInput.addEventListener('input', () => {
  filterText = filterInput.value.toLowerCase();
  filterClear.classList.toggle('hidden', filterText === '');
  scheduleRender();
});

filterClear.addEventListener('click', () => {
  filterInput.value = '';
  filterText = '';
  filterClear.classList.add('hidden');
  scheduleRender();
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async function init() {
  emptyState.classList.remove('hidden');
  resultsTable.style.visibility = 'hidden';
  try {
    const drives = await window.api.getDrives();
    renderDrives(drives);
  } catch {
    driveList.innerHTML = '<span class="drive-loading">Could not enumerate drives</span>';
  }
})();
