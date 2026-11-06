# B.A.S.E – Budget Aufsetzen, Strategisch Einteilen

Exakter YNAB-Nachbau als Ein-Datei-PWA (Desktop, iPad, iPhone), Deutsch mit Englisch-Umschalter.
Veröffentlicht über GitHub Pages; die Hauptdatei muss im Repo `ynab.html` heißen.

## Dateien
- `ynab.html` – die komplette App (HTML, CSS, JS inline, ca. 240 KB). Hier passiert fast alles.
- `ynab-sw.js` – Service Worker (Cache `base-v5`, HTML immer netzfrisch, `*.supabase.co` wird nicht gecacht).
- `ynab-manifest.json` – PWA-Manifest (`id`/`start_url` `./`, `lang` de). Icons aus DasTeam `studio/brand/base*.svg`: `ynab-icon-180.png` (Apple), `ynab-icon-192/512.png`, `ynab-maskable-512.png`, `ynab-favicon-32.png`, `ynab-icon.svg`, `base-logo-512.png`. Icon-Adressen tragen `?v=2` (in `ynab.html` und Manifest); bei neuem Icon hochzählen, sonst behalten Browser und installierte App das alte.
- `base-supabase-schema.sql` – Tabellen + Row Level Security für Supabase (einmal im SQL Editor ausführen).

## Architektur von ynab.html
- Vanilla JS, keine Frameworks. Render-Funktionen liefern Template-Strings, `render()` schreibt sie in `$app.innerHTML`.
  Klicks laufen über Event-Delegation: Elemente tragen `data-a="aktion"`, ein großer Click-Handler verteilt (`if(a==='...')`).
- Zustand `S` = `{accounts, groups[{id,name,cats[{id,name,emoji,target,tt,due,snooze,note,hidden}]}], tx[], assigned{'catId|YYYYMM':betrag}, notes, rec[], recSkip, moves, payees, pins, goal, i18n, mod}`.
  Buchung: `{id,acc,date,payee,cat,memo,out,in,cl, xf?(Überweisungs-Gegenbuchung), sg?(Split-Gruppe)}`.
- UI-Zustand in `UI`, Schnelleingabe in `Q`. Änderungen immer über `commit(fn)` (Undo-Snapshot, `save()`, `render()`).
- `save()` setzt `S.mod`, schreibt localStorage und stößt `sbPush()` an.
- Layouts: `isTab()` (iPad/iPhone, grober Zeiger) und `isPhone()` (Breite <= 600). Ansichten für Touch in `PHV` (home, txl, accs, ref); Desktop nutzt `planHTML`/`accHTML`.
- Übersetzung: `gT(de,en)` und `trDom()` (Wörterbuch für englische Template-Texte). Neue Texte mit `gT` schreiben.
- Design nach Studio-Designsystem: Block „Studio-Designsystem“ am Ende des `<style>` überschreibt die alten Variablen (`--acc`, `--card` …) mit Bordeaux/Gold für `html.lt`/`html.dk`, Farbschleier, Liquid Glass nur für Navigation/Menüs. Systemschrift, keine Google Fonts.
- Thema/Sprache in localStorage `studio-theme`/`studio-lang` (Rückfall auf `ynab-*`), Skript am Ende von `<head>` setzt sie vor dem ersten Zeichnen.
- Einstellungen: `dispHTML()` (Darstellung, Sprache, Anzeige, Über), Zahnrad `gearB()` oben rechts, am Desktop auch unten in der Seitenleiste.
- Diagrammfarben über CSS-Variablen `--c-in`, `--c-out`, `--c-hi`, `--c-lo`, `--c-2`, `--c-2lo`.
- `BUILD`-Konstante (Version, auf der Startseite sichtbar) bei jeder Auslieferung hochzählen.

## Supabase-Sync
- URL `https://pcqabzbrorxwjaygmnks.supabase.co`, Publishable Key im Code (`SB_URL`, `SB_KEY`), SDK per jsDelivr geladen (`@supabase/supabase-js@2.118.0`, SRI in `SB_SRI`; bei Update Prüfsumme neu berechnen: `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`).
- Anmeldung nur noch **„Mit Google anmelden“** (Supabase Auth, `flowType: 'pkce'`, Weiterleitung im selben Fenster – auch in der installierten App). Kein E-Mail/Passwort mehr (Marco, 03.11.2026). „Ohne Sync weiter“ bleibt (rein lokal, merkt sich `sb-skip`).
  - Funktionen: `sbGoogle` (startet `signInWithOAuth`, `redirectTo` = App-Ordner, z. B. `https://marcokland-web.github.io/umschlag/`, `prompt=select_account`), `sbInit` verarbeitet die Rückkehr (`sbUrlRet`: `?code=` → `exchangeCodeForSession`, `?error=`/`#error=`; `access_denied` = Abbruch, kein Fehler; `signup_disabled` oder 403 eines Before-User-Created-Hooks = „Kein Zugang – bitte von der Familie freischalten lassen.“, erkannt auch am Meldungstext „Kein Zugang“/„freischalten“ bei generischem error_code; 403 mit `flow_state_expired`/`bad_code_verifier` bleibt „abgelaufen“). Nach der Rückkehr zeigt das Anmeldefenster „Anmeldung wird abgeschlossen …“ mit Kreisel; scheitert der Code-Tausch bei bestehender Sitzung, bleibt man angemeldet. Fehlertexte ohne technischen Rohtext (der landet in der Konsole), `sbCleanUrl` säubert die Adresse, `sbIn` setzt den Nutzer und stößt Sync an, `sbErrTxt` übersetzt Fehler (DE/EN).
  - `detectSessionInUrl:false` – die Rückkehr verarbeitet die App selbst.
  - Kontostatus nur in den Einstellungen, Abschnitt „Cloud-Sync“ (`sbSetHTML`, wird über `sbStatus` aktualisiert): Google-Foto (`avatar_url`, CSP `img-src` erlaubt `lh3.googleusercontent.com`, sonst Anfangsbuchstabe), Name, E-Mail, „Angemeldet mit Google“ (nur wenn die Sitzung wirklich eine Google-Identität hat, `sbIsGoogle`; alte E-Mail-Sitzung: „Noch mit E-Mail angemeldet“ plus Google-Knopf), Sync-Stand, „Abmelden …“ (rot). Nicht mehr im ⋯-Menü.
  - „Abmelden …“ öffnet `sboutHTML` (mit ×): „Abmelden und vom Gerät löschen“ (rot; `sbWipeLocal` löscht `ynab-nachbau-v1`, `sb-snap`, `sb-ts`, `sb-uid`, `base-name`, `ynab-lastacc`, `bk-day` und die IndexedDB `base-backup`, Thema/Sprache bleiben, danach Neuladen), „Nur abmelden“, „Abbrechen“ (Startfokus, zurück zu den Einstellungen). Warnung, wenn noch nicht alles übertragen ist (`sbDirty`). Abmelden nur auf diesem Gerät (`signOut({scope:'local'})`); scheitert es (offline), entfernt `sbDropSession` die Sitzung selbst.
  - **Kontowechsel:** `sb-uid` merkt, zu welchem Konto die Daten auf dem Gerät gehören. Meldet sich ein anderes Konto an, wird nicht synchronisiert, sondern gefragt (`sbswapHTML`): „Übernehmen“ (Gerätedaten kommen ins neue Konto), „Verwerfen …“ (rot, zweite Rückfrage `sbswap2HTML`, dann `sbWipeLocal` und Neuladen), „Abbrechen und abmelden“ (Startfokus, auch bei Escape/Tippen daneben).
  - Alle Fenster (`.mod`) tragen `role="dialog"`, `aria-modal` und `aria-labelledby` (erste Überschrift bekommt `id="mod-h"`).
  - Google-Knopf `gBtn()`: offizielles „G“ (20 px), Farben als Tokens `--gsi-bg/--gsi-edge/--gsi-ink` (hell/dunkel), Schriftgewicht 500, Ladezustand „Google wird geöffnet …“.
  - Bestehende Konten: Supabase verknüpft die Google-Identität automatisch mit dem vorhandenen Nutzer gleicher bestätigter E-Mail, `user_id` bleibt gleich.
  - **Einrichtung in Supabase (einmalig, vor der Auslieferung!)**: Authentication → Sign In / Providers → Google einschalten (Client-ID und -Secret aus der Google Cloud Console, dort als autorisierte Weiterleitungs-URI `https://pcqabzbrorxwjaygmnks.supabase.co/auth/v1/callback`). Authentication → URL Configuration → Redirect URLs: `https://marcokland-web.github.io/umschlag/` eintragen (für lokale Tests zusätzlich z. B. `http://localhost:8765/`). Ohne eingeschalteten Anbieter zeigt Supabase beim Tippen auf den Knopf eine Fehlerseite.
- RLS: jeder sieht nur Zeilen mit `user_id = auth.uid()`.
- Tabellen: `base_settings`, `accounts`, `category_groups`, `categories`, `transactions`, `assignments`, `recurring`.
- Sync-Logik: Funktionen `sbSync`, `sbRows`, `sbBuild`, `sbDiff`, `sbWrite`. Zeilenweiser Diff gegen den zuletzt synchronisierten Stand
  (localStorage `sb-snap`), Konflikte werden zeilenweise zusammengeführt, `rev`/`S.mod` ist der Zeitstempel. Realtime auf `base_settings`.
- Offline funktioniert alles lokal (localStorage `ynab-nachbau-v1`), Sync läuft nach.

## Arbeitsweise / Wünsche des Nutzers (Marco)
- Oberfläche auf Deutsch, kompakt und dicht, Aufbau wie YNAB, Optik nach Studio-Designsystem (Bordeaux/Gold, Systemschrift).
- Hell / Dunkel / Automatisch. iPhone startet direkt in der Schnelleingabe. Keine Sprach- oder Foto-Eingabe (funktionierte nicht).
- Änderungen sollen sofort sichtbar sein: Cache-Busting, Version in `BUILD`, Service Worker no-store für HTML.
- Nach jeder Änderung auf Desktop, iPad (820x1180) und iPhone (390x844) prüfen: Scrollen, Lesbarkeit, keine abgeschnittenen Listen.
- Noch nicht umgesetzt (nur auf Wunsch): Siri/Kurzbefehle, Postfach „Unkategorisiert“, mehr Berichte/CSV-Export, Face-ID/PIN-Sperre.

## Deploy (automatisch)
- Der Ordner ist ein Git-Klon von `github.com/marcokland-web/umschlag` (GitHub Pages: https://marcokland-web.github.io/umschlag/).
- Nach jeder abgeschlossenen und getesteten Neuentwicklung ohne Nachfrage `./deploy.sh "Kurzbeschreibung"` ausführen
  (vorher `BUILD` hochzählen). Das Skript prüft die Syntax, kopiert `ynab.html` nach `index.html`, committet und pusht.
- `index.html` nie direkt bearbeiten – sie wird beim Deploy aus `ynab.html` erzeugt.

## Testen
- Syntaxcheck: Skript aus `<script>` extrahieren und mit `new Function(code)` in Node laden.
- Browser-Tests mit Playwright (Chromium, headless); Testdaten über `S` setzen und `save()` aufrufen.
  Für Touch: Viewport 820x1180 bzw. 390x844 mit `has_touch=True, is_mobile=True`.
- Google-Anmeldung: `NODE_PATH=~/Apps/DasTeam/tools/node_modules node tests/google-anmeldung.test.js` (mit `SHOTS=1` Bildschirmfotos in `tests/shots/`) und `… node tests/google-randfaelle.test.js` (Kontowechsel, offline abmelden, kein Zugang, Ladezustand). Gemeinsame Hilfen in `tests/helpers.js` (SDK-Version wird aus `ynab.html` gelesen). Beide enden bei Fehlern mit Exit≠0.
  Echtes Supabase-SDK, alle Anfragen an `*.supabase.co` werden im Test beantwortet (Host gesperrt), Google wird nie aufgerufen; CSP der App bleibt aktiv (deshalb kein `waitForFunction`, sondern `until()`).
