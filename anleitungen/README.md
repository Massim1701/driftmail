# Anleitungen

Schritt-für-Schritt-Anleitungen für alles, was einmalig außerhalb des Codes eingerichtet werden muss.

| Anleitung | Wofür | Skript |
|---|---|---|
| [Google-Anmeldung](google-anmeldung.md) | „Weiter mit Google“ für Gmail und Google Workspace statt App-Passwort | `backend/scripts/google-oauth-einrichten.sh` |
| [Microsoft-Anmeldung](microsoft-anmeldung.md) | Outlook.com, Hotmail und Microsoft 365. Ohne sie gehen diese Konten gar nicht. | `backend/scripts/microsoft-oauth-einrichten.sh` |
| [Testkonten](testkonten.md) | Echte Konten für den automatischen Anbieter-Test (`npm run test:echt`) | `backend/scripts/testkonto-eintragen.sh` |

Alle Skripte fragen geheime Werte verdeckt ab und schreiben sie nur in `backend/.env`. Diese Datei wird nie ins Repo übertragen.
