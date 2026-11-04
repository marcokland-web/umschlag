// Randfälle der Google-Anmeldung (Befunde von Bug-Bodo, Sicherheits-Siggi und Design-Doris, 03.11.2026).
// Aufruf:  NODE_PATH=~/Apps/DasTeam/tools/node_modules node tests/google-randfaelle.test.js
// Endet mit Exit≠0, wenn ein Test fehlschlägt.
const { chromium, USER, t, ok, setup, until, open, loginModal, signIn, LAUNCH, finish } = require('./helpers');

const USER_B = { ...USER, id: '00000000-0000-4000-8000-0000000000bb', email: 'b@example.com', user_metadata: { full_name: 'Berta', avatar_url: 'https://lh3.googleusercontent.com/a/test-foto' } };
const MARKER = { id: 'marker-a', date: null, payee: 'NUR-KONTO-A', cat: null, memo: '', out: 1, in: 0, cl: false };

/** Konto A meldet sich an, legt eine Buchung an, synchronisiert und meldet sich nur ab. Danach meldet sich B an. */
async function swapToB(page, log) {
  await open(page); await loginModal(page).waitFor(); await signIn(page);
  await until(page, () => sbSt === 'ok');
  await page.evaluate(m => { commit(() => { S.tx.push({ ...m, acc: S.accounts[0].id, date: TODAY }) }) }, MARKER);
  await until(page, () => sbSt === 'ok' && !sbDirty(), null, { timeout: 10000 });
  await page.evaluate(() => { UI.modal = { t: 'disp' }; render(); });
  await page.locator('#sbset [data-a=sbout]').click(); await page.locator('.mod .sbo').waitFor();
  await page.locator('[data-a=sbo0]').click();
  await until(page, () => !sbUser && sbSt === 'off');
  log.user = USER_B; log.rest.length = 0;
  await page.evaluate(() => { UI.modal = { t: 'login' }; render(); });
  await page.locator('.lgin .gbtn').click();
  await page.waitForURL(u => !/code=/.test(u.toString()) && u.pathname === '/', { timeout: 15000 });
  await page.locator('.mod .sbo [data-a=sbsw-take]').waitFor({ timeout: 15000 });
}
const leaked = log => log.rest.filter(x => /^(POST|PATCH)/.test(x) && x.includes('NUR-KONTO-A'));

(async () => {
  const browser = await chromium.launch(LAUNCH);

  await t('Kontowechsel: Rückfrage statt Zusammenführen, nichts von Konto A landet in Konto B', async () => {
    const { ctx, page, log } = await setup(browser);
    await swapToB(page, log);
    const txt = await page.locator('.mod .sbo').innerText();
    ok(/Auf diesem Gerät liegen Daten eines anderen Kontos\. Übernehmen oder verwerfen\?/.test(txt), txt);
    ok(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'sbsw-x', 'Startfokus nicht auf Abbrechen');
    await page.waitForTimeout(2500); // Sync-Takt abwarten
    ok(leaked(log).length === 0, 'Daten von A an Konto B gesendet');
    ok(await page.evaluate(() => sbUser) === null, 'Konto B schon aktiv');
    await ctx.close();
  });

  await t('Kontowechsel, Abbrechen: meldet B ab, Daten von A bleiben, nichts hochgeladen', async () => {
    const { ctx, page, log } = await setup(browser);
    await swapToB(page, log);
    await page.locator('#sbsw-x').click();
    await until(page, () => !sbUser && sbSt === 'off' && !UI.modal);
    ok(!(await page.evaluate(() => Object.keys(localStorage).some(k => /auth-token/.test(k)))), 'Sitzung von B noch gespeichert');
    ok(await page.evaluate(() => JSON.stringify(S.tx).includes('NUR-KONTO-A')), 'Daten von A verloren');
    ok(leaked(log).length === 0, 'Daten hochgeladen');
    await ctx.close();
  });

  await t('Kontowechsel, Übernehmen: Daten werden in Konto B übertragen (bewusste Entscheidung)', async () => {
    const { ctx, page, log } = await setup(browser);
    await swapToB(page, log);
    await page.locator('[data-a=sbsw-take]').click();
    await until(page, () => !!sbUser && sbUser.id.endsWith('bb') && sbSt === 'ok', null, { timeout: 10000 });
    ok(leaked(log).length > 0, 'Daten nicht übertragen');
    ok(await page.evaluate(() => lsGet('sb-uid')) === USER_B.id, 'sb-uid nicht umgestellt');
    await ctx.close();
  });

  await t('Kontowechsel, Verwerfen: zweite Rückfrage (rot), danach Daten von A vom Gerät gelöscht, B aktiv', async () => {
    const { ctx, page, log } = await setup(browser);
    await swapToB(page, log);
    await page.locator('[data-a=sbsw-del]').click();
    await page.locator('[data-a=sbsw-delok]').waitFor();
    const bg = await page.locator('[data-a=sbsw-delok]').evaluate(e => getComputedStyle(e).backgroundColor);
    ok(bg === 'rgb(179, 38, 30)', 'Verwerfen-Knopf nicht rot: ' + bg);
    await page.locator('#sbsw2-x').click(); await page.locator('[data-a=sbsw-take]').waitFor(); // Abbrechen führt zurück
    await page.locator('[data-a=sbsw-del]').click();
    await Promise.all([page.waitForEvent('load'), page.locator('[data-a=sbsw-delok]').click()]);
    await until(page, () => typeof sbUser !== 'undefined' && !!sbUser && sbSt === 'ok', null, { timeout: 15000 });
    ok(await page.evaluate(() => sbUser.id) === USER_B.id, 'nicht als B angemeldet');
    ok(!(await page.evaluate(() => JSON.stringify(S.tx).includes('NUR-KONTO-A') || (localStorage.getItem('ynab-nachbau-v1') || '').includes('NUR-KONTO-A'))), 'Daten von A noch auf dem Gerät');
    ok(leaked(log).length === 0, 'Daten von A hochgeladen');
    await ctx.close();
  });

  await t('Alte Adresse mit ?code= bei bestehender Sitzung: bleibt angemeldet, keine Fehlermeldung', async () => {
    const { ctx, page, log } = await setup(browser);
    await open(page); await loginModal(page).waitFor(); await signIn(page);
    await until(page, () => sbSt === 'ok');
    log.mode = 'badgrant';
    await open(page, '?code=ALT');
    await until(page, () => !!sbUser, null, { timeout: 10000 });
    const st = await page.evaluate(() => ({ modal: UI.modal && UI.modal.t, url: location.search }));
    ok(st.modal !== 'login' && st.url === '', 'wirkt abgemeldet/URL unsauber: ' + JSON.stringify(st));
    await ctx.close();
  });

  await t('Abmelden und löschen ohne Netz: Sitzung wird trotzdem vom Gerät entfernt', async () => {
    const { ctx, page, log } = await setup(browser);
    await open(page); await loginModal(page).waitFor(); await signIn(page);
    await until(page, () => sbSt === 'ok');
    log.logoutFail = true;
    await page.evaluate(() => { UI.modal = { t: 'disp' }; render(); });
    await page.locator('#sbset [data-a=sbout]').click(); await page.locator('.mod .sbo').waitFor();
    await Promise.all([page.waitForEvent('load'), page.locator('[data-a=sbo1]').click()]);
    await until(page, () => typeof S !== 'undefined');
    ok(log.logout.length === 1, 'Abmelden nicht versucht');
    const keys = await page.evaluate(() => Object.keys(localStorage));
    ok(!keys.some(k => /auth-token|code-verifier/.test(k)), 'Sitzung noch gespeichert: ' + keys.join(','));
    ok(await page.evaluate(() => sbUser) === null);
    await ctx.close();
  });

  await t('Rückkehr von Google: Ladezustand „Anmeldung wird abgeschlossen …“ mit Kreisel', async () => {
    const { ctx, page, log } = await setup(browser);
    await open(page); await loginModal(page).waitFor();
    log.tokenDelay = 1500;
    await page.locator('.lgin .gbtn').click();
    await page.locator('.lgin .lgfin .spin').waitFor({ timeout: 10000 });
    ok(/Anmeldung wird abgeschlossen …/.test(await page.locator('.lgin .lgfin').innerText()));
    ok(await page.locator('.lgin .lgfin[role=status]').count() === 1, 'role=status fehlt');
    await until(page, () => !!sbUser);
    ok(await page.evaluate(() => UI.modal && UI.modal.t) === 'disp', 'danach nicht in den Einstellungen');
    await ctx.close();
  });

  await t('Ladezustand Englisch: „Finishing sign-in …“, Knopf „Opening Google …“', async () => {
    const { ctx, page } = await setup(browser, { init: () => localStorage.setItem('studio-lang', 'en') });
    await open(page); await loginModal(page).waitFor();
    await page.evaluate(() => { UI.modal = { t: 'login', finishing: true }; render(); });
    ok(/Finishing sign-in …/.test(await page.locator('.lgin').innerText()));
    await page.evaluate(() => { UI.modal = { t: 'login', busy: true }; render(); });
    ok(/Opening Google …/.test(await page.locator('.lgin .gbtn').innerText()));
    await ctx.close();
    const de = await setup(browser); // eigener Kontext: das Init-Skript oben setzt bei jedem Laden Englisch
    await open(de.page); await loginModal(de.page).waitFor();
    await de.page.evaluate(() => { UI.modal = { t: 'login', busy: true }; render(); });
    ok(/Google wird geöffnet …/.test(await de.page.locator('.lgin .gbtn').innerText()));
    await de.ctx.close();
  });

  for (const [mode, where] of [['signupoff', 'Query'], ['hook403', 'Hash']]) {
    await t(`Kein Zugang (${mode}, ${where}): eigene Meldung, kein stiller Abbruch`, async () => {
      const { ctx, page } = await setup(browser, { mode });
      await open(page); await loginModal(page).waitFor();
      await page.locator('.lgin .gbtn').click();
      await page.locator('.lgin [role=alert]').waitFor({ timeout: 10000 });
      ok((await page.locator('.lgin [role=alert]').innerText()) === 'Kein Zugang – bitte von der Familie freischalten lassen.');
      ok(!/error/.test(page.url()), 'URL nicht gesäubert: ' + page.url());
      await ctx.close();
    });
  }

  // Echte Antwort des Before-User-Created-Hooks (gemessen 04.11.2026): 403, error_code "unknown", Meldung im Text
  for (const mode of ['hookLiveQ', 'hookLiveH', 'hookLiveToken']) {
    await t(`Kein Zugang, echte Hook-Antwort (${mode})`, async () => {
      const { ctx, page } = await setup(browser, { mode });
      await open(page); await loginModal(page).waitFor();
      await page.locator('.lgin .gbtn').click();
      await page.locator('.lgin [role=alert]').waitFor({ timeout: 10000 });
      ok((await page.locator('.lgin [role=alert]').innerText()) === 'Kein Zugang – bitte von der Familie freischalten lassen.', await page.locator('.lgin [role=alert]').innerText());
      ok(!/error|code=/.test(page.url()), 'URL nicht gesäubert');
      await ctx.close();
    });
  }
  for (const mode of ['expired403', 'badverifier403']) {
    await t(`403 mit ${mode}: gilt weiter als „abgelaufen“, nicht als „Kein Zugang“`, async () => {
      const { ctx, page } = await setup(browser, { mode });
      await open(page); await loginModal(page).waitFor();
      await page.locator('.lgin .gbtn').click();
      await page.locator('.lgin [role=alert]').waitFor({ timeout: 10000 });
      ok(/abgelaufen oder wurde in einem anderen Browser/.test(await page.locator('.lgin [role=alert]').innerText()));
      await ctx.close();
    });
  }

  await t('Kein Zugang Englisch', async () => {
    const { ctx, page } = await setup(browser, { init: () => localStorage.setItem('studio-lang', 'en') });
    await page.goto('http://localhost:8799/?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed');
    await page.locator('.lgin [role=alert]').waitFor();
    ok((await page.locator('.lgin [role=alert]').innerText()) === 'No access – ask your family to add you.');
    await ctx.close();
  });

  await t('Konto-Zeile mit Google-Foto, Abmelden in Rot, Dialoge mit role=dialog', async () => {
    const { ctx, page, log } = await setup(browser);
    log.user = USER_B;
    await ctx.route('https://lh3.googleusercontent.com/**', r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#888"/></svg>' }));
    await open(page); await loginModal(page).waitFor();
    ok(await page.locator('.mod[role=dialog][aria-modal=true]').count() === 1, 'Anmeldefenster ohne role=dialog');
    const lk = await page.locator('.lgin [data-a=sbskip]').boundingBox(); ok(lk.height >= 44, '„Ohne Sync weiter“ kleiner als 44 px');
    await signIn(page);
    const img = page.locator('#sbset img.sbav'); await img.waitFor();
    ok(await img.evaluate(e => e.complete && e.naturalWidth > 0), 'Foto nicht geladen (CSP?)');
    await until(page, () => sbSt === 'ok');
    const col = await page.evaluate(() => { const e = document.querySelector('#sbset [data-a=sbout] .stl'); return e ? getComputedStyle(e).color : 'fehlt'; });
    ok(col === 'rgb(179, 38, 30)', 'Abmelden nicht rot: ' + col);
    const gw = await page.locator('.gbtn').count(); ok(gw === 0, 'Google-Knopf trotz Anmeldung');
    await ctx.close();
  });

  await t('Google-Knopf: Schriftgewicht 500, „G“ 20 px, Farben aus Tokens', async () => {
    const { ctx, page } = await setup(browser, { dark: true });
    await open(page); await loginModal(page).waitFor();
    const st = await page.locator('.gbtn').evaluate(e => { const c = getComputedStyle(e), r = getComputedStyle(document.documentElement), g = e.querySelector('svg').getBoundingClientRect(); return { w: c.fontWeight, gw: g.width, bg: c.backgroundColor, tok: r.getPropertyValue('--gsi-bg').trim() }; });
    ok(st.w === '500' && st.gw === 20 && st.bg === 'rgb(19, 19, 20)' && st.tok.toUpperCase() === '#131314', JSON.stringify(st));
    await ctx.close();
  });

  await browser.close();
  finish();
})().catch(e => { console.error(e); process.exit(1); });
