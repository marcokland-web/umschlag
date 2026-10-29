# B.A.S.E – Budget Aufsetzen, Strategisch Einteilen

Exakter YNAB-Nachbau als Ein-Datei-PWA (Desktop, iPad, iPhone), Deutsch mit Englisch-Umschalter.
Veröffentlicht über GitHub Pages; die Hauptdatei muss im Repo `ynab.html` heißen.

## Dateien
- `ynab.html` – die komplette App (HTML, CSS, JS inline, ca. 240 KB). Hier passiert fast alles.
- `ynab-sw.js` – Service Worker (Cache `base-v4`, HTML immer netzfrisch, `*.supabase.co` wird nicht gecacht).
- `ynab-manifest.json` – PWA-Manifest (`id`/`start_url` `./`, `lang` de). Icons aus DasTeam `studio/brand/base*.svg`: `ynab-icon-180.png` (Apple), `ynab-icon-192/512.png`, `ynab-maskable-512.png`, `ynab-favicon-32.png`, `ynab-icon.svg`, `base-logo-512.png`.
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
- URL `https://pcqabzbrorxwjaygmnks.supabase.co`, Publishable Key im Code (`SB_URL`, `SB_KEY`), SDK per jsDelivr geladen.
- Login per E-Mail + Passwort (Supabase Auth). RLS: jeder sieht nur Zeilen mit `user_id = auth.uid()`.
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
- Browser-Tests mit Playwright (Chromium, headless) gegen `file:///.../ynab.html`; Testdaten über `S` setzen und `save()` aufrufen.
  Für Touch: Viewport 820x1180 bzw. 390x844 mit `has_touch=True, is_mobile=True`. Supabase im Test durch ein Fake-`window.supabase` ersetzen.
