// Browser-Tests für „Mit Google anmelden“ (Supabase Auth, PKCE, Weiterleitung).
// Aufruf:  NODE_PATH=~/Apps/DasTeam/tools/node_modules node tests/google-anmeldung.test.js
// Optional: SHOTS=1 legt Bildschirmfotos in tests/shots/ ab (1440×900, 820×1180, 390×844, hell/dunkel).
//
// Keine echten Daten: *.supabase.co ist per Host-Regel gesperrt, alle Anfragen an Supabase
// (authorize, token, logout, rest) werden im Test beantwortet. Google wird nie aufgerufen.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'http://localhost:8799';           // localhost = sicherer Kontext (crypto.subtle für PKCE)
const SB = 'https://pcqabzbrorxwjaygmnks.supabase.co';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const CACHE = path.join(__dirname, '.cache', 'supabase-2.45.4.js');
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
      else back.searchParams.set('code', 'TESTCODE-' + log.authorize.length);
      // (Ein echtes 302 würde Playwright nicht erneut abfangen; daher Weiterleitung per Seite.)
      return r.fulfill({ status: 200, headers: { 'content-type': 'text/html' }, body: `<script>location.replace(${JSON.stringify(back.toString())})</script>` });
    }
    if (u.pathname === '/auth/v1/token') {
      const b = JSON.parse(req.postData() || '{}'); log.token.push({ grant: u.searchParams.get('grant_type'), ...b });
      if (log.mode === 'badgrant') return r.fulfill({ status: 400, headers: cors, body: JSON.stringify({ error: 'invalid_grant', error_description: 'invalid flow state, no valid flow state found', code: 'flow_state_not_found', msg: 'invalid flow state, no valid flow state found' }) });
      const now = Math.floor(Date.now() / 1000);
      return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ access_token: 'x.' + Buffer.from(JSON.stringify({ sub: USER.id, exp: now + 3600 })).toString('base64url') + '.y', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'rt', user: USER }) });
    }
    if (u.pathname === '/auth/v1/logout') { log.logout.push(u.searchParams.get('scope')); return r.fulfill({ status: 204, headers: cors, body: '' }); }
    if (u.pathname.startsWith('/rest/v1/')) {
      log.rest.push(req.method() + ' ' + u.pathname);
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

(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP *.supabase.co 0.0.0.0'] });

  await t('Erster Start: Anmeldefenster nur mit Google, kein E-Mail/Passwort, „Ohne Sync weiter“ vorhanden', async () => {
    const { ctx, page, errors } = await setup(browser);
    await open(page); await loginModal(page).waitFor();
    const txt = await loginModal(page).innerText();
    ok(/Mit Google anmelden/.test(txt), 'Google-Knopf fehlt');
    ok(/Ohne Sync weiter/.test(txt), '„Ohne Sync weiter“ fehlt');
    ok(!/Registrieren|Passwort|Bestätigungs/i.test(txt), 'alte Texte noch da: ' + txt);
    ok(await page.locator('input[type=password], input[type=email]').count() === 0, 'E-Mail-/Passwort-Feld noch vorhanden');
    ok(await page.locator('.gbtn svg path').count() === 4, 'Google-„G“ fehlt');
    const h = await page.locator('.gbtn').boundingBox(); ok(h.height >= 44, 'Knopf kleiner als 44 px');
    ok(errors.length === 0, errors.join('; '));
    await ctx.close();
  });

  await t('Englisch: „Sign in with Google“ und „Continue without sync“', async () => {
    const { ctx, page } = await setup(browser, { init: () => localStorage.setItem('studio-lang', 'en') });
    await open(page); await loginModal(page).waitFor();
    const txt = await loginModal(page).innerText();
    ok(/Sign in with Google/.test(txt) && /Continue without sync/.test(txt), txt);
    await ctx.close();
  });

  await t('„Ohne Sync weiter“ schließt das Fenster und merkt es sich', async () => {
    const { ctx, page } = await setup(browser);
    await open(page); await loginModal(page).waitFor();
    await page.locator('[data-a=sbskip]').click();
    ok(await loginModal(page).count() === 0, 'Fenster noch offen');
    await page.reload(); await until(page, () => sbSt === 'off');
    await page.waitForTimeout(300);
    ok(await loginModal(page).count() === 0, 'Fenster erscheint nach Neuladen wieder');
    await ctx.close();
  });

  await t('Anmelden: Weiterleitung mit PKCE, Code-Austausch, URL gesäubert, Sync angestoßen, Einstellungen zeigen Konto', async () => {
    const { ctx, page, log, errors } = await setup(browser);
    await open(page); await loginModal(page).waitFor();
    await signIn(page);
    const a = log.authorize[0];
    ok(a.searchParams.get('provider') === 'google', 'provider');
    ok(a.searchParams.get('redirect_to') === ORIGIN + '/', 'redirect_to = ' + a.searchParams.get('redirect_to'));
    ok(a.searchParams.get('code_challenge') && /s256/i.test(a.searchParams.get('code_challenge_method')), 'kein PKCE (S256)');
    ok(a.searchParams.get('prompt') === 'select_account', 'prompt=select_account fehlt');
    ok(log.token.length === 1 && log.token[0].grant === 'pkce' && log.token[0].auth_code === 'TESTCODE-1' && log.token[0].code_verifier, 'Code-Austausch falsch: ' + JSON.stringify(log.token));
    ok(!/code=|error=/.test(page.url()), 'URL nicht gesäubert: ' + page.url());
    await until(page, () => sbSt === 'ok', null, { timeout: 10000 });
    ok(log.rest.some(x => x.includes('base_settings')), 'Sync nicht angestoßen');
    const set = await page.locator('#sbset').innerText();
    ok(/Angemeldet als/.test(set) && /Test Nutzer/.test(set) && /test@example\.com/.test(set), 'Konto nicht angezeigt: ' + set);
    ok(await page.evaluate(() => lsGet('sb-skip')) === null, 'sb-skip nicht gelöscht');
    ok(await page.evaluate(() => lsGet('sb-oauth')) === null, 'sb-oauth nicht aufgeräumt');
    // Neu laden: Sitzung bleibt, kein Anmeldefenster
    await page.reload(); await until(page, () => !!sbUser, null, { timeout: 10000 });
    ok(await loginModal(page).count() === 0, 'Anmeldefenster trotz Sitzung');
    ok(errors.length === 0, errors.join('; '));
    await ctx.close();
  });

  await t('Abbruch bei Google ist kein Fehler: Anmeldefenster ohne Fehlermeldung, URL sauber', async () => {
    const { ctx, page, log } = await setup(browser, { mode: 'cancel' });
    await open(page); await loginModal(page).waitFor();
    await page.locator('.lgin .gbtn').click();
    await page.waitForURL(u => u.pathname === '/' && !/error=/.test(u.toString()));
    await loginModal(page).waitFor();
    ok(await page.locator('.lgin [role=alert]').count() === 0, 'Fehlermeldung trotz Abbruch');
    ok(log.token.length === 0, 'Token-Austausch trotz Abbruch');
    ok(await page.evaluate(() => sbUser) === null, 'angemeldet trotz Abbruch');
    await ctx.close();
  });

  await t('Fehler von Supabase/Google wird verständlich angezeigt (DE und EN)', async () => {
    const { ctx, page } = await setup(browser, { mode: 'servererr' });
    await open(page); await loginModal(page).waitFor();
    await page.locator('.lgin .gbtn').click();
    await page.locator('.lgin [role=alert]').waitFor();
    const m = await page.locator('.lgin [role=alert]').innerText();
    ok(/Anmelden hat nicht geklappt/.test(m) && /Versuch es noch einmal/.test(m), m);
    ok(!/error=/.test(page.url()), 'URL nicht gesäubert');
    await page.evaluate(() => { localStorage.setItem('studio-lang', 'en'); });
    await page.goto(ORIGIN + '/?error=server_error&error_description=Boom'); await page.locator('.lgin [role=alert]').waitFor();
    ok(/Sign-in didn’t work \(Boom\)/.test(await page.locator('.lgin [role=alert]').innerText()), 'EN-Fehler fehlt');
    await ctx.close();
  });

  await t('Code-Austausch scheitert (anderer Browser/abgelaufen): eigene Meldung', async () => {
    const { ctx, page } = await setup(browser, { mode: 'badgrant' });
    await open(page); await loginModal(page).waitFor();
    await page.locator('.lgin .gbtn').click();
    await page.locator('.lgin [role=alert]').waitFor({ timeout: 10000 });
    ok(/abgelaufen oder wurde in einem anderen Browser/.test(await page.locator('.lgin [role=alert]').innerText()));
    ok(await page.evaluate(() => sbUser) === null);
    await ctx.close();
  });

  await t('Ohne Internet: klare Meldung statt Weiterleitung', async () => {
    const { ctx, page, log } = await setup(browser);
    await open(page); await loginModal(page).waitFor();
    await ctx.setOffline(true);
    await page.locator('.lgin .gbtn').click();
    await page.locator('.lgin [role=alert]').waitFor();
    ok(/Keine Verbindung/.test(await page.locator('.lgin [role=alert]').innerText()));
    ok(log.authorize.length === 0, 'trotzdem weitergeleitet');
    await ctx.setOffline(false); await ctx.close();
  });

  await t('Installierte App (iPhone standalone): Weiterleitung im selben Fenster, kein Pop-up', async () => {
    const { ctx, page, log } = await setup(browser, { viewport: { width: 390, height: 844 }, touch: true,
      init: () => { Object.defineProperty(navigator, 'standalone', { value: true }); const mm = window.matchMedia.bind(window); window.matchMedia = q => /display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q); } });
    await open(page); await loginModal(page).waitFor();
    await signIn(page);
    ok(ctx.pages().length === 1, 'zusätzliches Fenster geöffnet');
    ok(log.authorize.length === 1 && log.token.length === 1);
    await ctx.close();
  });

  await t('Abmelden: Rückfrage mit rotem Knopf; Abbrechen ändert nichts; „Nur abmelden“ behält Daten (scope local)', async () => {
    const { ctx, page, log } = await setup(browser);
    await open(page); await loginModal(page).waitFor(); await signIn(page);
    await until(page, () => sbSt === 'ok');
    await page.locator('#sbset [data-a=sbout]').click();
    const d = page.locator('.mod .sbo'); await d.waitFor();
    ok(/Abmelden\?/.test(await d.innerText()), 'Titel fehlt');
    const bg = await d.locator('[data-a=sbo1]').evaluate(e => getComputedStyle(e).backgroundColor);
    ok(bg === 'rgb(179, 38, 30)', 'Löschen-Knopf nicht rot: ' + bg);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'sbo-x', 'Fokus nicht auf Abbrechen');
    await d.locator('#sbo-x').click();
    ok(await page.evaluate(() => !!sbUser), 'Abbrechen hat abgemeldet');
    await page.evaluate(() => { UI.modal = { t: 'disp' }; render(); });
    await page.locator('#sbset [data-a=sbout]').click(); await d.waitFor();
    const before = await page.evaluate(k => localStorage.getItem(k), K);
    await d.locator('[data-a=sbo0]').click();
    await until(page, () => !sbUser && sbSt === 'off');
    ok(log.logout[0] === 'local', 'Abmelden nicht lokal: ' + log.logout[0]);
    ok(await page.evaluate(k => localStorage.getItem(k), K) === before, 'lokale Daten verändert');
    ok(!(await page.evaluate(() => Object.keys(localStorage).some(k => /auth-token/.test(k)))), 'Sitzung noch gespeichert');
    await ctx.close();
  });

  await t('Abmelden und vom Gerät löschen: Finanzdaten und Sicherungen weg, Thema/Sprache bleiben', async () => {
    const { ctx, page } = await setup(browser);
    await open(page); await loginModal(page).waitFor(); await signIn(page);
    await until(page, () => sbSt === 'ok');
    await page.evaluate(() => { localStorage.setItem('studio-theme', 'dark'); commit(() => { S.tx.push({ id: 'marker', acc: S.accounts[0].id, date: TODAY, payee: 'GEHEIM-MARKER', cat: null, memo: '', out: 12.34, in: 0, cl: false }) }); return bkSave('manual'); });
    await until(page, () => sbSt === 'ok' && !sbDirty(), null, { timeout: 10000 });
    await page.evaluate(() => { UI.modal = { t: 'disp' }; render(); });
    await page.locator('#sbset [data-a=sbout]').click(); await page.locator('.mod .sbo').waitFor();
    await Promise.all([page.waitForEvent('load'), page.locator('[data-a=sbo1]').click()]);
    await until(page, () => typeof S !== 'undefined');
    const st = await page.evaluate(() => ({ k: localStorage.getItem('ynab-nachbau-v1') || '', th: localStorage.getItem('studio-theme'), snap: localStorage.getItem('sb-snap'), tx: JSON.stringify(S.tx) }));
    ok(!st.k.includes('GEHEIM-MARKER') && !st.tx.includes('GEHEIM-MARKER'), 'Finanzdaten nicht gelöscht');
    ok(st.th === 'dark', 'Thema verloren');
    ok(st.snap === null, 'Sync-Stand nicht gelöscht');
    const bk = await page.evaluate(() => bkList().then(L => L.map(x => x.data).join('')));
    ok(!bk.includes('GEHEIM-MARKER'), 'Sicherung noch vorhanden');
    ok(await page.evaluate(() => sbUser) === null);
    await ctx.close();
  });

  await t('Ungesicherte Änderungen: Warnung im Abmelden-Fenster', async () => {
    const { ctx, page } = await setup(browser);
    await open(page); await loginModal(page).waitFor(); await signIn(page);
    await until(page, () => sbSt === 'ok');
    await ctx.setOffline(true);
    await page.evaluate(() => { commit(() => { S.notes = { ...(S.notes || {}), x: 'y' } }); UI.modal = { t: 'disp' }; render(); });
    await page.locator('#sbset [data-a=sbout]').click();
    await page.locator('.sbo .sbw').waitFor();
    ok(/noch nicht übertragen/.test(await page.locator('.sbo .sbw').innerText()));
    await ctx.setOffline(false); await ctx.close();
  });

  // Ansichten in drei Größen, hell und dunkel: kein seitliches Scrollen, Knopf/Fenster vollständig sichtbar
  const VIEWS = [['desktop', { width: 1440, height: 900 }, false], ['ipad', { width: 820, height: 1180 }, true], ['iphone', { width: 390, height: 844 }, true]];
  const SHOTS = process.env.SHOTS ? path.join(__dirname, 'shots') : null; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  for (const [nm, vp, touch] of VIEWS) for (const dark of [false, true]) {
    await t(`Ansicht ${nm} ${dark ? 'dunkel' : 'hell'}: Anmeldefenster, Einstellungen (angemeldet), Abmelden-Fenster`, async () => {
      const { ctx, page, errors } = await setup(browser, { viewport: vp, touch, dark });
      await open(page); await loginModal(page).waitFor();
      const check = async (sel, tag) => {
        const r = await page.evaluate(s => { const e = document.querySelector(s), b = e.getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, w: innerWidth, h: innerHeight, l: b.left, r: b.right, t: b.top, b: b.bottom }; }, sel);
        ok(r.sw <= r.w, `${tag}: seitliches Scrollen`); ok(r.l >= 0 && r.r <= r.w && r.t >= 0 && r.b <= r.h + 1, `${tag}: abgeschnitten ${JSON.stringify(r)}`);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${nm}-${dark ? 'dunkel' : 'hell'}-${tag}.png`) });
      };
      await check('.gbtn', 'login');
      const gb = await page.locator('.gbtn').evaluate(e => getComputedStyle(e).backgroundColor);
      ok(gb === (dark ? 'rgb(19, 19, 20)' : 'rgb(255, 255, 255)'), 'Google-Knopf-Farbe ' + gb);
      await page.evaluate(() => { UI.modal = { t: 'disp' }; render(); });
      await page.locator('#sbset .gbtn').scrollIntoViewIfNeeded(); await check('#sbset .gbtn', 'einstellungen-abgemeldet');
      await page.locator('#sbset .gbtn').click();
      await until(page, () => !!sbUser && UI.modal && UI.modal.t === 'disp', null, { timeout: 15000 });
      await until(page, () => sbSt === 'ok');
      await page.locator('#sbset [data-a=sbout]').scrollIntoViewIfNeeded(); await check('#sbset [data-a=sbout]', 'einstellungen-angemeldet');
      await page.locator('#sbset [data-a=sbout]').click(); await page.locator('.sbo').waitFor();
      await check('.sbo #sbo-x', 'abmelden');
      for (const s of ['[data-a=sbo1]', '[data-a=sbo0]', '#sbo-x']) { const b = await page.locator('.sbo ' + s).boundingBox(); ok(b.height >= 44, s + ' kleiner als 44 px'); }
      ok(errors.length === 0, errors.join('; '));
      await ctx.close();
    });
  }

  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
