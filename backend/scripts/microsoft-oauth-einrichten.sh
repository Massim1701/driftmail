#!/bin/zsh
# [2026-09-28] Traegt die Microsoft-Zugangsdaten (Anwendungs-ID und
# geheimen Clientschluessel aus dem Microsoft Entra Admin Center) in
# backend/.env ein. Anleitung: anleitungen/microsoft-anmeldung.md.
# Eingaben erscheinen nicht im Terminal-Verlauf.
# HINWEIS: Der Code fuer die Microsoft-Anmeldung in driftmail wird erst
# noch gebaut -- bis dahin werden die Werte nur gespeichert.
set -e
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
REDIRECT="http://localhost:3000/v1/auth/microsoft/callback"
touch "$ENV_FILE"

echo "Microsoft-Anmeldung fuer driftmail einrichten"
echo "Umleitungs-URI im Entra Admin Center (Plattform \"Web\"): $REDIRECT"
echo
read "CLIENT_ID?Anwendungs-ID (Client-ID): "
read -s "CLIENT_SECRET?Geheimer Clientschluessel, Spalte \"Wert\" (wird nicht angezeigt): "
echo
[[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]] && { echo "Abgebrochen: beide Werte sind noetig."; exit 1; }

set_var() {
  if grep -q "^$1=" "$ENV_FILE"; then
    sed -i '' "s|^$1=.*|$1=$2|" "$ENV_FILE"
  else
    echo "$1=$2" >> "$ENV_FILE"
  fi
}
set_var MICROSOFT_CLIENT_ID "$CLIENT_ID"
set_var MICROSOFT_CLIENT_SECRET "$CLIENT_SECRET"
set_var MICROSOFT_OAUTH_REDIRECT_URI "$REDIRECT"
echo "Gespeichert. Die Werte werden genutzt, sobald die Microsoft-Anmeldung in driftmail eingebaut ist."
echo "Ablaufdatum des Clientschluessels in den Kalender eintragen (Microsoft: hoechstens 24 Monate)."
