# Testkonten für den Anbieter-Test

Stand: 28.09.2026 · Dauer: etwa 10 Minuten pro Konto

## Worum es geht

driftmail hat einen Test, der sich mit **echten** Mailkonten verbindet und alles einmal durchspielt, was die App mit einem Postfach macht. So sehen wir, ob die Anbindung bei GMX, web.de, iCloud, Gmail und Firmenservern wirklich funktioniert, und bemerken es sofort, wenn eine Änderung später etwas kaputt macht.

Pro Konto prüft der Test:

| Schritt | Was passiert |
|---|---|
| Einstellungen | Server so finden wie die App: Anbieterliste, sonst automatische Erkennung |
| Verbinden | Anmeldung, mit automatischem Ausprobieren bei Abweichungen |
| Abruf | die letzten 5 Mails aus dem Posteingang lesen |
| Senden | **eine Testmail an sich selbst** schicken |
| Gesendet-Ordner | liegt die Kopie im Gesendet-Ordner des Anbieters? |
| Eingang | kommt die Testmail an (bis zu 90 Sekunden)? |
| Papierkorb | Testmail in den Papierkorb des Anbieters und dann endgültig löschen |

Der Test liest nur und löscht nur seine eigene Testmail. Die Kopie im Gesendet-Ordner bleibt liegen.

## Bitte beachten

- **Nur Wegwerf- oder Testkonten, nicht dein Hauptpostfach.** Die Zugangsdaten liegen unverschlüsselt in `backend/.env` auf deinem Mac.
- `backend/.env` wird **nie** ins Repo übertragen (steht in `.gitignore`).
- Zugangsdaten **nicht** in den Chat, in `SYNC.md` oder in die Inbox-Dateien schreiben. Das Eintrage-Skript fragt sie verdeckt ab.
- Wo der Anbieter App-Passwörter kennt, immer ein **App-Passwort** nehmen. Das lässt sich jederzeit einzeln widerrufen.

## Schritt 1: Konto vorbereiten

| Anbieter | Was vorher zu tun ist |
|---|---|
| **GMX** | Einstellungen → **POP3/IMAP Abruf** → Zugriff über IMAP erlauben. Bei Zwei-Faktor-Schutz ein App-Passwort anlegen, sonst das normale Passwort. |
| **web.de** | Einstellungen → **POP3/IMAP Abruf** → Zugriff erlauben. Dann das normale web.de-Passwort. |
| **iCloud** | Auf account.apple.com unter **Anmelden und Sicherheit → App-spezifische Passwörter** eines erstellen ([Hilfe](https://support.apple.com/en-us/102654)). |
| **Gmail** | Im Google-Konto die **Bestätigung in zwei Schritten** einschalten, dann unter **App-Passwörter** eines erstellen ([Hilfe](https://support.google.com/accounts/answer/185833)). Das normale Google-Passwort funktioniert nicht. |
| **Yahoo** | Kontoeinstellungen → **Kontosicherheit → App-Passwort generieren** ([Hilfe](https://help.yahoo.com/kb/SLN15241.html)). |
| **Outlook / Hotmail** | Geht noch nicht: braucht die Microsoft-Anmeldung ([microsoft-anmeldung.md](microsoft-anmeldung.md)). Der Test zeigt es als „noch nicht unterstützt“. |
| **Firmenserver / eigene Domain** | Mailadresse und Passwort vom Admin. Ist der Anmeldename nicht die Mailadresse (z.B. `max.mustermann` oder `FIRMA\max`), diesen beim Eintragen angeben. |

Am aussagekräftigsten ist je ein Konto bei **GMX, web.de, iCloud, Gmail** und, falls vorhanden, ein **Firmen- oder Hosting-Postfach** mit eigener Domain.

## Schritt 2: Konto eintragen

Im Terminal, einmal pro Konto:

```
cd /Volumes/Daten/Dokumente/driftmail/backend
./scripts/testkonto-eintragen.sh
```

Das Skript fragt nach:
1. **Mailadresse**
2. **App-Passwort** (erscheint nicht auf dem Bildschirm)
3. **Anmeldename**, nur wenn er nicht die Mailadresse ist, sonst einfach Enter

Es legt die Einträge `TEST_KONTO_1_…` bis `TEST_KONTO_9_…` in `backend/.env` an. Von Hand geht es auch:

```
TEST_KONTO_1_ADRESSE=test@gmx.de
TEST_KONTO_1_PASSWORT='das-app-passwort'
TEST_KONTO_1_ANMELDENAME=        (optional)
```

## Schritt 3: Test starten

```
cd /Volumes/Daten/Dokumente/driftmail/backend
npm run test:echt
```

Am Ende steht eine Tabelle, etwa so:

```
| Konto      | Einstellungen         | Verbinden | Abruf | Senden | Gesendet-Ordner | Eingang | Papierkorb | Hinweis |
| te…@gmx.de | Anbieterliste (gmx)   | ok        | ok    | ok     | ok              | ok      | ok         | 5 Mails abgerufen |
```

Die Mailadressen sind darin gekürzt, Passwörter erscheinen nie. Du kannst mir die Tabelle einfach in den Chat kopieren, oder du sagst „teste die Konten“, dann starte ich den Test selbst und trage das Ergebnis in `SYNC.md` ein.

## Häufige Meldungen

| Meldung | Bedeutung / Lösung |
|---|---|
| `Authentication failed` / `Invalid credentials` | Passwort falsch, oder der Anbieter verlangt ein App-Passwort. Bei GMX/web.de: IMAP-Abruf in den Einstellungen erlauben. |
| `Servereinstellungen nicht gefunden` | Die Domain ist unbekannt und die Erkennung findet nichts. Dann bitte Servername und Port nennen, ich trage sie ein. |
| `Eingang: fehler` mit „Spamfilter?“ | Die Testmail ist nicht im Posteingang angekommen, oft liegt sie im Spam-Ordner. Kein Fehler in driftmail. |
| `kein Papierkorb-Ordner erkannt` | Der Server nennt seinen Papierkorb ungewöhnlich. Bitte den Ordnernamen nennen. |

## Konto wieder entfernen

Die Zeilen `TEST_KONTO_…` aus `backend/.env` löschen und beim Anbieter das App-Passwort widerrufen.
