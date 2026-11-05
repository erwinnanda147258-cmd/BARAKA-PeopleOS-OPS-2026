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
  s.values[0][16] = 'DITERIMA LUNAS'; const plan = inspect(s, [r]);
  assert.equal(plan.conflicts.length, 0); assert.equal(plan.qrUpdates[0].changes[0].after, 'LUNAS\nDITERIMA');
});
for (const [key, value] of [['masuk', '2026-11-01'], ['tunai', 1234001], ['m3', 0.054], ['pengirim', 'PT Lain'], ['tujuan', 'SURABAYA TIMUR']]) {
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
  const plan = inspect(s, [r]);
  assert.equal(plan.conflicts.length, 0); assert.equal(plan.information.length, 1);
  assert.match(plan.information[0].note, /tanggal/);
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
  s.values[2][3] = 'existing orphan data'; let plan = inspect(s, [r, incoming]);
  assert.equal(plan.newRows.length, 0); assert.equal(plan.slotIssues.length, 1); assert.equal(plan.conflicts.length, 1);
  s.values[2][3] = ''; s.formulas[2][10] = '=1'; plan = inspect(s, [r, incoming]);
  assert.equal(plan.newRows.length, 0); assert.equal(plan.slotIssues.length, 1);
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
  const ids = Object.fromEntries(['dateISO', 'fileUrl', 'branchFolderUrl', 'bonusSpreadsheetUrl', 'previewBtn', 'message', 'result', 'plan', 'conflicts', 'diagnostics', 'total', 'baru', 'sama', 'beda', 'source', 'summary', 'warnings', 'planRows', 'conflictRows', 'diagnosticRows','skipped','qr','information','slotIssues','skippedRows','qrRows','informationRows','slotIssueRows'].map(id => [id, new Element()]));
  ids.dateISO.value = '2026-11-02';
  const attack = '<img src=x onerror=alert(1)>';
  const report = { source: { recordCount: 1 }, target: { tabName: '2' }, summary: { newRecords: 0, existingSame: 0, existingDifferent: 1 }, warnings: [], plannedRows: [], conflicts: [{ noResi: '014PTK-001/A', row: 6, fields: ['Pengirim'] }], diagnostics: [{ noResi: '014PTK-001/A', numberRow: 5, dataRow: 6, fields: [{ field: 'Pengirim', sourceColumn: 'D', sourceValue: attack, expectedValue: attack, targetCell: 'D5', mergedRange: 'D5:D6', targetValue: 'Other', targetDisplay: 'Other', sourceNormalized: attack, targetNormalized: 'OTHER', equal: false }] }] };
  report.summary.skippedRecords = 1; report.summary.qrUpdateRecords = 1;
  report.skipped = [{ noResi: '014PTK-001/A', row: 6, reason: 'Seluruh B:P dipertahankan' }];
  report.qrUpdates = [{ noResi: '014PTK-001/A', kind: 'existing', changes: [{ cell: 'Q6', before: 'LAMA', after: attack, field: 'Status bawah', mergedRange: '' }] }];
  report.information = [{ noResi: '014PTK-001/A', targetCell: 'C5', sourceValue: '2026-11-03', targetValue: '', note: 'Tanggal dipertahankan' }];
  report.slotIssues = [{ row: 9, fields: ['Rumus B:P dilindungi'] }];
  const runner = { withSuccessHandler(fn) { this.success = fn; return this; }, withFailureHandler() { return this; }, getOpsBootstrap() { this.success({ branches: [] }); }, previewBonusStandbyPontianakBarat() { this.success(report); } };
  const google = { script: { run: runner } };
  const browser = vm.createContext({ document: { getElementById: id => ids[id], createElement: () => new Element() }, window: { google }, google, Intl });
  const script = fs.readFileSync(path.join(root, 'BonusPreview.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInContext(script, browser); ids.previewBtn.click();
  assert.equal(ids.diagnostics.hidden, false); assert.equal(ids.previewBtn.disabled, false);
  const allText = node => node.textContent + node.children.map(allText).join(' ');
  assert.ok(allText(ids.diagnosticRows).includes(attack));
  assert.ok(allText(ids.diagnosticRows).includes('D5 [D5:D6]'));
  for (const id of ['skipped', 'qr', 'information', 'slotIssues']) assert.equal(ids[id].hidden, false);
  assert.ok(allText(ids.qrRows).includes(attack));
  assert.ok(allText(ids.informationRows).includes('Tanggal dipertahankan'));
  assert.equal(ids.sama.textContent, '1');
});

function resetMain(target, slot = 0) {
  for (const row of [slot * 2, slot * 2 + 1]) for (let col = 1; col < 16; col++) target.values[row][col] = '';
  target.setDisplay(v => String(v));
}
const snapshot = target => JSON.stringify({ values: target.values, formulas: target.formulas, merges: target.merges });
test('central reset: four blank B:P pairs with stale Q:R are new slots; nothing is mutated', () => {
  const records = Array.from({ length: 4 }, (_, i) => ({ ...record(), noResi: `014PTK-NEW${i}/A` }));
  const target = sheet(records.map(r => ({ ...r, statusAtas: 'STATUS LAMA', statusBawah: 'LAMA', cab: 'CAB-LAMA' })));
  for (let i = 0; i < 4; i++) resetMain(target, i);
  target.values[0][0] = 99; target.formulas[0][0] = '=ROW()';
  const before = snapshot(target), plan = inspect(target, records);
  assert.equal(plan.newRows.length, 4); assert.equal(plan.skipped.length, 0); assert.equal(plan.conflicts.length, 0);
  assert.equal(plan.qrUpdates.length, 4);
  assert.deepEqual(Array.from(plan.newRows, r => r.barisNomor), [5, 7, 9, 11]);
  for (const r of plan.newRows) {
    assert.equal(r.mainChanges.length, 15);
    assert.ok(r.mainChanges.every(x => /^[B-P]\d+$/.test(x.cell) && x.before === ''));
  }
  assert.equal(plan.newRows[0].mainChanges.find(x => x.cell === 'E5').after, records[0].noResi);
  assert.ok(plan.qrUpdates.every(r => r.changes.every(x => /^[QR]\d+$/.test(x.cell))));
  assert.equal(plan.qrUpdates[0].changes.find(x => x.cell === 'R5').before, 'CAB-LAMA');
  assert.equal(plan.newRows[0].nomor, 99); assert.equal(snapshot(target), before);
});
test('partially reset hole before live receipt is reused without duplicating live receipt', () => {
  const incoming = record(), old = { ...record(), noResi: '014PTK-OLD/A' };
  const target = sheet([incoming, old]); resetMain(target);
  const plan = inspect(target, [old, incoming]);
  assert.equal(plan.skipped.length, 1); assert.equal(plan.newRows.length, 1);
  assert.equal(plan.newRows[0].barisNomor, 5); assert.equal(plan.skipped[0].row, 8);
});
test('existing receipt with updated status/cabang plans only Q:R on correct unmerged rows', () => {
  const r = record(), target = sheet([{ ...r, statusAtas: 'LAMA', statusBawah: 'PENDING', cab: 'CAB-LAMA' }], false);
  const before = snapshot(target), plan = inspect(target, [r]);
  assert.equal(plan.conflicts.length, 0); assert.equal(plan.skipped.length, 1); assert.equal(plan.newRows.length, 0);
  assert.deepEqual(Array.from(plan.qrUpdates[0].changes, x => x.cell), ['Q5', 'Q6', 'R6']);
  assert.deepEqual(Array.from(plan.qrUpdates[0].changes, x => x.after), ['LUNAS', 'DITERIMA', '014PTK']);
  assert.equal(plan.qrUpdates[0].kind, 'existing'); assert.equal(snapshot(target), before);
});
test('merged Q and R produce one update per anchor, preserving both source status parts', () => {
  const r = record(), target = sheet([{ ...r, statusAtas: 'LAMA', cab: 'CAB-LAMA' }], true, true);
  const plan = inspect(target, [r]);
  assert.deepEqual(Array.from(plan.qrUpdates[0].changes, x => x.cell), ['Q5', 'R5']);
  assert.equal(plan.qrUpdates[0].changes[0].after, 'LUNAS\nDITERIMA');
  assert.equal(plan.qrUpdates[0].changes[0].mergedRange, 'Q5:Q6');
});
test('old departure differences are information; no B:P replacement or filling blank cells', () => {
  const r = { ...record(), berangkat: '2026-11-03' }, target = sheet([{ ...r, berangkat: '', via: '' }]);
  const before = snapshot(target), plan = inspect(target, [{ ...r, via: 'TERBARU' }]);
  assert.equal(plan.newRows.length, 0); assert.equal(plan.information.length, 1);
  assert.equal(plan.information[0].targetCell, 'C5'); assert.equal(plan.information[0].targetValue, '');
  assert.ok(plan.conflicts[0].fields.includes('Via')); assert.ok(!plan.conflicts[0].fields.includes('Tanggal berangkat'));
  assert.equal(plan.skipped.length, 1); assert.equal(snapshot(target), before);
});
test('important B:P conflicts preserve data while explicitly planning permitted Q:R only', () => {
  const r = record(), target = sheet([{ ...r, tunai: 1, statusBawah: 'LAMA' }]);
  const before = snapshot(target), plan = inspect(target, [r]);
  assert.ok(plan.conflicts[0].fields.includes('Tunai')); assert.equal(plan.skipped.length, 1);
  assert.equal(plan.newRows.length, 0); assert.equal(plan.qrUpdates[0].changes.length, 1);
  assert.equal(plan.qrUpdates[0].changes[0].cell, 'Q6'); assert.equal(snapshot(target), before);
});
test('zero and whitespace in B:P prevent reuse after apparent reset', () => {
  for (const v of [0, ' ']) {
    const r = record(), target = sheet([]); target.values[0][8] = v;
    const plan = inspect(target, [r]);
    assert.equal(plan.newRows.length, 0); assert.equal(plan.slotIssues.length, 1); assert.equal(plan.conflicts.length, 1);
  }
});
test('B:P formulas returning empty strings protect the slot, even with stale Q:R', () => {
  const r = record(), target = sheet([]); target.formulas[0][3] = '=""'; target.values[0][16] = 'LAMA';
  const before = snapshot(target), plan = inspect(target, [r]);
  assert.equal(plan.newRows.length, 0); assert.equal(plan.slotIssues.length, 1); assert.equal(plan.qrUpdates.length, 0);
  assert.equal(snapshot(target), before);
});
test('Q:R formulas block all updates for that receipt without overwriting B:P', () => {
  const r = record(), target = sheet([{ ...r, statusBawah: 'LAMA' }]); target.formulas[1][16] = '=STATUS()';
  const before = snapshot(target), plan = inspect(target, [r]);
  assert.equal(plan.qrUpdates.length, 0); assert.equal(plan.newRows.length, 0);
  assert.match(plan.conflicts[0].fields.join(' '), /Rumus/); assert.equal(snapshot(target), before);
});
test('reset slot with Q:R formula stays protected; no partial main plan is exposed', () => {
  const r = record(), target = sheet([r]); resetMain(target); target.formulas[0][17] = '=""';
  const plan = inspect(target, [r]);
  assert.equal(plan.newRows.length, 0); assert.equal(plan.qrUpdates.length, 0);
  assert.match(plan.conflicts[0].fields.join(' '), /Rumus/);
});
test('duplicate or formula-based receipt identity cannot cause a duplicate insert or Q:R plan', () => {
  const r = record();
  for (const target of [sheet([r, r]), sheet([r])]) {
    if (target.values.length === 4) target.formulas[0][4] = '="014PTK-001/A"';
    const plan = inspect(target, [r]);
    assert.equal(plan.newRows.length, 0); assert.equal(plan.qrUpdates.length, 0); assert.equal(plan.skipped.length, 1);
    assert.equal(plan.conflicts.length, 1);
  }
});
test('new unmerged receipt targets E upper, B:P lower, Q upper/lower and R lower', () => {
  const r = record(), target = sheet([]), plan = inspect(target, [r]);
  const main = plan.newRows[0].mainChanges;
  assert.equal(main.find(x => x.cell === 'E5').after, r.noResi);
  assert.equal(main.find(x => x.cell === 'B6').after, r.masuk);
  assert.equal(main.some(x => x.cell === 'A5' || x.cell[0] === 'Q' || x.cell[0] === 'R'), false);
  assert.deepEqual(Array.from(plan.qrUpdates[0].changes, x => x.cell), ['Q5', 'Q6', 'R6']);
});
test('unchanged receipt does not plan redundant Q:R writes', () => {
  const r = record(), plan = inspect(sheet([r]), [r]);
  assert.equal(plan.skipped.length, 1); assert.equal(plan.existingSame.length, 1); assert.equal(plan.qrUpdates.length, 0);
});
test('running preview twice after reset yields the same plan and preserves all captured state', () => {
  const r = record(), target = sheet([r]); resetMain(target); const before = snapshot(target);
  const first = inspect(target, [r]), second = inspect(target, [r]);
  assert.equal(JSON.stringify(first), JSON.stringify(second)); assert.equal(snapshot(target), before);
});

test('sheets exceeding scan limit fail safely rather than treating unseen receipts as new', () => {
  const target = sheet([]); target.getMaxRows = () => 4004;
  assert.throws(() => inspect(target, [record()]), /di luar cakupan/);
});
test('new-record plan displays the actual mapped destination', () => {
  const plan = inspect(sheet([]), [record()], { '010SBY': 'SURABAYA BARAT' });
  assert.equal(plan.newRows[0].tujuan, 'SURABAYA BARAT');
  assert.equal(plan.newRows[0].mainChanges.find(x => x.cell === 'G6').after, 'SURABAYA BARAT');
});
