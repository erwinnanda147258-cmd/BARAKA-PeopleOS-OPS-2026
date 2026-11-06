// Optional browser suite: requires Playwright and Chromium, no npm install in the checkout.
// Run: node --test tests/startup.browser.cjs
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
let browser, server, origin;

before(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname.endsWith('Baraka_OneDrive_Sync_Vault.js')) {
      response.writeHead(404); response.end(); return; // Exercise the real optional-file fallback.
    }
    const name = url.searchParams.has('ops') ? 'OpsConsole.html' : url.searchParams.has('bonus') ? 'BonusPreview.html' : 'Index.html';
    let html = fs.readFileSync(path.join(root, name), 'utf8');
    if (url.searchParams.get('fault') === 'core') {
      html = html.replace(/(<script data-baraka-module="core-application">)[\s\S]*?(<\/script>)/, '$1\nfunction broken( {\n$2');
    }
    if (url.searchParams.get('fault') === 'extension') {
      html = html.replace(/(<script data-baraka-extension="recruitment-tools-8.0">)[\s\S]*?(<\/script>)/, '$1\nfunction broken( {\n$2');
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function pageFor(t, suffix = '') {
  const context = await browser.newContext();
  t.after(() => context.close());
  // Do not contact Google, send mail, or access company resources during the suite.
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto(origin + '/' + suffix);
  await page.waitForLoadState('load');
  return { page, errors };
}

test('fresh PeopleOS opens every route without runtime errors, including absent Vault', async t => {
  const { page, errors } = await pageFor(t);
  const routes = ['dashboard', 'employees', 'recruitment', 'tasks', 'attendance', 'leaves', 'payroll', 'claims', 'cases', 'assets', 'reviews', 'calendar', 'messages', 'documents', 'reports', 'settings', 'activity', 'help', 'ops-integration'];
  for (const route of routes) {
    await page.evaluate(value => navigate(value), route);
    await page.waitForTimeout(100); // Include signature and other deferred render hooks.
    assert.ok(await page.locator('#content').innerText(), `${route} must render content`);
    assert.equal(await page.locator('#baraka-runtime-errors').isVisible(), false, route);
  }
  assert.deepEqual(errors.map(e => e.message), []);
  assert.equal(await page.evaluate(() => window.__barakaLocalVaultMissing), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => navigate('dashboard'));
  assert.ok(await page.locator('#content h1').innerText());
});

test('an actual core SyntaxError gives diagnostics without cascading db/route/nav/render errors', async t => {
  const { page, errors } = await pageFor(t, '?fault=core');
  assert.equal(await page.locator('#baraka-runtime-errors').isVisible(), true);
  assert.match(await page.locator('#baraka-runtime-summary').innerText(), /Inisialisasi inti gagal/);
  assert.match(await page.locator('#baraka-runtime-details').innerText(), /Script inti tidak selesai/);
  assert.ok(errors.some(e => e.name === 'SyntaxError'));
  assert.ok(!errors.some(e => /db is not defined|route is not defined|nav is not defined|prevRender.*not a function/.test(e.message)));
  assert.equal(await page.evaluate(() => typeof window.render), 'undefined');
});

test('PeopleOS initializes inside a sandboxed iframe with scripts and same-origin storage', async t => {
  const { page, errors } = await pageFor(t);
  await page.setContent('<iframe id="gas-frame" style="width:1200px;height:850px" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"></iframe>');
  await page.locator('#gas-frame').evaluate((frame, src) => { frame.src = src; }, origin + '/');
  const frame = page.frameLocator('#gas-frame');
  await frame.locator('[data-route="ops-integration"]').waitFor();
  assert.ok(await frame.locator('#content h1').innerText());
  await frame.locator('[data-route="recruitment"]').first().click();
  assert.match(await frame.locator('#content h1').innerText(), /Rekrutmen/);
  assert.equal(await frame.locator('#baraka-runtime-errors').isVisible(), false);
  assert.deepEqual(errors.map(e => e.message), []);
});

test('an extension SyntaxError is identified while the core and later modules still render', async t => {
  const { page, errors } = await pageFor(t, '?fault=extension');
  assert.equal(await page.locator('#baraka-runtime-errors').isVisible(), true);
  assert.match(await page.locator('#baraka-runtime-details').innerText(), /recruitment-tools-8.0/);
  await page.evaluate(() => navigate('ops-integration'));
  assert.match(await page.locator('#content h1').innerText(), /Integrasi OPS/);
  assert.ok(errors.some(e => e.name === 'SyntaxError'));
  assert.ok(!errors.some(e => e.name === 'ReferenceError' || e.name === 'TypeError'));
});

test('failed render enhancement does not stop later hooks or other route navigation', async t => {
  const { page, errors } = await pageFor(t);
  await page.evaluate(() => {
    BarakaRuntime.addRenderHook('failed-module', () => { throw new Error('render fixture failure'); });
    BarakaRuntime.addRenderHook('later-module', () => { window.laterHookRan = true; });
    navigate('recruitment');
  });
  assert.equal(await page.evaluate(() => window.laterHookRan), true);
  assert.match(await page.locator('#baraka-runtime-details').innerText(), /failed-module: render fixture failure/);
  await page.evaluate(() => navigate('documents'));
  assert.match(await page.locator('#content h1').innerText(), /Dokumen/);
  assert.deepEqual(errors.map(e => e.message), []);
});

test('OPS console and bonus preview pages keep their independent UI with an empty backend config', async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.addInitScript(() => {
    const runner = {
      withSuccessHandler(fn) { this.success = fn; return this; },
      withFailureHandler() { return this; },
      getOpsBootstrap() { this.success({ ok: true, configVersion: 0, branches: [], auditSpreadsheetUrl: '' }); }
    };
    window.google = { script: { run: runner } };
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/?ops=1');
  assert.match(await page.locator('body').innerText(), /OPS/);
  await page.goto(origin + '/?bonus=1');
  assert.equal(await page.locator('#previewBtn').isVisible(), true);
  assert.match(await page.locator('body').innerText(), /Penulisan dinonaktifkan/);
  assert.deepEqual(errors, []);
});
