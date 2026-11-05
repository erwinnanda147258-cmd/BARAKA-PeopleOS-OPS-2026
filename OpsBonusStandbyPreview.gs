/**
 * BARAKA PeopleOS — Preview OPS -> HITUNGAN BONUS STANDBY (Pontianak Barat)
 * Versi aman: READ ONLY. Tidak menyimpan konfigurasi, membuat folder, atau menulis sel.
 * File ini TAMBAHAN. Jangan mengganti Kode.gs/Index.html/OpsConsole.html lama.
 * Input: folder cabang, spreadsheet bonus, tanggal, dan opsional URL file Datot.
 * Output: pemeriksaan sumber, duplikasi/konflik, dan rencana slot dua baris.
 */
const BARAKA_BONUS_PREVIEW = Object.freeze({
  BRANCH_CODE: '014PTK',
  UPLOAD_FOLDER: 'UPLOAD OPERASIONAL',
  FIRST_NUMBER_ROW: 5,
  FIRST_DATA_ROW: 6,
  MAX_SLOTS: 1500,
  MAX_FILE_BYTES: 5 * 1024 * 1024,
  MAX_PREVIEW_ROWS: 80
});

/** Endpoint READ ONLY untuk dipanggil dari BonusPreview.html. */
function previewBonusStandbyPontianakBarat(payload) {
  assertAuthorized_(); // menggunakan kontrol akses yang sudah ada di Kode.gs
  payload = payload || {};
  const dateISO = String(payload.dateISO || '').trim();
  bonusPreviewAssertDate_(dateISO);
  const folderId = bonusPreviewGoogleId_(payload.branchFolderUrl, 'folder');
  const spreadsheetId = bonusPreviewGoogleId_(payload.bonusSpreadsheetUrl, 'spreadsheet');
  const folder = DriveApp.getFolderById(folderId);
  const file = bonusPreviewFindFile_(folder, dateISO, payload.fileUrl || '');
  if (file.getSize() > BARAKA_BONUS_PREVIEW.MAX_FILE_BYTES) {
    throw new Error('File Datot melebihi 5 MB. Periksa isi file.');
  }
  const source = bonusPreviewParseDatot_(file.getBlob().getDataAsString('UTF-8'), file.getName());
  if (source.branchCode !== BARAKA_BONUS_PREVIEW.BRANCH_CODE) {
    throw new Error('Kode cabang pada laporan adalah ' + (source.branchCode || '(kosong)') + ', seharusnya 014PTK.');
  }
  if (source.reportStart !== dateISO || source.reportEnd !== dateISO) {
    throw new Error('Periode laporan ' + source.reportStart + ' sampai ' + source.reportEnd + ' tidak sama dengan ' + dateISO + '.');
  }
  source.records.forEach(function (r) {
    if (r.masuk !== dateISO) throw new Error('Tanggal resi ' + r.noResi + ' berbeda dari tanggal yang dipilih.');
    if (r.cab !== source.branchCode) throw new Error('Kode cabang pada resi ' + r.noResi + ' berbeda dari header.');
  });
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const tabName = String(Number(dateISO.slice(-2)));
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab tanggal "' + tabName + '" tidak ditemukan di spreadsheet tujuan.');
  const recap = ss.getSheetByName('BONUS');
  if (recap) {
    const monthText = String(recap.getRange('B2').getDisplayValue() || '').trim().toUpperCase();
    const monthNames = ['JANUARI','FEBRUARI','MARET','APRIL','MEI','JUNI','JULI','AGUSTUS','SEPTEMBER','OKTOBER','NOVEMBER','DESEMBER'];
    const expectedMonth = monthNames[Number(dateISO.slice(5, 7)) - 1];
    if (monthNames.indexOf(monthText) >= 0 && monthText !== expectedMonth) {
      throw new Error('Bulan pada BONUS!B2 adalah ' + monthText + ', tetapi file OPS bertanggal ' + expectedMonth + '. Periksa periode workbook.');
    }
  }
  const config = loadConfig_(); // Membaca mapping tersimpan; tidak menyimpan konfigurasi.
  const plan = bonusPreviewInspectTarget_(sheet, source.records, ss.getSpreadsheetTimeZone ? ss.getSpreadsheetTimeZone() : 'Asia/Jakarta', dateISO, config.destinationMap || {});
  const report = {
    ok: true,
    mode: 'READ_ONLY',
    writeEnabled: false,
    date: dateISO,
    branchCode: source.branchCode,
    source: {
      fileName: file.getName(),
      fileId: file.getId(),
      recordCount: source.records.length,
      totalOmset: source.totalOmset,
      totalKg: source.totalKg,
      totalM3: source.totalM3,
      reportStart: source.reportStart,
      reportEnd: source.reportEnd
    },
    target: { spreadsheetName: ss.getName(), tabName: tabName, spreadsheetId: spreadsheetId },
    summary: { newRecords: plan.newRows.length, existingSame: plan.existingSame.length, existingDifferent: plan.conflicts.length, slotsAvailable: plan.slotsAvailable },
    plannedRows: plan.newRows.slice(0, BARAKA_BONUS_PREVIEW.MAX_PREVIEW_ROWS),
    duplicates: plan.existingSame.slice(0, BARAKA_BONUS_PREVIEW.MAX_PREVIEW_ROWS),
    conflicts: plan.conflicts.slice(0, BARAKA_BONUS_PREVIEW.MAX_PREVIEW_ROWS),
    warnings: plan.warnings,
    diagnostics: plan.diagnostics.slice(0, BARAKA_BONUS_PREVIEW.MAX_PREVIEW_ROWS),
    diagnosticsTruncated: plan.diagnostics.length > BARAKA_BONUS_PREVIEW.MAX_PREVIEW_ROWS,
    note: 'Hanya membaca Drive dan Google Sheets. Tidak ada perubahan sel, rumus, format, atau tab.'
  };
  return report;
}

function bonusPreviewGoogleId_(value, kind) {
  const s = String(value || '').trim();
  if (!s) throw new Error('URL atau ID ' + (kind === 'folder' ? 'folder cabang' : 'spreadsheet bonus') + ' belum diisi.');
  if (/^[A-Za-z0-9_-]{15,}$/.test(s)) return s;
  const rx = kind === 'folder' ? /drive\.google\.com\/drive\/folders\/([A-Za-z0-9_-]+)/i : /docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/i;
  const m = s.match(rx);
  if (!m) throw new Error('URL ' + kind + ' tidak dikenali. Salin dari bilah alamat Google Drive/Sheets.');
  return m[1];
}
function bonusPreviewAssertDate_(s) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('Tanggal harus berformat YYYY-MM-DD.');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.toISOString().slice(0, 10) !== s) throw new Error('Tanggal tidak valid: ' + s);
}
function bonusPreviewSingleFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (!it.hasNext()) throw new Error('Folder "' + name + '" belum ada di "' + parent.getName() + '".');
  const f = it.next();
  if (it.hasNext()) throw new Error('Ditemukan lebih dari satu folder bernama "' + name + '". Rapikan folder dahulu.');
  return f;
}
function bonusPreviewFindFile_(branchFolder, dateISO, fileUrl) {
  // URL file langsung boleh dipakai untuk menguji sumber; tidak mengubah struktur Drive.
  if (String(fileUrl || '').trim()) {
    const s = String(fileUrl).trim();
    const m = s.match(/\/file\/d\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
    const id = m ? m[1] : (/^[A-Za-z0-9_-]{15,}$/.test(s) ? s : '');
    if (!id) throw new Error('URL file OPS tidak valid. Gunakan link Drive file atau ID file.');
    const f = DriveApp.getFileById(id);
    if (!/\.(xls|html|htm)$/i.test(f.getName())) throw new Error('File yang dipilih bukan Datot .xls/.html.');
    return f;
  }
  const upload = branchFolder.getName() === BARAKA_BONUS_PREVIEW.UPLOAD_FOLDER ? branchFolder : bonusPreviewSingleFolder_(branchFolder, BARAKA_BONUS_PREVIEW.UPLOAD_FOLDER);
  const dated = bonusPreviewSingleFolder_(upload, dateISO);
  const files = dated.getFiles();
  const matches = [];
  while (files.hasNext()) {
    const f = files.next();
    if (/\.(xls|html|htm)$/i.test(f.getName())) matches.push(f);
  }
  if (!matches.length) throw new Error('Belum ada file Datot .xls di folder tanggal ' + dateISO + '.');
  if (matches.length !== 1) throw new Error('Ada ' + matches.length + ' file Datot pada folder tanggal. Sisakan satu file final untuk mencegah impor ganda.');
  return matches[0];
}
function bonusPreviewDecode_(s) {
  return String(s || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCodePoint(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCodePoint(parseInt(n, 16)); });
}
function bonusPreviewCellText_(s) {
  return bonusPreviewDecode_(String(s || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ' '))
    .split('\n').map(function (part) { return part.replace(/\s+/g, ' ').trim(); }).filter(Boolean).join('\n');
}
function bonusPreviewNumber_(value, decimal) {
  const s = String(value == null ? '' : value).replace(/\s/g, '').replace(/^Rp\.?/i, '');
  if (!s || s === '-' || s === '--') return 0;
  if (!/^-?[\d.,]+$/.test(s)) throw new Error('Angka tidak valid: ' + value);
  let n;
  if (s.includes(',') && s.includes('.')) {
    // Pemisah ribuan dan desimal harus membentuk grup yang sah.
    if (/^-?\d{1,3}(?:\.\d{3})+,\d+$/.test(s)) n = Number(s.replace(/\./g, '').replace(',', '.'));
    else if (/^-?\d{1,3}(?:,\d{3})+\.\d+$/.test(s)) n = Number(s.replace(/,/g, ''));
    else throw new Error('Format angka ambigu: ' + value);
  } else if (decimal) {
    // Khusus M3: 0,053 dan 0.053 harus menjadi 0.053 (bukan 53).
    if (!/^-?\d+(?:[.,]\d+)?$/.test(s)) throw new Error('Format angka ambigu: ' + value);
    n = Number(s.replace(',', '.'));
  } else if (/^-?\d{1,3}([.,]\d{3})+$/.test(s)) {
    n = Number(s.replace(/[.,]/g, ''));
  } else if (/^-?\d+$/.test(s)) {
    n = Number(s);
  } else if (/^-?\d+[.,]\d{1,2}$/.test(s)) {
    n = Number(s.replace(',', '.')); // berat kg pecahan, jika ada
  } else throw new Error('Format angka ambigu: ' + value);
  if (!isFinite(n)) throw new Error('Angka di luar batas: ' + value);
  return n;
}
function bonusPreviewDate_(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s === '-') return '';
  let iso = '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) iso = m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) iso = m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  if (!iso) throw new Error('Format tanggal tidak dikenali: ' + s);
  bonusPreviewAssertDate_(iso);
  return iso;
}
function bonusPreviewParseDatot_(html, fileName) {
  if (!/<table\b/i.test(html)) throw new Error('File .xls bukan tabel HTML ekspor OPS.');
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const allText = bonusPreviewCellText_(clean).replace(/\s+/g, ' ');
  const title = (clean.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i) || [,''])[1];
  const codeMatch = bonusPreviewCellText_(title).match(/DATA\s+TOTAL\s+PENERIMAAN\s+([A-Z0-9_-]+)/i);
  const dateMatch = allText.match(/Dari\s*(\d{4}-\d{2}-\d{2})\s*Sampai\s*(\d{4}-\d{2}-\d{2})/i);
  if (!codeMatch || !dateMatch) throw new Error('Judul cabang atau periode DATA TOTAL PENERIMAAN tidak terbaca.');
  const rows = clean.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const records = [];
  rows.forEach(function (row) {
    const raw = row.match(/<(?:td|th)\b[^>]*>[\s\S]*?<\/(?:td|th)>/gi) || [];
    const c = raw.map(function (cell) { return bonusPreviewCellText_(cell.replace(/^<(?:td|th)\b[^>]*>/i, '').replace(/<\/(?:td|th)>$/i, '')); });
    const isReceipt = function (v) { return /^[A-Z0-9-]+\/[A-Z0-9]+$/i.test(v); };
    if (raw.length !== 18) {
      if (c.some(isReceipt)) throw new Error('Baris resi Datot tidak memiliki 18 kolom; mapping A:R belum dapat dibuktikan.');
      return;
    }
    if (!isReceipt(c[4])) {
      const header = c.map(function (v) { return bonusPreviewNormText_(v).replace(/[^A-Z0-9]/g, ''); });
      if (header.some(function (v) { return /^(?:NO|NOMOR)?RESI$/.test(v); })) {
        if (!/^(?:NO|NOMOR)?RESI$/.test(header[4]) || !header[6].includes('TUJUAN') || !header[17].includes('CAB')) {
          throw new Error('Urutan kolom Datot berubah; mapping E=Resi, G=Tujuan, R=Cab tidak sesuai.');
        }
      }
      if (c.some(isReceipt)) throw new Error('Nomor resi Datot tidak berada pada kolom E.');
      return;
    }
    if (raw.some(function (cell) { return /\b(?:rowspan|colspan)\s*=\s*["']?(?:[2-9]|[1-9]\d)/i.test(cell.split('>')[0]); })) {
      throw new Error('Baris Datot dengan resi memakai rowspan/colspan; mapping A:R belum dapat dibuktikan.');
    }
    const parts = c[16].split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    records.push({
      no: bonusPreviewNumber_(c[0], false), masuk: bonusPreviewDate_(c[1]), berangkat: bonusPreviewDate_(c[2]),
      pengirim: c[3], noResi: c[4], penerima: c[5], tujuan: c[6].toUpperCase(),
      koli: bonusPreviewNumber_(c[7], false), kg: bonusPreviewNumber_(c[8], false), m3: bonusPreviewNumber_(c[9], true),
      tunai: bonusPreviewNumber_(c[10], false), tujuanBayar: bonusPreviewNumber_(c[11], false),
      vaPengirim: bonusPreviewNumber_(c[12], false), vaTujuan: bonusPreviewNumber_(c[13], false),
      via: c[14] === '-' ? '' : c[14], ot: c[15] === '-' ? '' : c[15],
      statusAtas: parts[0] || '', statusBawah: parts.slice(1).join(' '), cab: c[17].toUpperCase(),
      sourceValues: c
    });
  });
  if (!records.length) throw new Error('Tidak ada resi yang terbaca. Format file OPS mungkin berubah.');
  const seen = {};
  records.forEach(function (r) {
    const key = bonusPreviewNormText_(r.noResi);
    if (!key || seen[key]) throw new Error('Nomor resi kosong atau duplikat dalam file: ' + r.noResi);
    seen[key] = true;
  });
  const total = records.reduce(function (s, r) { return s + r.tunai + r.tujuanBayar + r.vaPengirim + r.vaTujuan; }, 0);
  const headerMatch = allText.match(/Total\s+Omset\s+Barang\s*:\s*Rp\.?\s*([\d.,]+)/i);
  if (headerMatch && bonusPreviewNumber_(headerMatch[1], false) !== total) {
    throw new Error('Total omzet header (' + headerMatch[1] + ') tidak sama dengan jumlah empat kolom pembayaran (' + total + ').');
  }
  return {
    branchCode: codeMatch[1].toUpperCase(), reportStart: dateMatch[1], reportEnd: dateMatch[2],
    records: records, totalOmset: total,
    totalKg: records.reduce(function (s, r) { return s + r.kg; }, 0),
    totalM3: records.reduce(function (s, r) { return s + r.m3; }, 0)
  };
}
function bonusPreviewNormText_(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toUpperCase();
}
function bonusPreviewNormDate_(value, display, timezone) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) throw new Error('Tanggal tidak valid.');
    return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  }
  // Nilai numerik Sheets adalah serial kalender, bukan timestamp Unix.
  if (typeof value === 'number') {
    if (!isFinite(value) || value < 1 || value > 2958465) throw new Error('Serial tanggal tidak valid.');
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  // Nilai mentah lebih otoritatif daripada format tampilan (misalnya dd/MM).
  return bonusPreviewDate_(value);
}
function bonusPreviewNormNumber_(value, decimal) {
  if (value == null || (typeof value === 'string' && !value.trim())) throw new Error('Sel kosong belum membuktikan nilai nol.');
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error('Angka tidak valid.');
    return value;
  }
  if (typeof value !== 'string') throw new Error('Tipe nilai bukan angka.');
  return bonusPreviewNumber_(value, decimal);
}
function bonusPreviewDiagnosticValue_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  return value == null ? '' : value;
}
// Semua field memakai posisi Datot A:R. A hanya nomor urut; E kunci resi.
function bonusPreviewFields_() {
  return [
    ['masuk', 'Tanggal resi', 2, 'date'], ['berangkat', 'Tanggal berangkat', 3, 'date'],
    ['pengirim', 'Pengirim', 4, 'text'], ['noResi', 'Nomor resi', 5, 'text'],
    ['penerima', 'Penerima', 6, 'text'], ['tujuan', 'Tujuan', 7, 'text'],
    ['koli', 'Koli', 8, 'number'], ['kg', 'Kg', 9, 'number'], ['m3', 'M3', 10, 'decimal'],
    ['tunai', 'Tunai', 11, 'number'], ['tujuanBayar', 'Bayar tujuan', 12, 'number'],
    ['vaPengirim', 'VA pengirim', 13, 'number'], ['vaTujuan', 'VA tujuan', 14, 'number'],
    ['via', 'Via', 15, 'optional'], ['ot', 'OT', 16, 'optional'], ['cab', 'Kode cabang', 18, 'text']
  ];
}
function bonusPreviewCompare_(r, numberRow, dataRow, displayNumberRow, displayDataRow, timezone, cells, destinationMap) {
  const details = [];
  function compare(key, label, col, kind, expected, cell, sourceColumn) {
    let actual = null, normalizedExpected = null, error = '';
    const normalize = function (value) {
      if (kind === 'date') return bonusPreviewNormDate_(value, '', timezone);
      if (kind === 'number' || kind === 'decimal') return bonusPreviewNormNumber_(value, kind === 'decimal');
      if (kind === 'optional' && String(value == null ? '' : value).trim() === '-') return '';
      const normalized = bonusPreviewNormText_(value);
      if (key === 'tujuan' && Object.prototype.hasOwnProperty.call(destinationMap || {}, normalized)) {
        return bonusPreviewNormText_(destinationMap[normalized]);
      }
      return normalized;
    };
    try {
      if ((kind === 'number' || kind === 'decimal') && r.sourceValues && !String(r.sourceValues[col - 1]).trim()) {
        throw new Error('Angka sumber kosong belum membuktikan nilai nol.');
      }
      normalizedExpected = normalize(expected); actual = normalize(cell.value);
    }
    catch (e) { error = e.message || String(e); }
    const numeric = kind === 'number' || kind === 'decimal';
    // Toleransi hanya untuk noise floating point; bukan pembulatan tampilan.
    const equal = !error && (numeric ? Math.abs(actual - normalizedExpected) <= 1e-9 : actual === normalizedExpected);
    details.push({ field: label, sourceColumn: sourceColumn || String.fromCharCode(64 + col),
      sourceValue: r.sourceValues ? r.sourceValues[col - 1] : bonusPreviewDiagnosticValue_(r[key]),
      expectedValue: bonusPreviewDiagnosticValue_(expected), targetCell: cell.a1, mergedRange: cell.merge || '',
      targetValue: bonusPreviewDiagnosticValue_(cell.value), targetDisplay: cell.display,
      sourceNormalized: normalizedExpected, targetNormalized: actual, equal: equal, error: error });
  }
  bonusPreviewFields_().forEach(function (f) {
    let expected = r[f[0]];
    if (f[0] === 'tujuan') {
      const code = bonusPreviewNormText_(expected);
      if (Object.prototype.hasOwnProperty.call(destinationMap || {}, code)) expected = destinationMap[code];
    }
    const cell = cells ? cells[f[2] - 1] : { value: dataRow[f[2] - 1], display: displayDataRow[f[2] - 1], a1: String.fromCharCode(64 + f[2]) };
    // Nomor resi pada template berada di baris atas.
    if (!cells && f[0] === 'noResi') cell.value = numberRow[4];
    compare(f[0], f[1], f[2], f[3], expected, cell);
  });
  const top = cells ? cells.statusTop : { value: numberRow[16], display: displayNumberRow[16], a1: 'Q atas' };
  const bottom = cells ? cells.statusBottom : { value: dataRow[16], display: displayDataRow[16], a1: 'Q bawah' };
  if (top.merge && top.merge === bottom.merge) {
    compare('statusAtas', 'Status', 17, 'text', [r.statusAtas, r.statusBawah].filter(Boolean).join(' '), top, 'Q (atas + bawah)');
  } else {
    compare('statusAtas', 'Status atas', 17, 'text', r.statusAtas, top, 'Q (atas)');
    compare('statusBawah', 'Status bawah', 17, 'text', r.statusBawah, bottom, 'Q (bawah)');
  }
  return { fields: details.filter(function (d) { return !d.equal; }).map(function (d) { return d.field; }), details: details };
}
// Resolve hanya merge yang benar-benar dilaporkan Sheets, tanpa menebak sel kosong.
function bonusPreviewCellReader_(values, display, merges, firstRow) {
  const byCell = Object.create(null);
  merges.forEach(function (m) {
    const lastRow = Math.min(firstRow + values.length, m.row + m.rows);
    for (let row = Math.max(firstRow, m.row); row < lastRow; row++) {
      for (let col = Math.max(1, m.col); col < Math.min(19, m.col + m.cols); col++) byCell[row + ':' + col] = m;
    }
  });
  return function (row, col) {
    let anchor = row, merge = '';
    const m = byCell[row + ':' + col];
    if (m) {
      const slotTop = firstRow + Math.floor((row - firstRow) / 2) * 2;
      if (m.cols !== 1 || m.row !== slotTop || m.rows !== 2) {
        throw new Error('Merge ' + m.a1 + ' tidak sesuai satu kolom dalam satu pasangan baris resi.');
      }
      anchor = m.row; merge = m.a1;
    }
    return { value: values[anchor - firstRow][col - 1], display: display[anchor - firstRow][col - 1],
      a1: String.fromCharCode(64 + col) + anchor, merge: merge };
  };
}
function bonusPreviewInspectTarget_(sheet, records, timezone, dateISO, destinationMap) {
  const headers = sheet.getRange(2, 1, 2, 18).getDisplayValues();
  const norm = function (s) { return bonusPreviewNormText_(s).replace(/[^A-Z0-9]/g, ''); };
  if (!norm(headers[0][4]).includes('RESI') || !norm(headers[0][6]).includes('TUJUAN') ||
      !norm(headers[0][17]).includes('CAB') || !norm(headers[1][16]).includes('STATUS')) {
    throw new Error('Header tab tujuan tidak sesuai template (E2 NO.RESI, G2 Tujuan, Q3 Status, R2 Cab).');
  }
  const maxSlots = Math.min(BARAKA_BONUS_PREVIEW.MAX_SLOTS, Math.floor((sheet.getMaxRows() - BARAKA_BONUS_PREVIEW.FIRST_NUMBER_ROW + 1) / 2));
  if (maxSlots < 1) throw new Error('Tab tanggal belum memiliki slot data mulai baris 5 dan 6.');
  const height = maxSlots * 2;
  const range = sheet.getRange(BARAKA_BONUS_PREVIEW.FIRST_NUMBER_ROW, 1, height, 18);
  const values = range.getValues();
  const display = range.getDisplayValues();
  const formulas = range.getFormulas();
  const merges = range.getMergedRanges().map(function (m) {
    return { row: m.getRow(), col: m.getColumn(), rows: m.getNumRows(), cols: m.getNumColumns(), a1: m.getA1Notation() };
  });
  const readCell = bonusPreviewCellReader_(values, display, merges, BARAKA_BONUS_PREVIEW.FIRST_NUMBER_ROW);
  const existing = Object.create(null);
  let lastOccupiedSlot = -1;
  const warnings = [];
  for (let i = 0; i < maxSlots; i++) {
    const noRow = values[i * 2], dataRow = values[i * 2 + 1];
    const noDisplay = display[i * 2], dataDisplay = display[i * 2 + 1];
    const resi = bonusPreviewNormText_(noRow[4]);

    if (String(dataRow[4] || '').trim()) {
      throw new Error('Struktur tidak sesuai: nomor resi ditemukan pada baris data ' + (6 + i * 2) + '.');
    }
    if (!resi) continue;
    const cells = [];
    for (let col = 1; col <= 18; col++) cells.push(readCell(col === 5 ? 5 + i * 2 : 6 + i * 2, col));
    cells.statusTop = readCell(5 + i * 2, 17);
    cells.statusBottom = readCell(6 + i * 2, 17);
    let existingDate = '';
    try { existingDate = bonusPreviewNormDate_(cells[1].value, cells[1].display, timezone); }
    catch (e) { /* Nilai tidak valid akan dilaporkan sebagai konflik per kolom. */ }
    if (existingDate && existingDate !== dateISO) {
      throw new Error('Tab tanggal ' + String(Number(dateISO.slice(-2))) + ' berisi resi ' + resi + ' bertanggal ' + existingDate + ', bukan ' + dateISO + '.');
    }
    lastOccupiedSlot = i;
    if (existing[resi]) {
      existing[resi].duplicated = true;
    } else existing[resi] = { rowNumber: 5 + i * 2, dataRowNumber: 6 + i * 2, numberRow: noRow, dataRow: dataRow, displayNumberRow: noDisplay, displayDataRow: dataDisplay, cells: cells, duplicated: false };
  }
  const existingSame = [], conflicts = [], toPlace = [], diagnostics = [];
  records.forEach(function (r) {
    const old = existing[bonusPreviewNormText_(r.noResi)];
    if (!old) { toPlace.push(r); return; }
    if (old.duplicated) {
      conflicts.push({ noResi: r.noResi, row: old.dataRowNumber, fields: ['Nomor resi ganda di sheet'] }); return;
    }
    const comparison = bonusPreviewCompare_(r, old.numberRow, old.dataRow, old.displayNumberRow, old.displayDataRow, timezone, old.cells, destinationMap);
    diagnostics.push({ noResi: r.noResi, numberRow: old.rowNumber, dataRow: old.dataRowNumber, fields: comparison.details });
    if (comparison.fields.length) conflicts.push({ noResi: r.noResi, row: old.dataRowNumber, fields: comparison.fields });
    else existingSame.push({ noResi: r.noResi, row: old.dataRowNumber });
  });
  const newRows = [];
  let next = lastOccupiedSlot + 1;
  toPlace.forEach(function (r) {
    while (next < maxSlots) {
      const noRow = values[next * 2], dataRow = values[next * 2 + 1];
      const noFormulas = formulas[next * 2], dataFormulas = formulas[next * 2 + 1];
      const numberRow = 5 + next * 2, dataRowNumber = numberRow + 1;
      const numberValue = String(noRow[0] == null ? '' : noRow[0]).trim();
      const numberOk = !numberValue || numberValue === String(next + 1);
      for (let col = 1; col <= 18; col++) readCell(dataRowNumber, col); // Validasi batas merge slot.
      const emptyData = noRow.slice(1, 18).concat(dataRow.slice(1, 18)).every(function (v) { return v === '' || v === null; });
      const emptyStatus = noRow[16] === '' || noRow[16] === null;
      const formulasClear = noFormulas.every(function (v) { return !v; }) && dataFormulas.every(function (v) { return !v; });
      if (numberOk && emptyData && emptyStatus && formulasClear) {
        // Jika A5:A6 digabung, itu masih aman; tidak ada penulisan pada tahap ini.
        newRows.push({ noResi: r.noResi, nomor: next + 1, barisNomor: numberRow, barisData: dataRowNumber,
          tanggal: r.masuk, tanggalBerangkat: r.berangkat, pengirim: r.pengirim, penerima: r.penerima,
          tujuan: r.tujuan, koli: r.koli, kg: r.kg, m3: r.m3,
          pembayaran: r.tunai + r.tujuanBayar + r.vaPengirim + r.vaTujuan,
          statusAtas: r.statusAtas, statusBawah: r.statusBawah, cab: r.cab });
        next++;
        break;
      }
      // Jangan lompat ke slot yang tampak rusak / berisi data tanpa resi.
      throw new Error('Slot ' + numberRow + '/' + dataRowNumber + ' tidak kosong/berisi formula atau nomor berbeda. Periksa template sebelum impor.');
    }
    if (next >= maxSlots && newRows.length < toPlace.length) throw new Error('Slot data pada tab tidak mencukupi. Tidak akan menambah baris otomatis.');
  });
  if (records.length && !toPlace.length) warnings.push('Seluruh resi sumber sudah ada pada tab tujuan. Tidak ada baris baru yang direncanakan.');
  if (conflicts.length) warnings.push('Resi yang sudah ada tetapi isinya berbeda tidak akan ditimpa. Periksa kolom yang ditandai.');
  if (newRows.length > BARAKA_BONUS_PREVIEW.MAX_PREVIEW_ROWS) warnings.push('Tampilan pratinjau dibatasi 80 baris; hitungan total tetap lengkap.');
  return { diagnostics: diagnostics, newRows: newRows, existingSame: existingSame, conflicts: conflicts, warnings: warnings, slotsAvailable: maxSlots - lastOccupiedSlot - 1 };
}
