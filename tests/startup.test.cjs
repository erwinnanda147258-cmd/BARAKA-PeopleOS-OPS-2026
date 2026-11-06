const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];

test('all inline browser scripts and Apps Script backends compile independently', () => {
  for (const name of ['Index.html', 'OpsConsole.html', 'BonusPreview.html']) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    let count = 0;
    for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/.test(match[1])) continue;
      const line = source.slice(0, match.index).split('\n').length;
      assert.doesNotThrow(() => new vm.Script(match[2], { filename: `${name}:${line}` }));
      count++;
    }
    assert.ok(count > 0, `${name} must actually contain executable scripts`);
  }
  for (const name of ['Kode.gs', 'OpsBonusStandbyPreview.gs']) {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name }));
  }
});

function runtime() {
  const events = {}, messages = [];
  const elements = Object.fromEntries(['baraka-runtime-errors', 'baraka-runtime-summary', 'baraka-runtime-details'].map(id => [id, {
    hidden: true, textContent: '', children: [],
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); }
  }]));
  const context = vm.createContext({
    console: { error: (...args) => messages.push(args) },
    document: {
      currentScript: null,
      getElementById: id => elements[id],
      createElement: () => ({ textContent: '' }),
      querySelectorAll: () => [],
      addEventListener: (name, callback) => { events[name] = callback; }
    },
    addEventListener: (name, callback) => { events[name] = callback; }
  });
  context.window = context;
  vm.runInContext(scripts.find(s => /data-baraka-module="startup"/.test(s[1]))[2], context);
  return { context, api: context.BarakaRuntime, elements, events, messages };
}

test('modules wait for real core state, initialize in order, and cannot double-register', () => {
  const r = runtime(), order = [];
  r.api.registerModule('first', () => order.push('first'));
  r.api.registerModule('second', () => order.push('second'));
  assert.deepEqual(order, []);
  assert.throws(() => r.api.registerModule('first', () => {}), /Registrasi/);
  r.context.HR = {};
  r.api.setCore(() => order.push('render'), () => ({ db: {}, nav: [], route: 'dashboard' }));
  r.events.DOMContentLoaded();
  assert.deepEqual(order, ['first', 'second', 'render']);
  assert.equal(r.elements['baraka-runtime-errors'].hidden, true);
});

test('missing core blocks all extensions instead of creating dummy db, route, nav or render', () => {
  const r = runtime();
  let ran = false;
  r.api.registerModule('dependent', () => { ran = true; });
  r.events.DOMContentLoaded();
  assert.equal(ran, false);
  assert.equal(r.context.render, undefined);
  assert.equal(r.context.db, undefined);
  assert.equal(r.context.route, undefined);
  assert.equal(r.context.nav, undefined);
  assert.equal(r.elements['baraka-runtime-errors'].hidden, false);
  assert.match(r.elements['baraka-runtime-details'].children[0].textContent, /Script inti tidak selesai/);
});

test('a failed render extension is reported without blocking core or later extensions', () => {
  const r = runtime(), order = [];
  r.api.setCore(() => order.push('core'), () => ({}));
  r.api.addRenderHook('address', () => order.push('before'), true);
  r.api.addRenderHook('broken-kanban', () => { throw new Error('real extension failure'); });
  r.api.addRenderHook('gmail', () => order.push('gmail'));
  assert.doesNotThrow(() => r.context.render());
  assert.deepEqual(order, ['before', 'core', 'gmail']);
  assert.equal(r.elements['baraka-runtime-errors'].hidden, false);
  assert.match(r.elements['baraka-runtime-details'].children[0].textContent, /broken-kanban: real extension failure/);
  r.context.render();
  assert.equal(r.elements['baraka-runtime-details'].children.length, 1, 'identical failures are not duplicated');
});

test('core render exceptions retain their original error and are shown to the operator', () => {
  const r = runtime(), error = new Error('core failed');
  r.api.setCore(() => { throw error; }, () => ({}));
  assert.throws(() => r.context.render(), candidate => candidate === error);
  assert.match(r.elements['baraka-runtime-summary'].textContent, /Inisialisasi inti gagal/);
});

test('failed module initialization remains visible while unrelated modules can start', () => {
  const r = runtime(), order = [];
  r.context.HR = {};
  r.api.setCore(() => order.push('render'), () => ({ db: {}, nav: [], route: 'dashboard' }));
  r.api.registerModule('broken', () => { throw new Error('module failed'); });
  r.api.registerModule('working', () => order.push('working'));
  r.events.DOMContentLoaded();
  assert.deepEqual(order, ['working', 'render']);
  assert.match(r.elements['baraka-runtime-details'].children[0].textContent, /broken\/startup: module failed/);
});

test('doGet preserves all HTML routes and authentication with empty OPS configuration', () => {
  const htmlService = {
    createHtmlOutputFromFile(name) { return { name, setTitle(title) { this.title = title; return this; } }; },
    createHtmlOutput(content) { return { content, setTitle(title) { this.title = title; return this; } }; }
  };
  let allowed = '';
  const context = vm.createContext({
    HtmlService: htmlService,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'BARAKA_ALLOWED_EMAILS' ? allowed : null }) },
    Session: { getActiveUser: () => ({ getEmail: () => 'operator@example.test' }) }
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'Kode.gs'), 'utf8'), context);
  assert.equal(context.doGet().name, 'Index');
  assert.equal(context.doGet({ parameter: { ops: '1' } }).name, 'OpsConsole');
  assert.equal(context.doGet({ parameter: { bonus: '1' } }).name, 'BonusPreview');
  assert.match(context.doGet({ parameter: { diagnostik: '1' } }).content, /BARAKA/);
  const bootstrap = context.getOpsBootstrap();
  assert.equal(bootstrap.configVersion, 0);
  assert.equal(bootstrap.branches.length, 0);
  assert.equal(context.doGet().name, 'Index', 'unconfigured OPS does not block the PeopleOS page');
  allowed = 'different@example.test';
  assert.throws(() => context.doGet(), /tidak termasuk/);
});
