# Microsoft-Anmeldung einrichten (Outlook.com, Hotmail, Microsoft 365)

Stand: 28.09.2026 · Dauer: etwa 20 Minuten · Einmalig, von dir als Herausgeber von driftmail

## Warum das nötig ist

Microsoft lässt fremde Mail-Apps nicht mehr mit Passwort an die Postfächer:

- **Outlook.com, Hotmail, Live, MSN (private Konten):** Passwort-Anmeldung über IMAP, POP und SMTP ist seit dem 16.09.2024 abgeschaltet. Es geht nur noch über die Microsoft-Anmeldung (OAuth).
- **Microsoft 365 / Exchange Online (Firmen):** IMAP und POP mit Passwort sind schon lange aus. Beim Versand (SMTP) ist die Passwort-Anmeldung bis Ende Dezember 2026 noch möglich. Danach ist sie in bestehenden Firmen standardmäßig aus, Admins können sie aber vorerst wieder einschalten. Das endgültige Aus kündigt Microsoft für die zweite Hälfte 2027 an.

driftmail braucht also eine eigene „App-Registrierung“ bei Microsoft. Danach sehen Nutzer das gewohnte Microsoft-Anmeldefenster, genau wie in Apple Mail oder Thunderbird.

> **Wichtig:** Den Code für die Microsoft-Anmeldung baue ich erst noch. Die Registrierung kannst du trotzdem jetzt schon machen. Das Skript am Ende speichert die Werte, und sie werden benutzt, sobald der Code fertig ist.

## Schritt 1: Anmelden

1. Öffne **https://entra.microsoft.com** (Microsoft Entra Admin Center).
2. Melde dich mit deinem Microsoft-Konto an. Hast du noch kein Verzeichnis, bietet Microsoft an, eines anzulegen. Manchmal geht das nur über ein kostenloses Azure-Konto. Die App-Registrierung selbst kostet nichts.

## Schritt 2: App registrieren

1. Links: **Identität → Anwendungen → App-Registrierungen → Neue Registrierung**.
2. **Name:** `driftmail`
3. **Unterstützte Kontotypen:** die dritte Option wählen:
   *„Konten in allen Organisationsverzeichnissen (beliebiger Microsoft Entra ID-Mandant – mehrinstanzenfähig) und persönliche Microsoft-Konten“*.
   Nur so funktionieren private Outlook-Konten **und** Firmenkonten.
4. **Umleitungs-URI:** Plattform **Web**, Adresse:
   ```
   http://localhost:3000/v1/auth/microsoft/callback
   ```
   Sobald driftmail öffentlich läuft, kommt hier zusätzlich die öffentliche Adresse dazu.
5. **Registrieren** klicken.
6. Auf der Übersichtsseite die **Anwendungs-ID (Client-ID)** kopieren. Die brauchst du in Schritt 5.

## Schritt 3: Geheimen Schlüssel anlegen

1. In der App links: **Zertifikate & Geheimnisse → Geheime Clientschlüssel → Neuer geheimer Clientschlüssel**.
2. Beschreibung `driftmail-Server`, Ablauf **24 Monate** (die längste Option).
3. Sofort die Spalte **Wert** kopieren. Microsoft zeigt sie nur dieses eine Mal. Nicht die „Geheimnis-ID“ nehmen, die ist etwas anderes.
4. **Das Ablaufdatum in den Kalender eintragen.** Ist der Schlüssel abgelaufen, funktioniert die Anmeldung für alle Nutzer nicht mehr. Dann einfach einen neuen anlegen und Schritt 5 wiederholen.

## Schritt 4: Berechtigungen eintragen

1. Links: **API-Berechtigungen → Berechtigung hinzufügen → Microsoft Graph → Delegierte Berechtigungen**.
   Auswählen: `openid`, `email`, `profile`, `offline_access`. „Berechtigungen hinzufügen“ klicken.
2. Noch einmal **Berechtigung hinzufügen → Von meiner Organisation verwendete APIs**, nach **Office 365 Exchange Online** suchen, **Delegierte Berechtigungen**:
   `IMAP.AccessAsUser.All` und `SMTP.Send`.
   Findest du „Office 365 Exchange Online“ nicht, ist das kein Problem. driftmail fragt diese beiden Rechte beim Anmelden ohnehin selbst an. Eingetragen sieht die Firmen-IT aber vorab, was die App möchte.
3. **Nicht** „Administratorzustimmung erteilen“ klicken. Das gilt nur für dein eigenes Verzeichnis und ist für driftmail nicht nötig.

## Schritt 5: Werte in driftmail eintragen

Im Terminal:

```
cd /Volumes/Daten/Dokumente/driftmail/backend
./scripts/microsoft-oauth-einrichten.sh
```

Das Skript fragt nach der Anwendungs-ID und dem Schlüssel-Wert. Der Schlüssel erscheint dabei nicht auf dem Bildschirm. Beide landen in `backend/.env`, und diese Datei wird nie ins Repo übertragen. Bitte die Werte **nicht** in den Chat schreiben.

## Schritt 6 (später, für Firmenkunden): Herausgeber bestätigen

Viele Firmen erlauben ihren Mitarbeitern nur Apps von **bestätigten Herausgebern**. Ohne diese Bestätigung sehen Firmennutzer beim Anmelden „Administratorgenehmigung erforderlich“. Private Outlook-Konten betrifft das nicht.

- Voraussetzung: kostenlose Mitgliedschaft im **Microsoft AI Cloud Partner Program** (früher „Microsoft Partner Network“). Das ergibt eine Partner-ID.
- Danach in der App-Registrierung unter **Branding und Eigenschaften → Herausgeberdomäne** deine Domain bestätigen und die Partner-ID eintragen.
- Das kannst du nachholen, wenn die ersten Firmenkunden kommen.

## Was Firmen-Admins tun müssen (zum Weitergeben)

Meldet ein Firmennutzer „Administratorgenehmigung erforderlich“ oder „App durch die IT gesperrt“, braucht es seine IT:

1. **Zustimmung für die ganze Firma** über diesen Link (die Anwendungs-ID aus Schritt 2 einsetzen):
   ```
   https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=ANWENDUNGS-ID&scope=https://outlook.office.com/IMAP.AccessAsUser.All%20https://outlook.office.com/SMTP.Send&redirect_uri=http://localhost:3000/v1/auth/microsoft/callback
   ```
2. **IMAP und authentifiziertes SMTP fürs Postfach erlaubt:** Exchange Admin Center → Empfänger → Postfächer → Postfach → **E-Mail-Apps verwalten**: „IMAP“ und „Authentifiziertes SMTP“ einschalten. In vielen Firmen ist SMTP standardmäßig aus, dann kann driftmail zwar lesen, aber nicht senden.
3. **Exchange im eigenen Haus (on-premise):** Das geht nur, wenn der Admin dort IMAP freigegeben hat. Dann funktioniert es wie ein normaler Firmenserver. Die Microsoft-Anmeldung aus dieser Anleitung gilt nur für Exchange Online.

## Quellen

- Microsoft: [IMAP, POP und SMTP mit OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth). Dort stehen die Rechte `IMAP.AccessAsUser.All` und `SMTP.Send` sowie das Anmeldeverfahren XOAUTH2.
- Microsoft: [Outlook.com und Apps mit Passwort-Anmeldung](https://support.microsoft.com/en-US/Support/known-issues/outlook-and-other-apps-are-unable-to-connect-to-outlook-com-when-using-basic-authentication)
- Microsoft Tech Community: [neuer Zeitplan SMTP AUTH (Januar 2026)](https://techcommunity.microsoft.com/blog/exchange/updated-exchange-online-smtp-auth-basic-authentication-deprecation-timeline/4489835)
