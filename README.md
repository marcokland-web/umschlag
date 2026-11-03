# umschlag

B.A.S.E – Budget Aufsetzen, Strategisch Einteilen. Budget-App als Ein-Datei-PWA, live unter https://marcokland-web.github.io/umschlag/.

## Cloud-Sync
Freiwillig, nur mit **„Mit Google anmelden“** (Supabase Auth). Ohne Anmeldung („Ohne Sync weiter“) bleiben alle Daten auf dem Gerät.

Einmalig in Supabase einrichten (Projekt `pcqabzbrorxwjaygmnks`):
1. Authentication → Sign In / Providers → **Google** einschalten (Client-ID/-Secret aus der Google Cloud Console; dort als Weiterleitungs-URI `https://pcqabzbrorxwjaygmnks.supabase.co/auth/v1/callback`).
2. Authentication → URL Configuration → Redirect URLs: `https://marcokland-web.github.io/umschlag/` eintragen.

## Tests
`NODE_PATH=~/Apps/DasTeam/tools/node_modules node tests/google-anmeldung.test.js`
