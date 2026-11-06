/**
 * BARAKA PeopleOS — Integrasi OPS & Absensi (Tahap 2)
 * Backend Google Apps Script.
 * - Menyajikan PeopleOS melalui HtmlService agar google.script.run tersedia.
 * - Membaca file Datot .xls (HTML) dan Absensi .xlsx dari Drive.
 * - Preview terlebih dahulu; commit hanya setelah token preview diverifikasi.
 * - Menulis hanya ke area data yang ditentukan; tidak mengubah formula di kolom S:Z.
 * - Aturan absensi: B/C = F/G (NIB dan nama), H kosong jika tidak ada jam pulang.
 */

const BARAKA_OPS = Object.freeze({
  CONFIG_KEY: 'BARAKA_OPS_CONFIG_V2',
  PREVIEW_PREFIX: 'BARAKA_OPS_PREVIEW_',
  AUDIT_ID_KEY: 'BARAKA_OPS_AUDIT_SPREADSHEET_ID',
  UPLOAD_FOLDER_NAME: 'UPLOAD OPERASIONAL',
  BONUS_FIRST_ROW: 5,
  BONUS_FIRST_COL: 1,
  BONUS_COLS: 18,       // A:R only. Formula calculations to the right are protected.
  BONUS_RESI_COL: 5,    // E
  ATTENDANCE_FIRST_ROW: 4,
  ATTENDANCE_DATE_FORMAT: 'dd/MM/yyyy HH:mm:ss',
  TIME_ZONE: 'Asia/Jakarta',
  MAX_FILES_PER_BRANCH: 20,
  PREVIEW_TTL_SECONDS: 21600,
  DEFAULT_DESTINATION_MAP: { '010SBY': 'SURABAYA BARAT' }
});


function doGet(e) {
  assertAuthorized_();

  if (e && e.parameter && e.parameter.diagnostik === '1') {
    return HtmlService.createHtmlOutput(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
      '<body style="font:16px Arial;padding:24px">' +
      '<h2>BARAKA — Tes Tampilan</h2>' +
      '<p id="hasil">HTML berhasil dimuat; JavaScript belum berjalan.</p>' +
      '<script>document.getElementById("hasil").textContent = "HTML dan JavaScript berhasil dimuat.";</' + 'script>' +
      '</body></html>'
    ).setTitle('BARAKA Diagnostik');
  }
if (e && e.parameter && e.parameter.ops === '1') {
  return HtmlService
    .createHtmlOutputFromFile('OpsConsole')
    .setTitle('BARAKA - Integrasi OPS');
}


if (e && e.parameter && e.parameter.bonus === '1') {
  return HtmlService
    .createHtmlOutputFromFile('BonusPreview')
    .setTitle('BARAKA - Preview Bonus Standby');
}

  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('BARAKA PeopleOS — Integrasi Operasional');
}


/** Called by the PeopleOS front-end to determine whether it is hosted in Apps Script. */
function getOpsBootstrap() {
  assertAuthorized_();
  const config = loadConfig_();
  return {
    ok: true,
    connected: true,
    userEmail: safeActiveEmail_(),
    configured: !!(config.branches && config.branches.length),
    configVersion: config.version || 0,
    branches: (config.branches || []).map(publicBranchConfig_),
    auditSpreadsheetUrl: config.auditSpreadsheetId ? 'https://docs.google.com/spreadsheets/d/' + config.auditSpreadsheetId + '/edit' : '',
    destinationMapText: destinationMapToText_(config.destinationMap || BARAKA_OPS.DEFAULT_DESTINATION_MAP)
  };
}

/** Save branch-to-Drive/Sheets mapping. IDs may be pasted as raw IDs or full Google URLs. */
function saveOpsConfig(payload) {
  assertAuthorized_();
  if (!payload || !Array.isArray(payload.branches)) throw new Error('Konfigurasi cabang tidak valid.');
  const previous = loadConfig_();
  const seen = {};
  const branches = payload.branches.map(function (row) {
    const branchId = String(row.branchId || '').trim();
    const branchName = String(row.branchName || '').trim();
    if (!branchId || !branchName) throw new Error('Setiap baris konfigurasi wajib memiliki ID dan nama cabang.');
    if (seen[branchId]) throw new Error('ID cabang duplikat pada konfigurasi: ' + branchName);
    seen[branchId] = true;
    const old = (previous.branches || []).find(function (b) { return b.branchId === branchId; }) || {};
    const branchFolderId = extractDriveId_(row.branchFolderId, 'folder');
    return {
      branchId: branchId,
      branchName: branchName,
      branchFolderId: branchFolderId,
      uploadFolderId: old.branchFolderId === branchFolderId ? (old.uploadFolderId || '') : '',
      bonusSpreadsheetId: extractDriveId_(row.bonusSpreadsheetId, 'spreadsheet'),
      attendanceSpreadsheetId: extractDriveId_(row.attendanceSpreadsheetId, 'spreadsheet'),
      opsCodes: normalizeCodes_(row.opsCodes)
    };
  });
  const config = {
    version: Number(previous.version || 0) + 1,
    updatedAt: new Date().toISOString(),
    branches: branches,
    auditSpreadsheetId: previous.auditSpreadsheetId || '',
    destinationMap: normalizeDestinationMap_(payload.destinationMap !== undefined ? payload.destinationMap : destinationMapToText_(previous.destinationMap || BARAKA_OPS.DEFAULT_DESTINATION_MAP))
  };
  PropertiesService.getScriptProperties().setProperty(BARAKA_OPS.CONFIG_KEY, JSON.stringify(config));
  return { ok: true, configVersion: config.version, branches: branches.map(publicBranchConfig_) };
}

/** Create/find one UPLOAD OPERASIONAL folder inside every configured branch folder. */
function setupOpsUploadFolders() {
  assertAuthorized_();
  const config = loadConfig_();
  const results = [];
  config.branches = config.branches || [];
  config.branches.forEach(function (branch) {
    try {
      if (!branch.branchFolderId) throw new Error('Folder induk cabang belum diisi.');
      const parent = DriveApp.getFolderById(branch.branchFolderId);
      const matches = parent.getFoldersByName(BARAKA_OPS.UPLOAD_FOLDER_NAME);
      let uploadFolder;
      if (matches.hasNext()) {
        uploadFolder = matches.next();
        if (matches.hasNext()) throw new Error('Ada lebih dari satu folder ' + BARAKA_OPS.UPLOAD_FOLDER_NAME + '. Rapikan folder terlebih dahulu.');
      } else {
        uploadFolder = parent.createFolder(BARAKA_OPS.UPLOAD_FOLDER_NAME);
      }
      branch.uploadFolderId = uploadFolder.getId();
      results.push({ branchId: branch.branchId, branchName: branch.branchName, ok: true, folderId: uploadFolder.getId(), folderUrl: uploadFolder.getUrl(), status: 'Folder siap' });
    } catch (err) {
      results.push({ branchId: branch.branchId, branchName: branch.branchName, ok: false, status: err.message || String(err) });
    }
  });
  config.version = Number(config.version || 0) + 1;
  config.updatedAt = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty(BARAKA_OPS.CONFIG_KEY, JSON.stringify(config));
  return { ok: results.some(function (r) { return r.ok; }), results: results, configVersion: config.version };
}

/** Create the selected YYYY-MM-DD folder in each branch upload folder. */
function createOpsDateFolders(dateISO) {
  assertAuthorized_();
  assertISODate_(dateISO);
  const config = loadConfig_();
  const results = [];
  (config.branches || []).forEach(function (branch) {
    try {
      if (!branch.uploadFolderId) throw new Error('Folder UPLOAD OPERASIONAL belum disiapkan.');
      const parent = DriveApp.getFolderById(branch.uploadFolderId);
      const matches = parent.getFoldersByName(dateISO);
      let folder;
      if (matches.hasNext()) {
        folder = matches.next();
        if (matches.hasNext()) throw new Error('Folder tanggal ganda: ' + dateISO);
      } else {
        folder = parent.createFolder(dateISO);
      }
      results.push({ branchId: branch.branchId, branchName: branch.branchName, ok: true, folderUrl: folder.getUrl(), folderId: folder.getId(), status: 'Folder tanggal siap' });
    } catch (err) {
      results.push({ branchId: branch.branchId, branchName: branch.branchName, ok: false, status: err.message || String(err) });
    }
  });
  return { ok: results.some(function (r) { return r.ok; }), date: dateISO, results: results };
}

/** Verify configured folder and spreadsheet access without changing any data. */
function testOpsConfig(dateISO) {
  assertAuthorized_();
  if (dateISO) assertISODate_(dateISO);
  const config = loadConfig_();
  const results = [];
  (config.branches || []).forEach(function (branch) {
    const row = { branchId: branch.branchId, branchName: branch.branchName, folder: false, bonus: false, attendance: false, messages: [] };
    try {
      if (!branch.uploadFolderId) throw new Error('Folder upload belum dibuat.');
      DriveApp.getFolderById(branch.uploadFolderId).getName(); row.folder = true;
    } catch (err) { row.messages.push('Drive: ' + (err.message || err)); }
    try {
      if (!branch.bonusSpreadsheetId) throw new Error('ID spreadsheet bonus belum diisi.');
      const ss = SpreadsheetApp.openById(branch.bonusSpreadsheetId);
      if (dateISO && !ss.getSheetByName(String(Number(dateISO.slice(-2))))) throw new Error('Tab tanggal ' + Number(dateISO.slice(-2)) + ' tidak ditemukan.');
      row.bonus = true;
    } catch (err) { row.messages.push('Bonus: ' + (err.message || err)); }
    try {
      if (!branch.attendanceSpreadsheetId) throw new Error('ID spreadsheet absensi belum diisi.');
      const ss = SpreadsheetApp.openById(branch.attendanceSpreadsheetId);
      if (dateISO && !ss.getSheetByName(String(Number(dateISO.slice(-2))))) throw new Error('Tab tanggal ' + Number(dateISO.slice(-2)) + ' tidak ditemukan.');
      row.attendance = true;
    } catch (err) { row.messages.push('Absensi: ' + (err.message || err)); }
    row.ok = row.folder && row.bonus && row.attendance;
    results.push(row);
  });
  return { ok: results.length > 0 && results.every(function (r) { return r.ok; }), results: results };
}

/** Scan Drive and return file presence only; does not write to Sheets. */
function scanOpsDrive(dateISO) {
  assertAuthorized_();
  assertISODate_(dateISO);
  const config = loadConfig_();
  const scan = scanAllBranches_(config, dateISO, false);
  return publicScan_(scan, dateISO);
}

/** Build a server-side preview and one-time token. Nothing is written to Sheets. */
function previewOpsSync(dateISO) {
  assertAuthorized_();
  assertISODate_(dateISO);
  const config = loadConfig_();
  const plan = scanAllBranches_(config, dateISO, true);
  const fingerprint = plan.fingerprint;
  const token = Utilities.getUuid();
  const cachePayload = {
    date: dateISO,
    fingerprint: fingerprint,
    configVersion: Number(config.version || 0),
    createdAt: Date.now(),
    userEmail: safeActiveEmail_()
  };
  CacheService.getScriptCache().put(BARAKA_OPS.PREVIEW_PREFIX + token, JSON.stringify(cachePayload), BARAKA_OPS.PREVIEW_TTL_SECONDS);
  const publicPlan = publicScan_(plan, dateISO);
  publicPlan.previewToken = token;
  publicPlan.canCommit = plan.readyCount > 0;
  publicPlan.summary = {
    branches: plan.branches.length,
    readyFiles: plan.readyCount,
    blockedFiles: plan.blockedCount,
    missingFiles: plan.missingCount,
    newDatotRows: plan.newDatotRows,
    newAttendanceRows: plan.newAttendanceRows,
    duplicateRows: plan.duplicateRows,
    conflictRows: plan.conflictRows
  };
  return publicPlan;
}

/** Commit only the unchanged preview snapshot. A second click requires a fresh preview. */
function commitOpsSync(dateISO, previewToken) {
  assertAuthorized_();
  assertISODate_(dateISO);
  if (!previewToken) throw new Error('Token pratinjau tidak ditemukan. Jalankan pratinjau ulang.');
  const cache = CacheService.getScriptCache();
  const cacheKey = BARAKA_OPS.PREVIEW_PREFIX + previewToken;
  const tokenRaw = cache.get(cacheKey);
  if (!tokenRaw) throw new Error('Pratinjau kedaluwarsa atau sudah digunakan. Jalankan pratinjau ulang.');
  const tokenData = JSON.parse(tokenRaw);
  if (tokenData.date !== dateISO) throw new Error('Tanggal berbeda dari pratinjau. Jalankan pratinjau ulang.');
  if (tokenData.userEmail && safeActiveEmail_() && tokenData.userEmail !== safeActiveEmail_()) throw new Error('Pratinjau dibuat oleh akun berbeda.');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Proses sinkronisasi lain sedang berjalan. Coba lagi setelah selesai.');
  try {
    const config = loadConfig_();
    if (Number(config.version || 0) !== Number(tokenData.configVersion || 0)) throw new Error('Konfigurasi cabang berubah setelah pratinjau. Jalankan pratinjau ulang.');
    const plan = scanAllBranches_(config, dateISO, true);
    if (plan.fingerprint !== tokenData.fingerprint) throw new Error('Isi folder atau file berubah setelah pratinjau. Jalankan pratinjau ulang sebelum menulis.');

    const results = [];
    plan.branches.forEach(function (branchPlan) {
      const branchResult = { branchId: branchPlan.branchId, branchName: branchPlan.branchName, datot: null, attendance: null };
      if (branchPlan.datot && branchPlan.datot.status === 'ready') {
        try { branchResult.datot = commitDatot_(branchPlan); }
        catch (err) { branchResult.datot = { ok: false, status: err.message || String(err) }; }
      } else if (branchPlan.datot) {
        branchResult.datot = { ok: false, status: branchPlan.datot.statusText || branchPlan.datot.status };
      }
      if (branchPlan.attendance && branchPlan.attendance.status === 'ready') {
        try { branchResult.attendance = commitAttendance_(branchPlan); }
        catch (err) { branchResult.attendance = { ok: false, status: err.message || String(err) }; }
      } else if (branchPlan.attendance) {
        branchResult.attendance = { ok: false, status: branchPlan.attendance.statusText || branchPlan.attendance.status };
      }
      results.push(branchResult);
    });
    const summary = summarizeCommit_(results);
    let auditWarning = '';
    try { logOpsRun_(dateISO, results, summary); } catch (auditErr) { auditWarning = 'Data telah diproses, tetapi log audit gagal ditulis: ' + (auditErr.message || auditErr); }
    cache.remove(cacheKey);
    return { ok: summary.successes > 0, date: dateISO, results: results, summary: summary, auditSpreadsheetUrl: getAuditUrl_(), auditWarning: auditWarning };
  } finally {
    lock.releaseLock();
  }
}

/* ----------------------------- AUTH / CONFIG ----------------------------- */
function assertAuthorized_() {
  const props = PropertiesService.getScriptProperties();
  const allowedRaw = props.getProperty('BARAKA_ALLOWED_EMAILS') || '';
  if (!allowedRaw.trim()) return; // Access boundary must still be restricted in the Web App deployment settings.
  const active = safeActiveEmail_().toLowerCase();
  const allowed = allowedRaw.split(/[;,\n]/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
  if (!active || allowed.indexOf(active) < 0) throw new Error('Akun Google ini tidak termasuk daftar pengguna PeopleOS yang diizinkan.');
}
function safeActiveEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (err) { return ''; }
}
function loadConfig_() {
  const raw = PropertiesService.getScriptProperties().getProperty(BARAKA_OPS.CONFIG_KEY);
  if (!raw) return { version: 0, branches: [], auditSpreadsheetId: '', destinationMap: BARAKA_OPS.DEFAULT_DESTINATION_MAP };
  try {
    const config = JSON.parse(raw);
    if (config && Array.isArray(config.branches)) {
      if (!config.destinationMap) config.destinationMap = BARAKA_OPS.DEFAULT_DESTINATION_MAP;
      return config;
    }
    return { version: 0, branches: [], auditSpreadsheetId: '', destinationMap: BARAKA_OPS.DEFAULT_DESTINATION_MAP };
  }
  catch (err) { throw new Error('Konfigurasi integrasi rusak. Periksa Script Properties ' + BARAKA_OPS.CONFIG_KEY + '.'); }
}
function publicBranchConfig_(b) {
  return {
    branchId: b.branchId,
    branchName: b.branchName,
    branchFolderId: b.branchFolderId || '',
    uploadFolderId: b.uploadFolderId || '',
    bonusSpreadsheetId: b.bonusSpreadsheetId || '',
    attendanceSpreadsheetId: b.attendanceSpreadsheetId || '',
    opsCodes: (b.opsCodes || []).join(', ')
  };
}
function extractDriveId_(value, kind) {
  const s = String(value || '').trim();
  if (!s) return '';
  let m;
  if (kind === 'folder') m = s.match(/\/folders\/([A-Za-z0-9_-]+)/);
  else m = s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (!m) m = s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  const id = m ? m[1] : s;
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error('ID Google Drive/Sheets tidak valid: ' + s);
  return id;
}
function normalizeCodes_(value) {
  if (Array.isArray(value)) return value.map(function (x) { return String(x).trim().toUpperCase(); }).filter(Boolean);
  return String(value || '').split(/[;,\n]/).map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
}
function assertISODate_(dateISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateISO || ''))) throw new Error('Tanggal harus berformat YYYY-MM-DD.');
  const d = new Date(dateISO + 'T12:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateISO) throw new Error('Tanggal tidak valid.');
}

/* ------------------------------- DRIVE SCAN ------------------------------ */
function scanAllBranches_(config, dateISO, inspectTargets) {
  const day = String(Number(dateISO.slice(-2)));
  const branches = [];
  const fingerprintParts = ['date=' + dateISO, 'config=' + Number(config.version || 0)];
  let readyCount = 0, blockedCount = 0, missingCount = 0, newDatotRows = 0, newAttendanceRows = 0, duplicateRows = 0, conflictRows = 0;
  (config.branches || []).forEach(function (branch) {
    const branchRuntime = Object.assign({}, branch);
    const bp = { branchId: branch.branchId, branchName: branch.branchName, config: branchRuntime, date: dateISO, folderStatus: 'ready', datot: null, attendance: null };
    if (!branch.uploadFolderId) {
      bp.folderStatus = 'upload_folder_not_configured';
      bp.folderStatusText = 'Folder UPLOAD OPERASIONAL belum disiapkan.';
      bp.datot = { kind: 'datot', status: 'missing', statusText: bp.folderStatusText };
      bp.attendance = { kind: 'attendance', status: 'missing', statusText: bp.folderStatusText };
      missingCount += 2; branches.push(bp); fingerprintParts.push(branch.branchId + '|no-upload-folder'); return;
    }
    try {
      const uploadFolder = DriveApp.getFolderById(branch.uploadFolderId);
      const folders = uploadFolder.getFoldersByName(dateISO);
      if (!folders.hasNext()) {
        bp.folderStatus = 'date_folder_missing';
        bp.folderStatusText = 'Folder tanggal ' + dateISO + ' belum tersedia.';
        bp.datot = { kind: 'datot', status: 'missing', statusText: bp.folderStatusText };
        bp.attendance = { kind: 'attendance', status: 'missing', statusText: bp.folderStatusText };
        missingCount += 2; branches.push(bp); fingerprintParts.push(branch.branchId + '|no-date-folder'); return;
      }
      const dateFolder = folders.next();
      if (folders.hasNext()) throw new Error('Ada lebih dari satu folder tanggal ' + dateISO + '.');
      bp.dateFolderUrl = dateFolder.getUrl();
      fingerprintParts.push(branch.branchId + '|date-folder|' + dateFolder.getId());
      const datotFiles = [], attendanceFiles = [], unknownFiles = [];
      const it = dateFolder.getFiles();
      let count = 0;
      while (it.hasNext()) {
        const file = it.next(); count++;
        if (count > BARAKA_OPS.MAX_FILES_PER_BRANCH) throw new Error('Jumlah file pada folder melebihi batas ' + BARAKA_OPS.MAX_FILES_PER_BRANCH + '.');
        const name = file.getName().toLowerCase();
        const meta = { id: file.getId(), name: file.getName(), size: file.getSize(), updated: file.getLastUpdated().getTime(), mimeType: file.getMimeType() };
        fingerprintParts.push([branch.branchId, meta.id, meta.size, meta.updated].join('|'));
        if (/\.(xls|html|htm)$/.test(name)) datotFiles.push({ file: file, meta: meta });
        else if (/\.xlsx$/.test(name)) attendanceFiles.push({ file: file, meta: meta });
        else unknownFiles.push(meta.name);
      }
      bp.unknownFiles = unknownFiles;
      bp.datot = inspectOneFile_(branchRuntime, dateISO, day, 'datot', datotFiles, inspectTargets);
      bp.attendance = inspectOneFile_(branchRuntime, dateISO, day, 'attendance', attendanceFiles, inspectTargets);
      [bp.datot, bp.attendance].forEach(function (item) {
        if (!item) return;
        if (item.status === 'ready') {
          readyCount++;
          if (item.kind === 'datot') newDatotRows += item.newCount || 0;
          else newAttendanceRows += item.newCount || 0;
          duplicateRows += item.duplicateCount || 0;
        } else if (item.status === 'missing') missingCount++;
        else blockedCount++;
        conflictRows += item.conflictCount || 0;
      });
      branches.push(bp);
    } catch (err) {
      bp.folderStatus = 'error'; bp.folderStatusText = err.message || String(err);
      bp.datot = { kind: 'datot', status: 'blocked', statusText: bp.folderStatusText };
      bp.attendance = { kind: 'attendance', status: 'blocked', statusText: bp.folderStatusText };
      blockedCount += 2;
      fingerprintParts.push(branch.branchId + '|error|' + bp.folderStatusText);
      branches.push(bp);
    }
  });
  fingerprintParts.sort();
  const fingerprint = sha256Hex_(fingerprintParts.join('\n'));
  return { date: dateISO, branches: branches, fingerprint: fingerprint, readyCount: readyCount, blockedCount: blockedCount, missingCount: missingCount, newDatotRows: newDatotRows, newAttendanceRows: newAttendanceRows, duplicateRows: duplicateRows, conflictRows: conflictRows };
}

function inspectOneFile_(branch, dateISO, day, kind, files, inspectTargets) {
  if (!files.length) return { kind: kind, status: 'missing', statusText: 'File ' + (kind === 'datot' ? 'Datot' : 'Absensi') + ' belum diunggah.' };
  if (files.length > 1) return { kind: kind, status: 'blocked', statusText: 'Ditemukan ' + files.length + ' file ' + kind + ' pada folder yang sama. Sisakan satu file final.', fileNames: files.map(function (x) { return x.meta.name; }) };
  const fileEntry = files[0];
  const out = { kind: kind, fileId: fileEntry.meta.id, fileName: fileEntry.meta.name, size: fileEntry.meta.size, updated: fileEntry.meta.updated, status: 'blocked', statusText: 'Belum divalidasi.' };
  try {
    const parsed = kind === 'datot' ? parseDatotHtml_(fileEntry.file.getBlob().getDataAsString('UTF-8'), fileEntry.meta.name) : parseAttendanceXlsx_(fileEntry.file.getBlob(), fileEntry.meta.name);
    out.records = parsed.records;
    out.recordCount = parsed.records.length;
    out.reportDates = parsed.reportDates || [];
    out.branchCode = parsed.branchCode || '';
    out.totalOmset = parsed.totalOmset || 0;
    out.warnings = parsed.warnings || [];
    if (!parsed.records.length) throw new Error('Tidak ada baris data yang berhasil dibaca.');
    if (kind === 'datot') {
      if (parsed.reportStart !== dateISO || parsed.reportEnd !== dateISO) throw new Error('Rentang tanggal Datot harus tepat ' + dateISO + ', terbaca ' + (parsed.reportStart || '?') + ' s/d ' + (parsed.reportEnd || '?') + '.');
      if (!parsed.branchCode) throw new Error('Kode OPS tidak terbaca dari judul laporan.');
      if (!branch.opsCodes || !branch.opsCodes.length) throw new Error('Daftar kode OPS untuk cabang ini belum dikonfigurasi.');
      if (branch.opsCodes.indexOf(parsed.branchCode.toUpperCase()) < 0) throw new Error('Kode OPS ' + parsed.branchCode + ' tidak terdaftar untuk ' + branch.branchName + '. Kode terdaftar: ' + branch.opsCodes.join(', '));
      if (parsed.warnings.length) throw new Error(parsed.warnings.join(' '));
      // Kode tujuan disalin apa adanya dari kolom Tujuan pada file Datot.
      out.sampleRecords = parsed.records.slice(0, 3).map(function (r) { return { noResi: r.noResi, pengirim: r.pengirim, penerima: r.penerima, tujuan: r.tujuan, kg: r.kg, totalBayar: r.tunai + r.tujuanBayar + r.vaPengirim + r.vaTujuan, status: r.status }; });
      if (inspectTargets) {
        if (!branch.bonusSpreadsheetId) throw new Error('Spreadsheet Bonus Standby belum dikonfigurasi.');
        const ss = SpreadsheetApp.openById(branch.bonusSpreadsheetId);
        const sheet = ss.getSheetByName(day);
        if (!sheet) throw new Error('Tab bonus tanggal ' + day + ' tidak ditemukan.');
        const check = inspectDatotTarget_(sheet, parsed.records);
        out.newCount = check.newRows.length; out.duplicateCount = check.duplicates; out.conflictCount = check.conflicts.length;
        out.conflicts = check.conflicts.slice(0, 10);
        if (check.conflicts.length) throw new Error('Ada nomor resi yang sudah tercatat dengan isi berbeda: ' + check.conflicts.slice(0, 5).join(', '));
        out.recordsToWrite = check.newRows;
      } else out.newCount = parsed.records.length;
    } else {
      if (parsed.reportDates.length !== 1 || parsed.reportDates[0] !== dateISO) throw new Error('Tanggal isi absensi harus hanya ' + dateISO + '. Terbaca: ' + (parsed.reportDates.join(', ') || 'tidak terbaca') + '.');
      if (parsed.duplicateCount) throw new Error('Ada NIB duplikat dalam file absensi (' + parsed.duplicateCount + ' baris).');
      if (parsed.records.some(function (r) { return !r.nib || !r.name; })) throw new Error('Ada baris absensi yang tidak memiliki NIB atau nama karyawan.');
      if (parsed.records.some(function (r) { return !r.checkIn && !r.checkOut; })) throw new Error('Ada karyawan tanpa jam masuk dan tanpa jam pulang. Periksa file sumber sebelum sinkronisasi.');
      out.sampleRecords = parsed.records.slice(0, 3).map(function (r) { return { nib: r.nib, name: r.name, checkIn: r.checkIn, checkOut: r.checkOut }; });
      if (inspectTargets) {
        if (!branch.attendanceSpreadsheetId) throw new Error('Spreadsheet Absensi belum dikonfigurasi.');
        const ss = SpreadsheetApp.openById(branch.attendanceSpreadsheetId);
        const sheet = ss.getSheetByName(day);
        if (!sheet) throw new Error('Tab absensi tanggal ' + day + ' tidak ditemukan.');
        const check = inspectAttendanceTarget_(sheet, parsed.records);
        out.newCount = check.newRows.length; out.duplicateCount = check.duplicates; out.conflictCount = check.conflicts.length;
        out.patchCount = check.patches.length; out.conflicts = check.conflicts.slice(0, 10);
        if (check.conflicts.length) throw new Error('Ada NIB yang sudah tercatat dengan jam berbeda: ' + check.conflicts.slice(0, 5).join(', '));
        out.recordsToWrite = check.newRows; out.patches = check.patches;
      } else out.newCount = parsed.records.length;
    }
    out.status = 'ready'; out.statusText = 'Siap disinkronkan.';
  } catch (err) {
    out.status = 'blocked'; out.statusText = err.message || String(err);
  }
  delete out.records; delete out.recordsToWrite; delete out.patches;
  return out;
}

function publicScan_(plan, dateISO) {
  return {
    ok: true,
    date: dateISO,
    fingerprint: plan.fingerprint,
    branches: (plan.branches || []).map(function (b) {
      function pub(item) {
        if (!item) return null;
        return {
          kind: item.kind, status: item.status, statusText: item.statusText || '', fileName: item.fileName || '',
          recordCount: item.recordCount || 0, newCount: item.newCount || 0, duplicateCount: item.duplicateCount || 0,
          conflictCount: item.conflictCount || 0, patchCount: item.patchCount || 0, branchCode: item.branchCode || '',
          totalOmset: item.totalOmset || 0, reportDates: item.reportDates || [], warnings: item.warnings || [],
          conflicts: item.conflicts || [], fileNames: item.fileNames || [], sampleRecords: item.sampleRecords || []
        };
      }
      return { branchId: b.branchId, branchName: b.branchName, folderStatus: b.folderStatus, folderStatusText: b.folderStatusText || '', dateFolderUrl: b.dateFolderUrl || '', unknownFiles: b.unknownFiles || [], datot: pub(b.datot), attendance: pub(b.attendance) };
    })
  };
}

/* ------------------------------- DATOT PARSER ---------------------------- */
function parseDatotHtml_(html, fileName) {
  if (typeof html !== 'string' || !/<table[\s>]/i.test(html)) throw new Error('File .xls bukan ekspor tabel HTML OPS yang dikenali.');
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const bodyText = decodeHtml_(clean.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (!/DATA\s+TOTAL\s+PENERIMAAN/i.test(bodyText)) throw new Error('Judul DATA TOTAL PENERIMAAN tidak ditemukan.');
  const titleMatch = clean.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
  const title = titleMatch ? stripHtml_(titleMatch[1]) : bodyText;
  const codeMatch = title.match(/DATA\s+TOTAL\s+PENERIMAAN\s+([A-Z0-9_-]+)/i);
  const branchCode = codeMatch ? codeMatch[1].toUpperCase() : '';
  const rangeMatch = bodyText.match(/Dari\s*(\d{4}-\d{2}-\d{2})\s*Sampai\s*(\d{4}-\d{2}-\d{2})/i);
  const reportStart = rangeMatch ? rangeMatch[1] : '';
  const reportEnd = rangeMatch ? rangeMatch[2] : '';
  const tableRows = clean.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  let dataRows = [];
  tableRows.forEach(function (tr) {
    const cells = [];
    const cellMatches = tr.match(/<(?:td|th)\b[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];
    cellMatches.forEach(function (cell) { cells.push(stripHtml_(cell.replace(/^<(?:td|th)\b[^>]*>/i, '').replace(/<\/(?:td|th)>$/i, ''))); });
    if (cells.length >= 18 && cells[4] && /[A-Z0-9]+\/[A-Z0-9]+/i.test(cells[4])) dataRows.push(cells.slice(0, 18));
  });
  const records = dataRows.map(function (c, index) {
    return {
      no: parseNumber_(c[0]) || index + 1,
      masuk: dateOnly_(c[1]) || c[1],
      berangkat: c[2] || '',
      pengirim: c[3] || '',
      noResi: c[4] || '',
      penerima: c[5] || '',
      tujuan: c[6] || '',
      koli: parseNumber_(c[7]),
      kg: parseNumber_(c[8]),
      m3: parseNumber_(c[9]),
      tunai: parseNumber_(c[10]),
      tujuanBayar: parseNumber_(c[11]),
      vaPengirim: parseNumber_(c[12]),
      vaTujuan: parseNumber_(c[13]),
      via: parseMaybeNumber_(c[14]),
      ot: parseMaybeNumber_(c[15]),
      status: c[16] || '',
      cab: String(c[17] || '').trim().toUpperCase()
    };
  });
  const resiSeen = {}, duplicateResi = [];
  records.forEach(function (r) { if (resiSeen[r.noResi]) duplicateResi.push(r.noResi); resiSeen[r.noResi] = true; });
  const rowCodes = unique_(records.map(function (r) { return r.cab; }).filter(Boolean));
  const totalMatch = bodyText.match(/Total\s+Omset(?:\s+Barang)?\s*:\s*Rp\.?\s*([\d.,]+)/i);
  const warnings = [];
  if (!branchCode && !rowCodes.length) warnings.push('Kode cabang OPS tidak ditemukan.');
  if (rowCodes.length > 1) warnings.push('Terdapat beberapa kode cabang dalam satu file: ' + rowCodes.join(', '));
  if (branchCode && rowCodes.some(function (code) { return code !== branchCode; })) warnings.push('Kode pada baris data berbeda dari kode pada judul laporan.');
  if (duplicateResi.length) warnings.push('Nomor resi duplikat dalam file: ' + unique_(duplicateResi).join(', '));
  if (!reportStart || !reportEnd) warnings.push('Periode laporan tidak terbaca dari header.');
  if (!records.length) warnings.push('Tidak ada baris resi yang berhasil dibaca.');
  const reportDates = unique_(records.map(function (r) { return dateOnly_(r.masuk); }).filter(Boolean)).sort();
  return { fileName: fileName, branchCode: branchCode || rowCodes[0] || '', reportStart: reportStart, reportEnd: reportEnd, reportDates: reportDates, records: records, totalOmset: totalMatch ? parseNumber_(totalMatch[1]) : records.reduce(function (sum, r) { return sum + r.tunai + r.tujuanBayar + r.vaPengirim + r.vaTujuan; }, 0), duplicateCount: duplicateResi.length, warnings: warnings };
}
function stripHtml_(value) {
  return decodeHtml_(String(value || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}
function decodeHtml_(value) {
  return String(value || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(Number(n)); }).replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCodePoint(parseInt(n, 16)); });
}
function parseNumber_(value) {
  let s = String(value == null ? '' : value).trim().replace(/^Rp\.?\s*/i, '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.indexOf('.') >= 0 && s.indexOf(',') >= 0) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  } else if (s.indexOf(',') >= 0) {
    const tail = s.split(',').pop(); s = tail.length === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (s.indexOf('.') >= 0) {
    const tail = s.split('.').pop(); if (tail.length === 3) s = s.replace(/\./g, '');
  }
  const n = Number(s); if (!isFinite(n)) throw new Error('Angka tidak valid: ' + value); return n;
}
function parseMaybeNumber_(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (/^-?\d+(?:[.,]\d+)?$/.test(s)) return parseNumber_(s);
  return s;
}
function dateOnly_(value) {
  const s = String(value || '').trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/); if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

/* ------------------------------ XLSX PARSER ------------------------------ */
function parseAttendanceXlsx_(blob, fileName) {
  const zipBlobs = Utilities.unzip(blob);
  const zip = {};
  zipBlobs.forEach(function (b) { zip[b.getName()] = b; });
  if (!zip['xl/workbook.xml']) throw new Error('XLSX tidak memiliki xl/workbook.xml.');
  const workbook = XmlService.parse(zip['xl/workbook.xml'].getDataAsString('UTF-8')).getRootElement();
  const mainNs = workbook.getNamespace();
  const relNs = XmlService.getNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
  const sheetsNode = workbook.getChild('sheets', mainNs);
  const sheetNodes = sheetsNode ? sheetsNode.getChildren('sheet', mainNs) : [];
  if (!sheetNodes.length) throw new Error('Workbook tidak memiliki worksheet.');
  const ridAttr = sheetNodes[0].getAttribute('id', relNs);
  const rid = ridAttr ? ridAttr.getValue() : '';
  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (zip['xl/_rels/workbook.xml.rels'] && rid) {
    const relDoc = XmlService.parse(zip['xl/_rels/workbook.xml.rels'].getDataAsString('UTF-8')).getRootElement();
    const rels = relDoc.getChildren();
    for (let i = 0; i < rels.length; i++) {
      const idAttr = rels[i].getAttribute('Id');
      if (idAttr && idAttr.getValue() === rid) {
        const targetAttr = rels[i].getAttribute('Target');
        if (targetAttr) sheetPath = normalizeZipPath_(targetAttr.getValue().charAt(0) === '/' ? targetAttr.getValue().slice(1) : 'xl/' + targetAttr.getValue());
        break;
      }
    }
  }
  if (!zip[sheetPath]) throw new Error('Worksheet tidak ditemukan: ' + sheetPath);
  const shared = zip['xl/sharedStrings.xml'] ? parseSharedStrings_(zip['xl/sharedStrings.xml']) : [];
  const sheetDoc = XmlService.parse(zip[sheetPath].getDataAsString('UTF-8')).getRootElement();
  const sheetNs = sheetDoc.getNamespace();
  const sheetData = sheetDoc.getChild('sheetData', sheetNs);
  if (!sheetData) throw new Error('Bagian sheetData tidak ditemukan.');
  const rows = sheetData.getChildren('row', sheetNs).map(function (rowNode) {
    const row = [];
    rowNode.getChildren('c', sheetNs).forEach(function (cell) {
      const refAttr = cell.getAttribute('r');
      const address = refAttr ? refAttr.getValue() : '';
      const col = columnIndex_(address);
      if (col >= 0) row[col] = xlsxCellValue_(cell, shared, sheetNs);
    });
    return row;
  });
  const headerIndex = rows.findIndex(function (row) {
    const h = row.map(normalizeHeader_);
    return h.indexOf('nib') >= 0 && h.indexOf('nama') >= 0 && h.some(function (x) { return x === 'absenmasuk' || x === 'masuk'; }) && h.some(function (x) { return x === 'absenkeluar' || x === 'keluar'; });
  });
  if (headerIndex < 0) throw new Error('Header absensi tidak dikenali. Kolom wajib: NIB, Nama, Absen Masuk, Absen Keluar.');
  const headers = rows[headerIndex].map(normalizeHeader_);
  const idx = { nib: headers.indexOf('nib'), name: headers.indexOf('nama'), in: headers.findIndex(function (x) { return x === 'absenmasuk' || x === 'masuk'; }), out: headers.findIndex(function (x) { return x === 'absenkeluar' || x === 'keluar'; }) };
  const records = [];
  rows.slice(headerIndex + 1).forEach(function (row) {
    const nib = String(row[idx.nib] == null ? '' : row[idx.nib]).trim().replace(/\.0$/, '');
    const name = String(row[idx.name] == null ? '' : row[idx.name]).trim();
    const checkIn = normalizeDateTime_(row[idx.in]);
    const checkOut = normalizeDateTime_(row[idx.out]);
    if (!nib && !name && !checkIn && !checkOut) return;
    if (!nib && !name) return;
    records.push({ nib: nib, name: name, checkIn: checkIn, checkOut: checkOut, checkInDate: dateOnly_(checkIn), checkOutDate: dateOnly_(checkOut) });
  });
  if (!records.length) throw new Error('Tidak ditemukan baris data karyawan pada file absensi.');
  const reportDates = unique_(records.reduce(function (all, r) { if (r.checkInDate) all.push(r.checkInDate); if (r.checkOutDate) all.push(r.checkOutDate); return all; }, [])).sort();
  const seen = {}, duplicateKeys = [];
  records.forEach(function (r) { const key = r.nib + '|' + (r.checkInDate || r.checkOutDate); if (seen[key]) duplicateKeys.push(key); seen[key] = true; });
  const warnings = [];
  if (reportDates.length > 1) warnings.push('File berisi lebih dari satu tanggal absensi: ' + reportDates.join(', '));
  if (duplicateKeys.length) warnings.push('Terdapat NIB duplikat pada tanggal yang sama: ' + duplicateKeys.length + ' baris.');
  const missingIn = records.filter(function (r) { return !r.checkIn; }).length;
  const missingOut = records.filter(function (r) { return !r.checkOut; }).length;
  if (missingIn) warnings.push(missingIn + ' karyawan tidak memiliki jam masuk.');
  if (missingOut) warnings.push(missingOut + ' karyawan tidak memiliki jam pulang.');
  return { fileName: fileName, records: records, reportDates: reportDates, duplicateCount: duplicateKeys.length, missingIn: missingIn, missingOut: missingOut, warnings: warnings };
}
function parseSharedStrings_(blob) {
  const root = XmlService.parse(blob.getDataAsString('UTF-8')).getRootElement();
  const ns = root.getNamespace();
  return root.getChildren('si', ns).map(function (si) { return collectXmlText_(si); });
}
function collectXmlText_(node) {
  let out = '';
  if (node.getName && node.getName() === 't') out += node.getText();
  node.getChildren().forEach(function (child) { out += collectXmlText_(child); });
  return out;
}
function xlsxCellValue_(cell, shared, ns) {
  const typeAttr = cell.getAttribute('t'); const type = typeAttr ? typeAttr.getValue() : '';
  if (type === 'inlineStr') { const isNode = cell.getChild('is', ns); return isNode ? collectXmlText_(isNode) : ''; }
  const v = cell.getChild('v', ns); const raw = v ? v.getText() : '';
  if (type === 's') return shared[Number(raw)] == null ? '' : shared[Number(raw)];
  if (type === 'b') return raw === '1';
  return raw;
}
function normalizeHeader_(value) { return String(value == null ? '' : value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function columnIndex_(address) {
  const m = String(address || '').match(/^[A-Z]+/i); if (!m) return -1;
  let n = 0; m[0].toUpperCase().split('').forEach(function (c) { n = n * 26 + c.charCodeAt(0) - 64; }); return n - 1;
}
function normalizeZipPath_(path) {
  const parts = []; String(path || '').replace(/^\//, '').split('/').forEach(function (p) { if (!p || p === '.') return; if (p === '..') parts.pop(); else parts.push(p); }); return parts.join('/');
}
function normalizeDateTime_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const serial = Number(value); if (!isFinite(serial) || serial < 1) return '';
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000));
    return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd HH:mm:ss');
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)/);
  if (m) return m[1] + ' ' + (m[2].length === 5 ? m[2] + ':00' : m[2]);
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) + ' ' + (m[4].length === 5 ? m[4] + ':00' : m[4]);
  return s;
}

/* ------------------------------ TARGET CHECKS ---------------------------- */
function inspectDatotTarget_(sheet, records) {
  const last = Math.max(BARAKA_OPS.BONUS_FIRST_ROW - 1, sheet.getLastRow());
  const height = Math.max(0, last - BARAKA_OPS.BONUS_FIRST_ROW + 1);
  const values = height ? sheet.getRange(BARAKA_OPS.BONUS_FIRST_ROW, 1, height, BARAKA_OPS.BONUS_COLS).getValues() : [];
  const existing = {};
  values.forEach(function (row, i) {
    const resi = String(row[BARAKA_OPS.BONUS_RESI_COL - 1] || '').trim();
    if (!resi) return;
    if (existing[resi]) existing[resi].duplicateRows = true;
    else existing[resi] = { row: row, rowNumber: BARAKA_OPS.BONUS_FIRST_ROW + i, duplicateRows: false };
  });
  const newRows = [], conflicts = []; let duplicates = 0;
  records.forEach(function (record) {
    const row = datotRowValues_(record);
    const old = existing[record.noResi];
    if (!old) newRows.push({ values: row, record: record });
    else if (old.duplicateRows) conflicts.push(record.noResi + ' (sudah ganda di sheet tujuan)');
    else if (sameRow_(old.row, row, BARAKA_OPS.BONUS_COLS)) duplicates++;
    else conflicts.push(record.noResi);
  });
  return { newRows: newRows, duplicates: duplicates, conflicts: conflicts };
}
function datotRowValues_(r) {
  return [Number(r.no) || '', toSheetDate_(r.masuk, false), toSheetDate_(r.berangkat, true), r.pengirim || '', r.noResi || '', r.penerima || '', r.tujuan || '', Number(r.koli) || 0, Number(r.kg) || 0, Number(r.m3) || 0, Number(r.tunai) || 0, Number(r.tujuanBayar) || 0, Number(r.vaPengirim) || 0, Number(r.vaTujuan) || 0, r.via || '', r.ot || '', r.status || '', String(r.cab || '').toUpperCase()];
}
function sameRow_(oldRow, newRow, length) {
  for (let i = 0; i < length; i++) {
    if (comparable_(oldRow[i], i) !== comparable_(newRow[i], i)) return false;
  }
  return true;
}
function comparable_(value, index) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, BARAKA_OPS.TIME_ZONE, index === 1 || index === 2 ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
  if (typeof value === 'number') return String(Number(value.toFixed(6)));
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}
function toSheetDate_(value, allowText) {
  if (!value) return '';
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  if (allowText) return s;
  return s;
}
function findLastNonEmptyRow_(sheet, startRow, startCol, numCols) {
  const last = Math.max(startRow - 1, sheet.getLastRow());
  if (last < startRow) return startRow - 1;
  const values = sheet.getRange(startRow, startCol, last - startRow + 1, numCols).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i].some(function (v) { return v !== '' && v !== null; })) return startRow + i;
  }
  return startRow - 1;
}
function ensureRows_(sheet, neededLastRow) {
  const max = sheet.getMaxRows();
  if (neededLastRow > max) sheet.insertRowsAfter(max, neededLastRow - max);
}
function copyBonusFormulaTemplate_(sheet, startRow, endRow) {
  if (endRow < startRow) return;
  const last = Math.max(startRow - 1, sheet.getLastRow());
  let templateRow = 0, templateFormulas = null;
  for (let r = Math.min(last, startRow - 1); r >= BARAKA_OPS.BONUS_FIRST_ROW; r--) {
    const f = sheet.getRange(r, 19, 1, 8).getFormulasR1C1()[0];
    if (f.some(Boolean)) { templateRow = r; templateFormulas = f; break; }
  }
  if (!templateRow || !templateFormulas) return;
  for (let r = startRow; r <= endRow; r++) {
    const existing = sheet.getRange(r, 19, 1, 8).getFormulasR1C1()[0];
    if (!existing.some(Boolean)) sheet.getRange(r, 19, 1, 8).setFormulasR1C1([templateFormulas]);
  }
}

/**
 * Aturan ABSENSI BARAKA:
 * B/C = NIB/Nama dari file, D = jam datang (boleh kosong).
 * F/G = SELALU NIB/Nama identik dengan B/C, H = jam pulang (boleh kosong).
 * Untuk data lama, lengkapi sel kosong tanpa menghapus jam yang telah tercatat.
 * Konflik identitas dan jam yang berbeda tidak ditimpa otomatis.
 */
function inspectAttendanceTarget_(sheet, records) {
  const last = Math.max(BARAKA_OPS.ATTENDANCE_FIRST_ROW - 1, sheet.getLastRow());
  const height = Math.max(0, last - BARAKA_OPS.ATTENDANCE_FIRST_ROW + 1);
  const left = height ? sheet.getRange(BARAKA_OPS.ATTENDANCE_FIRST_ROW, 2, height, 3).getValues() : [];
  const right = height ? sheet.getRange(BARAKA_OPS.ATTENDANCE_FIRST_ROW, 6, height, 3).getValues() : [];
  const existing = {};
  const clean = function (v) { return String(v == null ? '' : v).trim(); };
  const nibKey = function (v) { return clean(v).replace(/\.0$/, ''); };
  const nameKey = function (v) { return clean(v).normalize('NFKC').replace(/\s+/g, ' ').toLocaleUpperCase('id-ID'); };
  for (let i = 0; i < height; i++) {
    const nibIn = nibKey(left[i][0]), nibOut = nibKey(right[i][0]);
    const nib = nibIn || nibOut;
    if (!nib) continue;
    if (existing[nib]) { existing[nib].duplicateRows = true; continue; }
    existing[nib] = {
      rowNumber: BARAKA_OPS.ATTENDANCE_FIRST_ROW + i,
      inName: left[i][1], inTime: left[i][2],
      outName: right[i][1], outTime: right[i][2],
      nibIn: nibIn, nibOut: nibOut
    };
  }
  const newRows = [], patches = [], conflicts = [];
  let duplicates = 0;
  const seen = {};
  records.forEach(function (r) {
    const nib = nibKey(r.nib), name = clean(r.name);
    if (seen[nib]) { conflicts.push(nib + ' (duplikat dalam file)'); return; }
    seen[nib] = true;
    const old = existing[nib];
    if (!old) { newRows.push(r); return; }
    if (old.duplicateRows) { conflicts.push(nib + ' (lebih dari satu baris di sheet)'); return; }
    // Jangan mengubah identitas karyawan yang sebelumnya berbeda.
    if ((old.nibIn && old.nibIn !== nib) || (old.nibOut && old.nibOut !== nib) ||
        (clean(old.inName) && nameKey(old.inName) !== nameKey(name)) ||
        (clean(old.outName) && nameKey(old.outName) !== nameKey(name))) {
      conflicts.push(nib + ' (NIB/nama di sheet tidak sesuai data sumber)');
      return;
    }
    const oldIn = dateTimeComparable_(old.inTime), oldOut = dateTimeComparable_(old.outTime);
    const newIn = r.checkIn || '', newOut = r.checkOut || '';
    if ((oldIn && newIn && oldIn !== newIn) || (oldOut && newOut && oldOut !== newOut)) {
      conflicts.push(nib + ' (jam berbeda dari data yang sudah ada)');
      return;
    }
    // Patch tiap sel agar F/G bisa dilengkapi walaupun H tetap kosong.
    const cells = {};
    if (!old.nibIn) cells[2] = nib;
    if (!clean(old.inName)) cells[3] = name;
    if (!oldIn && newIn) cells[4] = newIn;
    if (!old.nibOut) cells[6] = nib;
    if (!clean(old.outName)) cells[7] = name;
    if (!oldOut && newOut) cells[8] = newOut;
    if (Object.keys(cells).length) patches.push({ rowNumber: old.rowNumber, cells: cells });
    else duplicates++;
  });
  return { newRows: newRows, patches: patches, duplicates: duplicates, conflicts: conflicts };
}
function dateTimeComparable_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, BARAKA_OPS.TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  return normalizeDateTime_(s);
}

/* --------------------------------- WRITES -------------------------------- */
function commitDatot_(branchPlan) {
  const b = branchPlan.config;
  const parsed = parseDatotHtml_(DriveApp.getFileById(branchPlan.datot.fileId).getBlob().getDataAsString('UTF-8'), branchPlan.datot.fileName);
  // Pertahankan kode tujuan persis seperti yang tercantum pada file Datot.
  const ss = SpreadsheetApp.openById(b.bonusSpreadsheetId);
  const day = String(Number(branchPlan.date.slice(-2)));
  const sheet = ss.getSheetByName(day);
  if (!sheet) throw new Error('Tab bonus tanggal ' + day + ' tidak ditemukan.');
  const check = inspectDatotTarget_(sheet, destinationResult.records);
  if (check.conflicts.length) throw new Error('Konflik nomor resi: ' + check.conflicts.slice(0, 5).join(', '));
  if (!check.newRows.length) return { ok: true, status: 'Semua resi sudah tercatat.', added: 0, skipped: check.duplicates };
  const last = findLastNonEmptyRow_(sheet, BARAKA_OPS.BONUS_FIRST_ROW, 1, BARAKA_OPS.BONUS_COLS);
  const start = Math.max(BARAKA_OPS.BONUS_FIRST_ROW, last + 1);
  const end = start + check.newRows.length - 1;
  ensureRows_(sheet, end);
  sheet.getRange(start, 1, check.newRows.length, BARAKA_OPS.BONUS_COLS).setValues(check.newRows.map(function (x) { return x.values; }));
  sheet.getRange(start, 2, check.newRows.length, 1).setNumberFormat('dd/MM/yyyy');
  copyBonusFormulaTemplate_(sheet, start, end);
  SpreadsheetApp.flush();
  return { ok: true, status: 'Datot berhasil dimasukkan ke tab ' + day + '.', added: check.newRows.length, skipped: check.duplicates, firstRow: start, lastRow: end };
}

function commitAttendance_(branchPlan) {
  const b = branchPlan.config;
  const parsed = parseAttendanceXlsx_(DriveApp.getFileById(branchPlan.attendance.fileId).getBlob(), branchPlan.attendance.fileName);
  const ss = SpreadsheetApp.openById(b.attendanceSpreadsheetId);
  const day = String(Number(branchPlan.date.slice(-2)));
  const sheet = ss.getSheetByName(day);
  if (!sheet) throw new Error('Tab absensi tanggal ' + day + ' tidak ditemukan.');
  const check = inspectAttendanceTarget_(sheet, parsed.records);
  if (check.conflicts.length) throw new Error('Konflik NIB: ' + check.conflicts.slice(0, 5).join(', '));
  // Preflight semua sel terlebih dahulu agar error formula tidak membuat patch setengah jalan.
  check.patches.forEach(function (p) {
    Object.keys(p.cells).forEach(function (column) {
      const cell = sheet.getRange(p.rowNumber, Number(column));
      if (cell.getFormula && cell.getFormula()) throw new Error('Formula ditemukan pada ' + cell.getA1Notation() + '; pembaruan dibatalkan.');
    });
  });
  check.patches.forEach(function (p) {
    Object.keys(p.cells).forEach(function (column) {
      const col = Number(column);
      const value = (col === 4 || col === 8) ? toSheetDate_(p.cells[col], false) : p.cells[col];
      const cell = sheet.getRange(p.rowNumber, col);
      cell.setValue(value);
      if (col === 4 || col === 8) cell.setNumberFormat(BARAKA_OPS.ATTENDANCE_DATE_FORMAT);
    });
  });
  if (!check.newRows.length) {
    SpreadsheetApp.flush();
    return { ok: true, status: check.patches.length ? 'Data absensi yang sebelumnya kosong berhasil dilengkapi.' : 'Semua data absensi sudah tercatat.', added: 0, patched: check.patches.length, skipped: check.duplicates };
  }
  const last = findLastAttendanceRow_(sheet);
  const start = Math.max(BARAKA_OPS.ATTENDANCE_FIRST_ROW, last + 1);
  const end = start + check.newRows.length - 1;
  ensureRows_(sheet, end);
  // Identitas harus lengkap dan sama pada DATANG/PULANG, meskipun jam kosong.
  const left = check.newRows.map(function (r) { return [String(r.nib), r.name, r.checkIn ? toSheetDate_(r.checkIn, false) : '']; });
  const right = check.newRows.map(function (r) { return [String(r.nib), r.name, r.checkOut ? toSheetDate_(r.checkOut, false) : '']; });
  sheet.getRange(start, 2, check.newRows.length, 3).setValues(left);
  sheet.getRange(start, 6, check.newRows.length, 3).setValues(right);
  sheet.getRange(start, 4, check.newRows.length, 1).setNumberFormat(BARAKA_OPS.ATTENDANCE_DATE_FORMAT);
  sheet.getRange(start, 8, check.newRows.length, 1).setNumberFormat(BARAKA_OPS.ATTENDANCE_DATE_FORMAT);
  SpreadsheetApp.flush();
  return { ok: true, status: 'Absensi berhasil dimasukkan ke tab ' + day + '.', added: check.newRows.length, patched: check.patches.length, skipped: check.duplicates, firstRow: start, lastRow: end };
}
function findLastAttendanceRow_(sheet) {
  const last = Math.max(BARAKA_OPS.ATTENDANCE_FIRST_ROW - 1, sheet.getLastRow());
  if (last < BARAKA_OPS.ATTENDANCE_FIRST_ROW) return BARAKA_OPS.ATTENDANCE_FIRST_ROW - 1;
  const h = last - BARAKA_OPS.ATTENDANCE_FIRST_ROW + 1;
  const left = sheet.getRange(BARAKA_OPS.ATTENDANCE_FIRST_ROW, 2, h, 3).getValues();
  const right = sheet.getRange(BARAKA_OPS.ATTENDANCE_FIRST_ROW, 6, h, 3).getValues();
  for (let i = h - 1; i >= 0; i--) {
    if (left[i].some(function (v) { return v !== '' && v !== null; }) || right[i].some(function (v) { return v !== '' && v !== null; })) return BARAKA_OPS.ATTENDANCE_FIRST_ROW + i;
  }
  return BARAKA_OPS.ATTENDANCE_FIRST_ROW - 1;
}

/* ------------------------------- AUDIT LOG ------------------------------- */
function ensureAuditSheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty(BARAKA_OPS.AUDIT_ID_KEY);
  if (id) {
    const existing = SpreadsheetApp.openById(id);
    return { id: id, sheet: existing.getSheetByName('LOG') || existing.insertSheet('LOG') };
  }
  const ss = SpreadsheetApp.create('BARAKA PeopleOS — Log Integrasi Operasional');
  const sheet = ss.getSheets()[0]; sheet.setName('LOG');
  sheet.appendRow(['Waktu', 'Tanggal OPS', 'ID Cabang', 'Nama Cabang', 'Jenis Data', 'Status', 'Ditambahkan', 'Dilewati', 'Dilengkapi', 'Rincian']);
  sheet.setFrozenRows(1);
  props.setProperty(BARAKA_OPS.AUDIT_ID_KEY, ss.getId());
  const config = loadConfig_(); config.auditSpreadsheetId = ss.getId();
  PropertiesService.getScriptProperties().setProperty(BARAKA_OPS.CONFIG_KEY, JSON.stringify(config));
  return { id: ss.getId(), sheet: sheet };
}
function logOpsRun_(dateISO, results, summary) {
  const audit = ensureAuditSheet_();
  const rows = [];
  results.forEach(function (r) {
    ['datot', 'attendance'].forEach(function (kind) {
      const x = r[kind]; if (!x) return;
      rows.push([new Date(), dateISO, r.branchId, r.branchName, kind === 'datot' ? 'Data Total Penerimaan' : 'Absensi', x.ok ? 'Berhasil' : 'Perlu pemeriksaan', Number(x.added || 0), Number(x.skipped || 0), Number(x.patched || 0), String(x.status || '').slice(0, 500)]);
    });
  });
  if (rows.length) {
    const start = audit.sheet.getLastRow() + 1;
    audit.sheet.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
    audit.sheet.getRange(start, 1, rows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
  }
}
function getAuditUrl_() {
  const config = loadConfig_(); return config.auditSpreadsheetId ? 'https://docs.google.com/spreadsheets/d/' + config.auditSpreadsheetId + '/edit' : '';
}
function summarizeCommit_(results) {
  const summary = { successes: 0, failures: 0, addedDatot: 0, addedAttendance: 0, skipped: 0, patched: 0 };
  results.forEach(function (r) {
    ['datot', 'attendance'].forEach(function (k) {
      const x = r[k]; if (!x) return;
      if (x.ok) summary.successes++; else summary.failures++;
      if (k === 'datot') summary.addedDatot += Number(x.added || 0);
      else summary.addedAttendance += Number(x.added || 0);
      summary.skipped += Number(x.skipped || 0); summary.patched += Number(x.patched || 0);
    });
  });
  return summary;
}
function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { const v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
}
function normalizeDestinationMap_(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {}; Object.keys(value).forEach(function (k) { const code = String(k).trim().toUpperCase(); const name = String(value[k] || '').trim(); if (code && name) out[code] = name; }); return out;
  }
  const out = {};
  String(value || '').split(/[\r\n;]+/).forEach(function (line) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) out[m[1].toUpperCase()] = m[2];
  });
  return Object.keys(out).length ? out : BARAKA_OPS.DEFAULT_DESTINATION_MAP;
}
function destinationMapToText_(map) {
  return Object.keys(map || {}).sort().map(function (code) { return code + '=' + map[code]; }).join('\n');
}
function resolveDestinations_(records, map) {
  const lookup = map || BARAKA_OPS.DEFAULT_DESTINATION_MAP;
  const unmapped = [];
  const resolved = records.map(function (record) {
    const code = String(record.tujuan || '').trim().toUpperCase();
    if (/^\d{3}[A-Z]{3}$/.test(code)) {
      if (lookup[code]) return Object.assign({}, record, { tujuan: lookup[code] });
      unmapped.push(code); return record;
    }
    return record;
  });
  return { records: resolved, unmapped: unique_(unmapped) };
}
function unique_(arr) { const seen = {}; return arr.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }); }

function cekSumberPontianakBarat() {
  const folderId =
    '1c4fWzC_6YtJ0g0qWj275xwuF_0sbOGqx';

  const spreadsheetId =
    '1edl_IBeH0ilza4C4iARV4jjoJdmkfFd2gNU6tASJRfE';

  const sheetName =
    'HITUNGAN BONUS STANDBY CABANG PONTIANAK';

  const expectedGid = 690530022;

  // Pemeriksaan baca saja
  const folder = DriveApp.getFolderById(folderId);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Tab tujuan tidak ditemukan.');
  }

  if (sheet.getSheetId() !== expectedGid) {
    throw new Error('GID tab tidak sesuai.');
  }

  const config = loadConfig_();

  Logger.log(JSON.stringify({
    folderName: folder.getName(),
    spreadsheetName: ss.getName(),
    sheetName: sheet.getName(),
    sheetGid: sheet.getSheetId(),
    existingBranches: (config.branches || []).map(
      b => ({
        branchId: b.branchId,
        branchName: b.branchName
      })
    ),
    configVersion: config.version || 0,
    verification: 'BERHASIL - READ ONLY'
  }, null, 2));
}

function daftarTabBonusPontianakBarat() {
  const spreadsheetId =
    '1edl_IBeH0ilza4C4iARV4jjoJdmkfFd2gNU6tASJRfE';

  const ss = SpreadsheetApp.openById(spreadsheetId);

  const daftarTab = ss.getSheets().map(function(sheet) {
    return {
      namaTab: sheet.getName(),
      gid: sheet.getSheetId()
    };
  });

  Logger.log(JSON.stringify(daftarTab, null, 2));
}

