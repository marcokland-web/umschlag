// Gemeinsame Testhilfen: nachgebildetes Supabase, App-Auslieferung, Warteschleife.
// Keine echten Daten: *.supabase.co ist per Host-Regel gesperrt (siehe LAUNCH), alle Anfragen werden hier beantwortet.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://localhost:8799';           // localhost = sicherer Kontext (crypto.subtle für PKCE)
const SB = 'https://pcqabzbrorxwjaygmnks.supabase.co';
const SDK_URL = fs.readFileSync(path.join(ROOT, 'ynab.html'), 'utf8').match(/SB_SDK='([^']+)'/)[1];
const CACHE = path.join(__dirname, '.cache', 'supabase-' + SDK_URL.match(/@([\d.]+)\//)[1] + '.js');
const USER = { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'test@example.com',
  app_metadata: { provider: 'google', providers: ['email', 'google'] }, user_metadata: { full_name: 'Test Nutzer' } };
const K = 'ynab-nachbau-v1';

let pass = 0, fail = 0;
const results = [];
async function t(name, fn) {
  try { await fn(); pass++; results.push('✓ ' + name); }
  catch (e) { fail++; results.push('✗ ' + name + '\n    ' + String(e && e.stack || e).split('\n').slice(0, 3).join('\n    ')); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'Bedingung nicht erfüllt'); };

async function sdk() {
  if (fs.existsSync(CACHE)) return fs.readFileSync(CACHE);
  const r = await fetch(SDK_URL); if (!r.ok) throw new Error('SDK nicht ladbar');
  const b = Buffer.from(await r.arrayBuffer()); fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, b); return b;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

/** Neuer Browser-Kontext mit nachgebildetem Supabase. mode steuert, wie „Google“ antwortet. */
async function setup(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 }, serviceWorkers: 'block',
    colorScheme: opts.dark ? 'dark' : 'light', hasTouch: !!opts.touch, isMobile: !!opts.touch, locale: 'de-DE' });
  const log = { authorize: [], token: [], logout: [], rest: [], mode: opts.mode || 'ok' };
  const body = await sdk();
  await ctx.route(SDK_URL, r => r.fulfill({ status: 200, body, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } }));
  // App-Dateien: „/“ liefert ynab.html (so wie GitHub Pages nach dem Deploy index.html = ynab.html)
  await ctx.route(ORIGIN + '/**', r => {
    let p = new URL(r.request().url()).pathname; if (p === '/' || p === '/index.html') p = '/ynab.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ status: 200, body: fs.readFileSync(f), headers: { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' } });
  });
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'content-type': 'application/json' };
  await ctx.route(SB + '/**', async r => {
    const req = r.request(), u = new URL(req.url());
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
    if (u.pathname === '/auth/v1/authorize') {
      log.authorize.push(u);
      const back = new URL(u.searchParams.get('redirect_to'));
      if (log.mode === 'cancel') { back.searchParams.set('error', 'access_denied'); back.searchParams.set('error_code', 'access_denied'); back.searchParams.set('error_description', 'The user denied the request'); }
      else if (log.mode === 'servererr') { back.searchParams.set('error', 'server_error'); back.searchParams.set('error_description', 'Unable to exchange external code'); }
      else if (log.mode === 'signupoff') { back.searchParams.set('error', 'access_denied'); back.searchParams.set('error_code', 'signup_disabled'); back.searchParams.set('error_description', 'Signups not allowed for this instance'); }
      else if (log.mode === 'hook403') { back.hash = 'error=access_denied&error_code=403&error_description=' + encodeURIComponent('Forbidden by before-user-created hook'); }
      else if (log.mode === 'hookLiveQ') { back.searchParams.set('error', 'server_error'); back.searchParams.set('error_code', 'unknown'); back.searchParams.set('error_description', 'Kein Zugang – bitte von der Familie freischalten lassen.'); }
      else if (log.mode === 'hookLiveH') { back.hash = 'error=server_error&error_code=unknown&error_description=' + encodeURIComponent('Kein Zugang – bitte von der Familie freischalten lassen.'); }
      else back.searchParams.set('code', 'TESTCODE-' + log.authorize.length);
      // (Ein echtes 302 würde Playwright nicht erneut abfangen; daher Weiterleitung per Seite.)
      return r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: `<script>location.replace(${JSON.stringify(back.toString())})</script>` });
    }
    if (u.pathname === '/auth/v1/token') {
      const b = JSON.parse(req.postData() || '{}'); log.token.push({ grant: u.searchParams.get('grant_type'), ...b });
      if (log.tokenDelay) await new Promise(res => setTimeout(res, log.tokenDelay));
      if (log.mode === 'hookLiveToken') return r.fulfill({ status: 403, headers: cors, body: JSON.stringify({ code: 403, error_code: 'unknown', msg: 'Kein Zugang – bitte von der Familie freischalten lassen.' }) });
      if (log.mode === 'expired403') return r.fulfill({ status: 403, headers: cors, body: JSON.stringify({ code: 403, error_code: 'flow_state_expired', msg: 'Flow state has expired' }) });
      if (log.mode === 'badverifier403') return r.fulfill({ status: 403, headers: cors, body: JSON.stringify({ code: 403, error_code: 'bad_code_verifier', msg: 'code challenge does not match previously saved code verifier' }) });
      if (log.mode === 'badgrant') return r.fulfill({ status: 400, headers: cors, body: JSON.stringify({ error: 'invalid_grant', error_description: 'invalid flow state, no valid flow state found', code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found' }) });
      const now = Math.floor(Date.now() / 1000);
      return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ access_token: 'x.' + Buffer.from(JSON.stringify({ sub: (log.user || USER).id, exp: now + 3600 })).toString('base64url') + '.y', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt', user: log.user || USER }) });
    }
    if (u.pathname === '/auth/v1/logout') { log.logout.push(u.searchParams.get('scope')); if (log.logoutFail) return r.abort('internetdisconnected'); return r.fulfill({ status: 204, headers: cors, body: '' }); }
    if (u.pathname.startsWith('/rest/v1/')) {
      log.rest.push(req.method() + ' ' + u.pathname + ' ' + (req.postData() || ''));
      if (req.method() === 'GET') return r.fulfill({ status: 200, headers: cors, body: '[]' });
      return r.fulfill({ status: req.method() === 'DELETE' ? 204 : 201, headers: cors, body: '' });
    }
    return r.fulfill({ status: 404, headers: cors, body: '{}' });
  });
  if (opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  return { ctx, page, log, errors };
}

// waitForFunction nutzt eval – das verbietet die CSP der App (gewollt, sie bleibt im Test aktiv). Daher eigene Schleife.
async function until(page, fn, arg = null, o = {}) {
  const end = Date.now() + (o.timeout || 15000);
  for (;;) {
    let v; try { v = await page.evaluate(fn, arg); } catch (e) { if (!/context was destroyed|navigation/i.test(String(e))) throw e; }
    if (v) return v; if (Date.now() > end) throw new Error('Zeitüberschreitung: ' + String(fn)); await new Promise(r => setTimeout(r, 100));
  }
}
const open = async (page, q = '') => { await page.goto(ORIGIN + '/ynab.html' + q); await until(page, () => typeof sbC !== 'undefined' && sbC !== null, null, { timeout: 15000 }); };
const loginModal = page => page.locator('.mod .lgin');
async function signIn(page) {
  await page.locator('.lgin .gbtn').click();
  await page.waitForURL(u => !/code=/.test(u.toString()) && u.pathname === '/', { timeout: 15000 });
  await until(page, () => !!sbUser, null, { timeout: 15000 });
}

const LAUNCH = { args: ['--host-resolver-rules=MAP *.supabase.co 0.0.0.0'] };
/** Ergebnis ausgeben und mit Exit≠0 enden, wenn etwas fehlschlug. */
function finish() { console.log(results.join('\n')); console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`); process.exit(fail ? 1 : 0); }
module.exports = { chromium, fs, path, ROOT, ORIGIN, SB, USER, K, t, ok, setup, until, open, loginModal, signIn, LAUNCH, finish };
