const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const context = vm.createContext({ Date, Utilities: { formatDate(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
} } });
vm.runInContext(fs.readFileSync(path.join(root, 'OpsBonusStandbyPreview.gs'), 'utf8'), context);
const c = context;
const record = () => ({ no: 1, masuk: '2026-11-02', berangkat: '', pengirim: 'PT Sumber', noResi: '014PTK-001/A', penerima: 'Penerima', tujuan: '010SBY', koli: 2, kg: 25, m3: 0.053, tunai: 1234000, tujuanBayar: 0, vaPengirim: 0, vaTujuan: 0, via: '', ot: '', statusAtas: 'LUNAS', statusBawah: 'DITERIMA', cab: '014PTK' });
const cells = r => [r.no, r.masuk, r.berangkat, r.pengirim, r.noResi, r.penerima, r.tujuan, r.koli, r.kg, r.m3, r.tunai, r.tujuanBayar, r.vaPengirim, r.vaTujuan, r.via, r.ot, `${r.statusAtas}<br>${r.statusBawah}`, r.cab];
function datot(records) {
  return '<h2>DATA TOTAL PENERIMAAN 014PTK</h2><p>Dari 2026-11-02 Sampai 2026-11-02</p><table>' + records.map(r => '<tr>' + cells(r).map(v => `<td>${v}</td>`).join('') + '</tr>').join('') + '</table>';
}
function sheet(records, merged = true, statusMerged = false) {
  const values = [], merges = [];
  for (const [i, r] of records.entries()) {
    const top = Array(18).fill(''), bottom = Array(18).fill('');
    top[0] = i + 1; top[4] = r.noResi;
    const row = 5 + i * 2;
    for (const [key, , col] of c.bonusPreviewFields_()) {
      if (col === 5) continue;
      (merged ? top : bottom)[col - 1] = r[key];
      if (merged) merges.push([row, col, 2, 1]);
    }
    top[16] = statusMerged ? r.statusAtas + '\n' + r.statusBawah : r.statusAtas;
    bottom[16] = statusMerged ? '' : r.statusBawah;
    if (statusMerged) merges.push([row, 17, 2, 1]);
    if (merged) merges.push([row, 5, 2, 1]);
    values.push(top, bottom);
  }
  values.push(Array(18).fill(''), Array(18).fill(''));
  const formulas = values.map(() => Array(18).fill(''));
  const headers = [Array(18).fill(''), Array(18).fill('')];
  headers[0][4] = 'NO. RESI'; headers[0][6] = 'Tujuan'; headers[0][17] = 'Cab'; headers[1][16] = 'Status';
  let display = values.map(row => row.map(v => String(v)));
  const api = { values, merges, formulas, setDisplay(fn) { display = values.map((row, i) => row.map((v, j) => fn(v, i, j))); },
    getMaxRows: () => values.length + 4,
    getRange(row, col, height, width) {
      if (row === 2) return { getDisplayValues: () => headers };
      assert.equal(col, 1); assert.equal(width, 18); assert.equal(height, values.length);
      return { getValues: () => values, getDisplayValues: () => display, getFormulas: () => formulas,
        getMergedRanges: () => merges.map(([r, column, rows, cols]) => ({ getRow: () => r, getColumn: () => column, getNumRows: () => rows, getNumColumns: () => cols, getA1Notation: () => `${String.fromCharCode(64 + column)}${r}:${String.fromCharCode(63 + column + cols)}${r + rows - 1}` })) };
    }
  };
  // Tidak menyediakan API mutasi: upaya menulis akan menggagalkan pengujian.
  return api;
}
const inspect = (target, records, mapping = {}) => c.bonusPreviewInspectTarget_(target, records, 'Asia/Jakarta', '2026-11-02', mapping);
test('four Datot receipts match actual vertical merge anchors, with per-column proof', () => {
  const records = Array.from({ length: 4 }, (_, i) => ({ ...record(), no: i + 1, noResi: `014PTK-00${i + 1}/A` }));
  const parsed = c.bonusPreviewParseDatot_(datot(records), 'datot.xls');
  const target = sheet(records);
  const before = JSON.stringify(target.values);
  const plan = inspect(target, parsed.records);
  assert.equal(plan.existingSame.length, 4); assert.equal(plan.conflicts.length, 0); assert.equal(plan.newRows.length, 0);
  assert.equal(plan.diagnostics.length, 4);
  const date = plan.diagnostics[0].fields.find(f => f.field === 'Tanggal resi');
  assert.equal(date.targetCell, 'B5'); assert.equal(date.mergedRange, 'B5:B6'); assert.equal(date.sourceValue, '2026-11-02');
  assert.ok(plan.diagnostics.every(d => d.fields.every(f => f.equal)));
  assert.equal(JSON.stringify(target.values), before);
});
test('unmerged legacy lower-row data remains supported', () => {
  const r = record(); assert.equal(inspect(sheet([r], false), [r]).existingSame.length, 1);
});
test('mixed merged and unmerged columns resolve independently', () => {
  const r = record(), s = sheet([r]); s.merges.splice(s.merges.findIndex(m => m[1] === 8), 1);
  s.values[1][7] = s.values[0][7]; s.values[0][7] = '';
  assert.equal(inspect(s, [r]).existingSame.length, 1);
});
test('merged status compares complete ordered status, not anchor against blank lower cell', () => {
  const r = record(), s = sheet([r], true, true);
  assert.equal(inspect(s, [r]).existingSame.length, 1);
  s.values[0][16] = 'DITERIMA LUNAS'; assert.equal(inspect(s, [r]).conflicts.length, 1);
});
for (const [key, value] of [['tunai', 1234001], ['m3', 0.054], ['pengirim', 'PT Lain'], ['tujuan', 'SURABAYA TIMUR'], ['statusBawah', 'BELUM DITERIMA'], ['berangkat', '2026-11-03'], ['cab', '015PTK']]) {
  test(`real ${key} difference remains a conflict`, () => {
    const r = record(); const plan = inspect(sheet([{ ...r, [key]: value }]), [r]);
    assert.equal(plan.existingSame.length, 0); assert.equal(plan.conflicts.length, 1);
    assert.ok(plan.diagnostics[0].fields.some(f => !f.equal));
  });
}
test('zero raw values are trusted even when display hides zero; blank is not evidence of zero', () => {
  const r = record(), s = sheet([r]); s.setDisplay(v => v === 0 ? '' : String(v));
  assert.equal(inspect(s, [r]).existingSame.length, 1);
  s.values[0][11] = ''; const plan = inspect(s, [r]);
  assert.equal(plan.conflicts.length, 1);
  assert.match(plan.diagnostics[0].fields.find(f => f.field === 'Bayar tujuan').error, /belum membuktikan/);
});
test('currency, decimal M3, optional dash and Unicode whitespace normalize without discarding differences', () => {
  const r = record(), s = sheet([r]);
  s.values[0][10] = 'Rp 1.234.000,00'; s.values[0][9] = '0,053'; s.values[0][14] = '-'; s.values[0][3] = '  pt\u00a0sumber  ';
  assert.equal(inspect(s, [r]).existingSame.length, 1);
  s.values[0][14] = 0; assert.equal(inspect(s, [r]).conflicts.length, 1);
});
test('raw Date uses spreadsheet timezone rather than date display with no year', () => {
  const r = record(), s = sheet([r]); s.values[0][1] = new Date('2026-11-01T17:00:00Z'); s.setDisplay(() => '02/11');
  assert.equal(inspect(s, [r]).existingSame.length, 1);
});
test('numeric Sheets date serial and dd/MM/yyyy text agree with ISO', () => {
  const serial = (Date.UTC(2026, 10, 2) - Date.UTC(1899, 11, 30)) / 86400000;
  assert.equal(c.bonusPreviewNormDate_(serial, '', 'Asia/Jakarta'), '2026-11-02');
  assert.equal(c.bonusPreviewNormDate_('02/11/2026', '', 'Asia/Jakarta'), '2026-11-02');
  assert.throws(() => c.bonusPreviewNormDate_('30/02/2026', '', 'Asia/Jakarta'));
});
test('invalid nonempty departure date cannot silently equal an empty date', () => {
  const r = record(), s = sheet([r]); s.values[0][2] = 'not a date';
  assert.equal(inspect(s, [r]).conflicts.length, 1);
  assert.throws(() => c.bonusPreviewParseDatot_(datot([{ ...r, berangkat: 'not a date' }]), 'datot.xls'), /tanggal/);
});
test('only explicit destination mapping can equate code and name', () => {
  const r = record(), s = sheet([{ ...r, tujuan: 'SURABAYA BARAT' }]);
  assert.equal(inspect(s, [r]).conflicts.length, 1);
  const plan = inspect(s, [r], { '010SBY': 'SURABAYA BARAT' });
  assert.equal(plan.existingSame.length, 1);
  assert.equal(plan.diagnostics[0].fields.find(f => f.field === 'Tujuan').expectedValue, 'SURABAYA BARAT');
  assert.equal(inspect(sheet([r]), [r], { '010SBY': 'SURABAYA BARAT' }).existingSame.length, 1);
});
test('duplicate target receipts remain conflicts', () => {
  const r = record(); assert.equal(inspect(sheet([r, r]), [r]).conflicts[0].fields[0], 'Nomor resi ganda di sheet');
});
test('horizontal and cross-receipt merges fail safely', () => {
  const r = record();
  for (const merge of [[5, 2, 2, 2], [5, 2, 4, 1]]) {
    const s = sheet([r]); s.merges.splice(s.merges.findIndex(m => m[1] === 2), 1, merge);
    assert.throws(() => inspect(s, [r]), /Merge/);
  }
});
test('new receipt only plans an empty slot; orphan upper-row data and formulas block it', () => {
  const r = record(), incoming = { ...r, noResi: '014PTK-002/A' };
  const s = sheet([r]); assert.equal(inspect(s, [r, incoming]).newRows[0].barisNomor, 7);
  s.values[2][3] = 'existing orphan data'; assert.throws(() => inspect(s, [r, incoming]), /tidak kosong/);
  s.values[2][3] = ''; s.formulas[2][10] = '=1'; assert.throws(() => inspect(s, [r, incoming]), /tidak kosong/);
});
test('source duplicate receipts and unsupported spans are rejected', () => {
  const r = record(); assert.throws(() => c.bonusPreviewParseDatot_(datot([r, r]), 'datot.xls'), /duplikat/);
  assert.throws(() => c.bonusPreviewParseDatot_(datot([r]).replace('<td>1</td>', '<td rowspan="2">1</td>'), 'datot.xls'), /rowspan/);
});
test('nonfinite numbers and malformed numeric groups never compare as equal', () => {
  const r = record(), s = sheet([r]); s.values[0][9] = NaN; assert.equal(inspect(s, [r]).conflicts.length, 1);
  assert.throws(() => c.bonusPreviewNumber_('1..234,00', false));
});

test('blank source numeric data is not proof of zero, even if parser historically totals it as zero', () => {
  const r = record(); const parsed = c.bonusPreviewParseDatot_(datot([{ ...r, tujuanBayar: '' }]), 'datot.xls');
  const plan = inspect(sheet([r]), parsed.records);
  assert.equal(plan.conflicts.length, 1);
  assert.match(plan.diagnostics[0].fields.find(f => f.field === 'Bayar tujuan').error, /sumber kosong/);
});
test('whitespace-only target numeric cell does not equal zero', () => {
  const r = record(), s = sheet([r]); s.values[0][11] = '  ';
  assert.equal(inspect(s, [r]).conflicts.length, 1);
});
test('changed source column order is rejected when header is present', () => {
  const headers = Array(18).fill(''); headers[3] = 'NO RESI'; headers[6] = 'Tujuan'; headers[17] = 'Cab';
  const html = datot([record()]).replace('<table>', '<table><tr>' + headers.map(v => '<th>' + v + '</th>').join('') + '</tr>');
  assert.throws(() => c.bonusPreviewParseDatot_(html, 'datot.xls'), /Urutan kolom/);
});

test('endpoint is read-only and returns serializable diagnostics through real Kode.gs bootstrap/config', () => {
  const r = record(), target = sheet([{ ...r, tujuan: 'SURABAYA BARAT' }]);
  const file = { getName: () => 'datot.xls', getId: () => 'synthetic-file-id', getSize: () => 1000, getBlob: () => ({ getDataAsString: () => datot([r]) }) };
  const runtime = vm.createContext({ Date, Utilities: c.Utilities,
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    DriveApp: { getFolderById: () => ({}), getFileById: () => file },
    SpreadsheetApp: { openById: () => ({ getSheetByName: name => name === '2' ? target : null, getSpreadsheetTimeZone: () => 'Asia/Jakarta', getName: () => 'Synthetic bonus workbook' }) }
  });
  for (const name of ['Kode.gs', 'OpsBonusStandbyPreview.gs']) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), runtime);
  const report = runtime.previewBonusStandbyPontianakBarat({ dateISO: '2026-11-02', branchFolderUrl: 'synthetic-folder-id', bonusSpreadsheetUrl: 'synthetic-spreadsheet-id', fileUrl: 'synthetic-file-id' });
  assert.equal(report.mode, 'READ_ONLY'); assert.equal(report.writeEnabled, false);
  assert.equal(report.summary.existingSame, 1); assert.equal(report.summary.existingDifferent, 0);
  const transport = JSON.parse(JSON.stringify(report));
  assert.equal(transport.diagnostics[0].fields.find(f => f.field === 'Tujuan').expectedValue, 'SURABAYA BARAT');
});
test('receipt rows with missing columns or moved receipt key fail safely', () => {
  const html = datot([record()]);
  assert.throws(() => c.bonusPreviewParseDatot_(html.replace('<td>1</td>', ''), 'datot.xls'), /18 kolom/);
  assert.throws(() => c.bonusPreviewParseDatot_(html.replace('<td>014PTK-001/A</td><td>Penerima</td>', '<td>Penerima</td><td>014PTK-001/A</td>'), 'datot.xls'), /kolom E/);
});
test('preview UI renders diagnostic evidence as text, including untrusted source values', () => {
  class Element {
    constructor() { this.children = []; this.value = ''; this.textContent = ''; this.hidden = true; this.classList = { add: () => { this.hidden = true; }, remove: () => { this.hidden = false; } }; }
    get firstChild() { return this.children[0]; }
    appendChild(child) { this.children.push(child); }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); }
    addEventListener(type, fn) { this[type] = fn; }
    set innerHTML(value) { throw new Error('Untrusted HTML insertion'); }
  }
  const ids = Object.fromEntries(['dateISO', 'fileUrl', 'branchFolderUrl', 'bonusSpreadsheetUrl', 'previewBtn', 'message', 'result', 'plan', 'conflicts', 'diagnostics', 'total', 'baru', 'sama', 'beda', 'source', 'summary', 'warnings', 'planRows', 'conflictRows', 'diagnosticRows'].map(id => [id, new Element()]));
  ids.dateISO.value = '2026-11-02';
  const attack = '<img src=x onerror=alert(1)>';
  const report = { source: { recordCount: 1 }, target: { tabName: '2' }, summary: { newRecords: 0, existingSame: 0, existingDifferent: 1 }, warnings: [], plannedRows: [], conflicts: [{ noResi: '014PTK-001/A', row: 6, fields: ['Pengirim'] }], diagnostics: [{ noResi: '014PTK-001/A', numberRow: 5, dataRow: 6, fields: [{ field: 'Pengirim', sourceColumn: 'D', sourceValue: attack, expectedValue: attack, targetCell: 'D5', mergedRange: 'D5:D6', targetValue: 'Other', targetDisplay: 'Other', sourceNormalized: attack, targetNormalized: 'OTHER', equal: false }] }] };
  const runner = { withSuccessHandler(fn) { this.success = fn; return this; }, withFailureHandler() { return this; }, getOpsBootstrap() { this.success({ branches: [] }); }, previewBonusStandbyPontianakBarat() { this.success(report); } };
  const google = { script: { run: runner } };
  const browser = vm.createContext({ document: { getElementById: id => ids[id], createElement: () => new Element() }, window: { google }, google, Intl });
  const script = fs.readFileSync(path.join(root, 'BonusPreview.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, browser); ids.previewBtn.click();
  assert.equal(ids.diagnostics.hidden, false); assert.equal(ids.previewBtn.disabled, false);
  const allText = node => node.textContent + node.children.map(allText).join(' ');
  assert.ok(allText(ids.diagnosticRows).includes(attack));
  assert.ok(allText(ids.diagnosticRows).includes('D5 [D5:D6]'));
});
