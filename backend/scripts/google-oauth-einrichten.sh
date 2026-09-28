#!/bin/zsh
# [2026-09-28] Traegt die Google-OAuth-Zugangsdaten (Client-ID/-Secret aus
# der Google Cloud Console) in backend/.env ein und startet den lokalen
# Server neu. Danach bietet driftmail fuer Gmail "Weiter mit Google" an --
# gleiche Anmeldung wie in Apple Mail (Google-Anmeldefenster statt
# Passwort in der App). Eingaben erscheinen nicht im Terminal-Verlauf.
set -e
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
REDIRECT="http://localhost:3000/v1/auth/google/callback"

echo "Google-Anmeldung fuer driftmail einrichten"
echo "Weiterleitungs-URI in der Google Cloud Console: $REDIRECT"
echo
read "CLIENT_ID?Client-ID: "
read -s "CLIENT_SECRET?Client-Secret (wird nicht angezeigt): "
echo
[[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]] && { echo "Abgebrochen: beide Werte sind noetig."; exit 1; }

set_var() {
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i '' "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    echo "$1=$2" >> "$ENV_FILE"
  fi
}
set_var GMAIL_CLIENT_ID "$CLIENT_ID"
set_var GMAIL_CLIENT_SECRET "$CLIENT_SECRET"
set_var GOOGLE_OAUTH_REDIRECT_URI "$REDIRECT"
set_var FRONTEND_URL "http://localhost:3000"

launchctl kickstart -k "gui/$(id -u)/online.driftware.driftmail.backend"
sleep 8
if curl -s localhost:3000/v1/mail-providers | grep -q '"id":"gmail"[^}]*"oauthAvailable":true'; then
  echo "Fertig: driftmail neu laden, dann erscheint bei Gmail \"Weiter mit Google\"."
else
  echo "Server laeuft, meldet Google-Anmeldung aber noch nicht als eingerichtet -- Log: ~/Library/Logs/driftmail/backend.log"
fi
