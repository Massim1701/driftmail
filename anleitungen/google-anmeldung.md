# Google-Anmeldung einrichten (Gmail, Google Workspace)

Stand: 28.09.2026 · Dauer: etwa 20 Minuten · Einmalig, von dir als Herausgeber von driftmail

## Worum es geht

Mit der Google-Anmeldung sehen Nutzer bei Gmail „Weiter mit Google“: Es öffnet sich das Google-Fenster, dort Passwort eingeben, fertig. Wie in Apple Mail, ohne App-Passwort. Der Code dafür ist fertig. Es fehlen nur die Zugangsdaten aus deinem Google-Cloud-Projekt.

Bis dahin funktioniert Gmail in driftmail nur mit **App-Passwort** (siehe [testkonten.md](testkonten.md), Abschnitt Gmail).

## Schritt 1: Projekt anlegen

1. Öffne **https://console.cloud.google.com** und melde dich mit deinem Google-Konto an.
2. Oben auf die Projektauswahl klicken → **Neues Projekt** → Name `driftmail` → **Erstellen**.
3. Sicherstellen, dass oben jetzt `driftmail` ausgewählt ist.

## Schritt 2: Gmail-Schnittstelle einschalten

1. Menü → **APIs & Dienste → Bibliothek**.
2. Nach **Gmail API** suchen → **Aktivieren**.

## Schritt 3: Zustimmungsbildschirm („Google Auth Platform“)

1. Menü → **APIs & Dienste → OAuth-Zustimmungsbildschirm**. Google führt dich dann in die „Google Auth Platform“.
2. **Branding:** App-Name `driftmail`, deine Support-Mailadresse, deine Kontakt-Mailadresse.
3. **Zielgruppe:** **Extern**. Unter **Testnutzer** alle Gmail-Adressen eintragen, die driftmail vorerst benutzen dürfen (höchstens 100), zuerst deine eigene.
4. **Datenzugriff → Bereiche hinzufügen:**
   - `openid`, `…/auth/userinfo.email`, `…/auth/userinfo.profile`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`

   Genau diese Bereiche fragt driftmail an (`backend/src/routes/auth.ts`).

## Schritt 4: Zugangsdaten erstellen

1. **Clients → Client erstellen**, Anwendungstyp **Webanwendung**, Name `driftmail-Server`.
2. **Autorisierte Weiterleitungs-URIs → URI hinzufügen:**
   ```
   http://localhost:3000/v1/auth/google/callback
   ```
   Auch für die iOS-App ist das richtig, denn die Anmeldung läuft über den driftmail-Server.
3. **Erstellen**. Google zeigt die **Client-ID** und den **Clientschlüssel**. Das Fenster offen lassen.

## Schritt 5: Werte in driftmail eintragen

Im Terminal:

```
cd /Volumes/Daten/Dokumente/driftmail/backend
./scripts/google-oauth-einrichten.sh
```

Das Skript fragt nach Client-ID und Clientschlüssel. Der Schlüssel erscheint dabei nicht auf dem Bildschirm. Beide landen in `backend/.env`, und diese Datei wird nie ins Repo übertragen. Danach startet das Skript den Server neu und prüft, ob die Anmeldung bereitsteht. Bitte die Werte **nicht** in den Chat schreiben.

Danach driftmail neu laden: Bei Gmail erscheint „Weiter mit Google“.

## Was im Testbetrieb gilt

- Anmelden können sich nur die eingetragenen **Testnutzer** (höchstens 100).
- Im Testbetrieb läuft die Anmeldung nach **7 Tagen** ab. Dann muss sich der Nutzer neu anmelden. Das ist eine Regel von Google, kein Fehler in driftmail.
- Google zeigt beim Anmelden „Google hat diese App nicht überprüft“. Über „Weiter“ kommen Testnutzer trotzdem durch.

## Für alle Nutzer freischalten (später)

Die Gmail-Bereiche `gmail.readonly` und `gmail.modify` zählen bei Google als **eingeschränkt**. Für die Freigabe an alle braucht es:

1. **Zielgruppe → App veröffentlichen**,
2. die **Überprüfung durch Google**: Datenschutzerklärung und Startseite auf einer eigenen Domain, ein Video, das den Anmeldeablauf zeigt,
3. eine jährliche **Sicherheitsbewertung** durch einen von Google zugelassenen Prüfer. Die ist kostenpflichtig, die Kosten hängen vom Prüfer ab.

Außerdem braucht die iOS-App dann einen öffentlich erreichbaren driftmail-Server. Google leitet nicht auf lokale Adressen zurück.

## Google Workspace (Firmen mit eigener Domain)

- Firmen-Adressen bei Google (z.B. `info@firma.de`) erkennt driftmail am MX-Eintrag und bietet dieselbe Google-Anmeldung an.
- Manche Firmen erlauben nur freigegebene Apps. Dann sieht der Nutzer „Zugriff blockiert“ oder „Administrator muss zustimmen“. Die Firmen-IT gibt driftmail frei unter **admin.google.com → Sicherheit → Zugriffs- und Datenkontrolle → API-Steuerung → App-Zugriff verwalten**, dort nach der Client-ID aus Schritt 4 suchen und auf „Vertrauenswürdig“ stellen.
