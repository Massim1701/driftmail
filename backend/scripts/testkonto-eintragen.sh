#!/bin/zsh
# [2026-09-28] Traegt ein Testkonto fuer `npm run test:echt` in backend/.env
# ein (Anleitung: anleitungen/testkonten.md). Das Passwort wird verdeckt
# abgefragt und erscheint weder im Terminal noch im Verlauf. backend/.env
# steht in .gitignore und wird nie committet.
set -e
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
touch "$ENV_FILE"

NR=""
for i in 1 2 3 4 5 6 7 8 9; do
  if ! grep -q "^TEST_KONTO_${i}_ADRESSE=" "$ENV_FILE"; then NR=$i; break; fi
done
[[ -z "$NR" ]] && { echo "Schon 9 Testkonten eingetragen -- bitte eines in backend/.env loeschen."; exit 1; }

echo "Testkonto $NR fuer driftmail eintragen (nur Wegwerf-/Testkonten, nicht das Hauptpostfach)"
read "ADRESSE?Mailadresse: "
read -s "PASSWORT?App-Passwort (wird nicht angezeigt): "
echo
read "ANMELDENAME?Anmeldename, falls nicht die Mailadresse (sonst Enter): "
[[ -z "$ADRESSE" || -z "$PASSWORT" ]] && { echo "Abgebrochen: Adresse und Passwort sind noetig."; exit 1; }
[[ "$PASSWORT" == *"'"* ]] && { echo "Abgebrochen: Passwoerter mit ' bitte von Hand in backend/.env eintragen."; exit 1; }

{
  echo "TEST_KONTO_${NR}_ADRESSE=$ADRESSE"
  # In einfachen Anfuehrungszeichen: # und Leerzeichen bleiben Teil des Werts.
  echo "TEST_KONTO_${NR}_PASSWORT='$PASSWORT'"
  [[ -n "$ANMELDENAME" ]] && echo "TEST_KONTO_${NR}_ANMELDENAME=$ANMELDENAME"
} >> "$ENV_FILE"
echo "Eingetragen als TEST_KONTO_${NR}. Testen mit: cd backend && npm run test:echt"
