# driftmail-backend (Track A)

Erster Durchstich der Backend-API gegen `contracts/api-spec.yaml` und
`contracts/db-schema.sql`. Zeigt den Kernfluss end-to-end:

> **Contract-Update (2026-09-08, SYNC.md Commit `734781e`):** der feste
> Folder-Enum (`wichtig`/`sonstiges`/`rechnungen`/`quarantaene`/`spam` als
> String auf `messages.folder`) wurde durch benutzerdefinierte Ordner
> ersetzt (neue Tabelle `folders`, `messages.folder_id` als FK). Details
> siehe Abschnitt "Ordner (benutzerdefiniert)" unten.

> **Contract-Update (2026-09-08, WEB_INBOX.md "Neue Spam-Unterkategorie"):**
> `message_security.spam_subcategory` (`adult`/`gambling`/`generic`/`marketing`,
> nur gesetzt bei `classification = 'spam'`) hinzugekommen. `adult`/`gambling`
> lösen einen neuen Auto-Delete-Pfad aus (siehe Abschnitt
> "Auto-Delete: adult/gambling-Spam" unten), `generic`/`marketing` verhalten
> sich wie bisheriger Spam. `phishing` ist von dieser Regel unberührt.

> **Contract-Update (2026-09-08, WEB_INBOX.md "Botnetz-Erkennungssignale"):**
> `SecurityResult` um `ipReputationFlag`/`heloMismatch`/`imageToTextRatio`
> ergänzt (Commit `5bb9531`). `ipReputationFlag` wird seit dem
> Lookup-Adapter-Schritt unten (siehe "Externe Lookup-Adapter") befüllt,
> `heloMismatch`/`imageToTextRatio` bleiben einfache Platzhalterwerte
> (`false`/`null`) — echte Erkennung baut Track B.

> **Contract-Update (2026-09-08, WEB_INBOX.md "Ausgehender Phishing-Check im
> Composer" + Erweiterung, Commit `b6b3eb2`):** neuer Endpoint `POST
> /messages/draft/phishing-check` hinzugekommen. Siehe Abschnitt
> "Ausgehender Phishing-Check (Composer)" unten.

> **Integration (2026-09-09, WEB_INBOX.md "Track A + Track B
> Integration"):** `analyzeMail()` und `checkDraftForPhishing()` rufen
> jetzt die echte Logik aus `@driftmail/security-classification` (Track B)
> auf statt der vorherigen Mock-Implementierungen. Details siehe "Was ist
> echt, was ist Mock/Stub" und "Ausgehender Phishing-Check (Composer)"
> unten.

> **Contract-Update (2026-09-08, WEB_INBOX.md "Fehlende Basis-Funktion
> entdeckt", Commit `156f0fd`):** manuelles Löschen einer Mail gab es bisher
> nicht (nur Quarantäne, Verschieben, Auto-Delete-Regeln). Neuer
> System-Ordner `papierkorb` (6. System-Ordner) + `DELETE
> /messages/{messageId}` (soft delete) + `DELETE
> /messages/{messageId}/permanent` (endgültig löschen). Details siehe
> Abschnitt "Papierkorb / Löschen" unten.

> **Architekturentscheidung (2026-09-08, SYNC.md, Web-Antwort auf die vier
> "wer macht den externen Lookup"-Fragen):** `security-classification/`
> (Track B) bleibt bewusst zustandslos (kein Netzwerk, keine DB). Track A
> macht `senderDomainAgeDays`/`domainReputationScore`, `ipReputationFlag`,
> `containsNewIban` (nach `analyzeMail()`) und `recipientReputation` (nach
> `checkDraftForPhishing()`) als eigenen Nachbearbeitungsschritt über
> austauschbare Lookup-Adapter. Details siehe Abschnitt "Externe
> Lookup-Adapter" unten.

> **Echte Persistenz (2026-09-09, Web-Priorisierung "Persistenz zuerst",
> siehe SYNC.md/TERMINAL_INBOX.md):** der bisherige In-Memory-Store ist
> durch eine echte Postgres-Anbindung ersetzbar (`DATABASE_URL` setzen),
> mit dem bisherigen In-Memory-Verhalten als Zero-Config-Fallback ohne
> DB-Setup. Details siehe Abschnitt "Persistenz" unten.

```
Mail-Adapter (Gmail/IMAP/Fixture) -> Sync-Pipeline -> Track-B-Klassifikation
  -> externe Lookup-Adapter (Domain-/IP-Reputation, IBAN-Historie)
  -> Ordner-Zuordnung + ggf. Auto-Quarantäne (phishing) / Auto-Delete
     (adult/gambling-Spam) -> Postgres oder In-Memory (siehe "Persistenz")
     -> API (GET/POST wie im Contract)
```

Node/TypeScript + Express. Kein produktionsreifer Code, sondern ein
startbares, testbares Skeleton für den ersten Track-übergreifenden
Durchstich.

## Starten

Seit der Track-A+Track-B-Integration (09.09.) hängt `backend/` per
`file:../security-classification`-Dependency von Track B ab. Dessen
`dist/` muss vor `npm install` hier einmal gebaut sein (nicht Teil dieses
Builds, da separates npm-Package):

```bash
cd ../security-classification && npm install && npm run build && cd -
npm install
npm run dev        # tsx watch, http://localhost:3000
# oder:
npm run build && npm start
```

Ohne weitere Konfiguration läuft das mit In-Memory-Persistenz (Daten gehen
bei jedem Neustart verloren). Für echte Postgres-Persistenz `DATABASE_URL`
setzen -- siehe Abschnitt "Persistenz" unten für Details, Kurzfassung:

```bash
createdb driftmail_dev   # einmalig, braucht einen laufenden Postgres-Server
DATABASE_URL="postgresql://<user>@localhost:5432/driftmail_dev" npm run dev
```

Ohne jede Konfiguration synct der Server beim Start automatisch ein
Demo-Konto gegen den **Fixture-Mail-Adapter** (6 Beispiel-Mails: normale
Vertragsmail, Phishing-Versuch [Auth-Fail + IBAN], Spam-Newsletter
[marketing, SPF-Fail], private Mail, Glücksspiel-Spam [wird sofort
automatisch gelöscht, siehe unten], Homoglyph-Phishing [Apple-ID-Betrug
mit kyrillischem Domain-Zeichen]) und läuft sofort end-to-end durch — kein
Postgres, kein Google/IMAP-Setup nötig.

- API-Basis (Contract, `servers[0].url` in `api-spec.yaml` ist
  `/v1`-relativ): `http://localhost:3000/v1`
- Health-Check: `GET http://localhost:3000/health`
- Manuellen Sync erneut anstoßen: `POST http://localhost:3000/internal/sync`

## Testen

```bash
npm test
```

Das ist ein End-to-End-Smoketest ohne Testframework
(`src/smoketest.ts`): startet die App in-process, synct das Fixture-Konto
und durchläuft den kompletten Kernfluss über echte HTTP-Requests —
`/v1/accounts`, `/v1/folders` (GET/POST/PATCH/DELETE, inkl. Ablehnung von
Umbenennung/Löschung bei System-Ordnern, inkl. `papierkorb`),
`/v1/messages` (inkl. `folderId`-Filter), `/v1/messages/:id`,
`/v1/messages/:id/move`, `/v1/messages/:id/summary`,
`/v1/messages/:id/reply-draft`, `/v1/messages/:id/quarantine`,
`/v1/messages/:id` (DELETE, soft delete in den Papierkorb),
`/v1/messages/:id/permanent` (DELETE, endgültiges Löschen — inkl. Ablehnung
außerhalb des Papierkorbs), `/v1/contracts`, `/v1/contracts/:id/confirm`,
`/v1/capability-check`. Bricht mit
Fehlermeldung ab, sobald eine Response nicht zum erwarteten Contract-Format
passt. Prüft zusätzlich direkt gegen `store` (kein HTTP-Endpunkt dafür,
siehe oben): den Auto-Delete-Pfad (adult/gambling-Spam-Fixture wird nicht
persistiert, hinterlässt genau einen `security_audit_log`-Eintrag, ein
zweiter Sync-Lauf dedupliziert korrekt und erzeugt keinen weiteren
Eintrag).

Manuell durchprobieren z.B. mit:

```bash
curl http://localhost:3000/v1/folders | jq
curl http://localhost:3000/v1/messages | jq
# folderId eines Ordners aus obigem GET /v1/folders einsetzen:
curl "http://localhost:3000/v1/messages?folderId=<uuid>" | jq
curl -X POST http://localhost:3000/v1/capability-check \
  -H 'Content-Type: application/json' \
  -d '{"platform":"web","onDeviceSupported":false,"activeMode":"cloud_fallback"}'
```

## Was ist echt, was ist Mock/Stub

**Echt implementiert:**
- Express-API 1:1 gegen `contracts/api-spec.yaml` (alle Pfade, unter `/v1`
  gemountet, camelCase-Response-Shapes wie in der Spec).
- Gmail-Adapter (`src/mail/gmailAdapter.ts`, via `googleapis`) — echte
  Gmail-API-Calls, wenn `GMAIL_CLIENT_ID`/`_SECRET`/`_REFRESH_TOKEN` in der
  Umgebung gesetzt sind.
- IMAP-Adapter (`src/mail/imapAdapter.ts`, via `imapflow` + `mailparser`)
  — echte IMAP-Verbindung, wenn `IMAP_HOST`/`_USER`/`_PASSWORD` gesetzt
  sind.
- **`MessageDetail.quarantine`** (integriert 09.09., WEB_INBOX.md 08.09.
  "Track F"-Frage + `contracts/api-spec.yaml` `QuarantineInfo`, Terminal
  09.09.): `GET /messages/{messageId}` liefert jetzt `reason`/
  `autoDeleteAt`/`userReviewed` aus der `quarantine`-Tabelle
  (`store.getQuarantineForMessage()`), `null` wenn die Nachricht nicht in
  Quarantäne ist — vorher existierte nur das Contract-Schema, ohne dass das
  Backend es befüllt hätte.
- Sync-Pipeline (`src/mail/sync.ts`): Dedupe über
  `(mail_account_id, message_id_header)` wie im Schema (`UNIQUE`-Constraint
  auf `messages`), Ordner-Zuordnung, Auto-Quarantäne bei
  `classification === "phishing"`, Auto-Delete bei `classification ===
  "spam"` + `spamSubcategory` `adult`/`gambling` (siehe eigener Abschnitt
  unten).
- Ordner-Verwaltung (`src/routes/folders.ts`): System-Ordner + eigene
  Ordner, siehe Abschnitt "Ordner (benutzerdefiniert)" unten.
- **Sicherheits-Klassifikation** (`src/ai/mockAdapter.ts` ->
  `analyzeMail()`, integriert 09.09.): ruft seit der Track-A+Track-B-
  Integration die ECHTE Logik aus `@driftmail/security-classification`
  (Track B, als `file:`-Dependency eingebunden, siehe `package.json`) auf
  — SPF/DKIM/DMARC-Parsing, Homoglyph-Erkennung, Link-Mismatch,
  Dringlichkeitssprache, Mod-97-validierte IBAN-Erkennung,
  Spam-Unterkategorie. Nicht mehr Mock. `senderDomainAgeDays`/
  `domainReputationScore` bleiben weiterhin `null` aus diesem Modul (siehe
  security-classification/README.md) und werden wie bisher von den
  externen Lookup-Adaptern unten nachbefüllt.
- **Ausgehender Phishing-Check** (`src/routes/messages.ts`, integriert
  09.09.): `POST /messages/draft/phishing-check` ruft die echte
  `checkDraftForPhishing()` aus `@driftmail/security-classification` auf
  (Homoglyph-Domains, Luhn-validierte Kreditkarten, Mod-97-validierte
  IBANs) statt der vorherigen `draftPhishingCheckMock.ts` (gelöscht).
  `recipientReputation` bleibt weiterhin ein eigener
  Nachbearbeitungsschritt (siehe "Externe Lookup-Adapter" unten), da das
  Track-B-Modul dafür bewusst zustandslos ist.
- **Fixture-Mail-Adapter** (`src/mail/fixtureAdapter.ts`): Standardpfad
  ohne echte Zugangsdaten, damit das Skeleton ohne Setup läuft und
  testbar ist (siehe "Annahmen" unten).
- **Persistenz** (integriert 09.09., siehe eigener Abschnitt "Persistenz"
  unten): echte Postgres-Anbindung (`src/db/postgresStore.ts`), wenn
  `DATABASE_URL` gesetzt ist. Ohne `DATABASE_URL` weiterhin der
  ursprüngliche In-Memory-Store (`src/db/store.ts`, `InMemoryStore`) als
  Zero-Config-Fallback — Daten gehen dann bei jedem Neustart verloren,
  aber kein DB-Setup nötig, exakt dasselbe Muster wie beim Gmail-/IMAP-
  Adapter (echt, wenn ENV gesetzt ist, sonst Fixture).
- **Auth**: keine — kein Login/Session/Token-Handling in diesem
  Durchstich, ein fester "Demo-User" wird beim Start angelegt.
- **Extraktion/Zusammenfassung/Antwortentwurf** (`src/ai/mockAdapter.ts` ->
  `extractContract()`/`summarize()`/`draftReply()`): weiterhin simple
  Keyword-Heuristiken/Platzhalter — anders als `analyzeMail()` (s.o.) noch
  NICHT gegen echte Track-D/Track-E-Logik integriert, das ist ein
  separater, noch offener Schritt.
- **Externe Lookup-Adapter** (`src/lookups/`): Domain-/IP-Reputation,
  IBAN-Historie und Empfänger-Reputation sind Mock-Implementierungen mit
  plausiblen, deterministischen Beispieldaten bzw. (IBAN-Historie,
  Empfänger-Reputation) einer echten Prüfung gegen den bestehenden
  In-Memory-Store — kein echter WHOIS-/Spamhaus-/Fraud-Datenbank-Zugriff.
  Siehe eigener Abschnitt "Externe Lookup-Adapter" unten.
- **Papierkorb / Löschen inkl. Provider-Spiegelung** (integriert 09.09.,
  `src/routes/messages.ts`, `DELETE /messages/{messageId}` + `DELETE
  /messages/{messageId}/permanent`): lokales Verschieben/Entfernen im
  Store UND die Spiegelung beim Provider (Gmail API
  `messages.trash`/`messages.delete`, IMAP `\Deleted`-Flag/`EXPUNGE`) sind
  jetzt implementiert (`src/mail/gmailAdapter.ts`/`imapAdapter.ts`,
  `MailAdapter.trashMessage()`/`permanentlyDeleteMessage()`). Wie bei
  Gmail/IMAP-Fetch nur mit echten Zugangsdaten (Env-Variablen) end-to-end
  testbar — der Smoketest läuft gegen den Fixture-Adapter, dort ist die
  Spiegelung ein dokumentiertes No-Op. Siehe eigener Abschnitt "Papierkorb
  / Löschen" unten.
- **Versand** (neu, `POST /messages/send`, `src/routes/messages.ts` +
  `MailAdapter.sendMail()`): echter Versand über Gmail-API bzw. SMTP
  (`nodemailer`, IMAP-Konten), inkl. serverseitigem Phishing-Check davor und
  `outgoing_send_log`-Eintrag danach. Wie bei Gmail/IMAP-Fetch nur mit
  echten Zugangsdaten end-to-end testbar — der Smoketest läuft gegen den
  Fixture-Adapter (simulierter Erfolg, kein echtes Postfach). Siehe eigener
  Abschnitt "Versand" unten für Grenzen (Link-Extraktion aus reinem Text,
  SMTP-Host-Fallback bei generischem IMAP).
- **Anhang-Upload/Scan** (neu, `POST /attachments`, `src/routes/
  attachments.ts` + `AttachmentScanner`): echte Dateityp-/Endungsprüfung
  (`attachmentScanMock.ts`), kein echter Virenscan-Dienst — Mock, analog zu
  den externen Lookup-Adaptern. Dateiinhalt wird nicht gespeichert (keine
  `content`-Spalte im Contract), deshalb wird ein geprüfter Anhang aktuell
  auch nicht tatsächlich in die ausgehende Mail eingebettet. Siehe eigener
  Abschnitt "Anhänge" unten.
- **Entwürfe** (neu, `GET`/`POST /drafts`, `PATCH`/`DELETE
  /drafts/{draftId}`, `src/routes/drafts.ts`): echte CRUD-Persistenz
  (eigene `drafts`-Tabelle), Endpunkte selbst sind Contract-vollständig und
  getestet. Kein Compose-Screen in Web/iOS, der sie aufruft — siehe eigener
  Abschnitt "Entwürfe" unten.
- **Ordner-Umbau** (`eingang`/`entwuerfe`/`gesendet` ersetzen
  `wichtig`/`rechnungen`, `src/db/store.ts` `migrateLegacySystemFolders()`):
  echte Migration bestehender User beim nächsten `ensureDemoUser()`-Aufruf,
  keine simulierte/gemockte Logik. Siehe Abschnitt "Ordner (benutzerdefiniert)".

## Auto-Delete: adult/gambling-Spam

Seit dem Contract-Update vom 08.09. (`WEB_INBOX.md` "Neue
Spam-Unterkategorie fuer aggressives Auto-Loeschen", `spam_subcategory` auf
`message_security`) gilt in der Sync-Pipeline (`src/mail/sync.ts`) zusätzlich
zur Auto-Quarantäne bei Phishing eine zweite automatische Regel:

- `classification === "spam"` **und** `spamSubcategory` ist `"adult"` oder
  `"gambling"` -> die Nachricht wird **nicht persistiert**: keine Zeile in
  `messages`, keine `message_security`-Zeile, kein `quarantine`-Eintrag,
  keine Aufbewahrungsfrist, kein Undo.
- `spamSubcategory` `"generic"`/`"marketing"` -> unverändertes Verhalten
  (normaler Spam-Ordner, normale Aufbewahrung über `data_retention_policy`).
- `classification === "phishing"` ist von dieser Regel komplett unberührt
  und bleibt immer im bestehenden Quarantäne-Pfad.

**Design-Entscheidung (2026-09-08):** "gar nicht erst persistieren" statt
"persistieren + sofort wieder löschen". Beide Varianten wären laut Auftrag
vertretbar gewesen; diese Umsetzung landet nie im Store, auch nicht
kurzzeitig, weil (a) der Auftrag explizit "kein 30-Tage-Aufheben, kein
Undo" verlangt — ein real angelegter (wenn auch sofort gelöschter)
Datensatz hätte einen Undo-Pfad nahegelegt, den es hier bewusst nicht gibt
—, und (b) so nie potenziell heikler Inhalt (Erotik/Glücksspiel) im Store
liegt, und sei es nur für einen Tick. Nachteil: ohne eine echte
`messages`-Zeile kann das normale Dedupe (`UNIQUE (mail_account_id,
message_id_header)`) diese Mails nicht wiedererkennen — ein erneuter Sync
(z.B. wiederholtes `POST /internal/sync`) hätte sie sonst bei jedem Lauf
erneut "entdeckt". Behelf dafür: `store.wasAutoDeleted()`/`markAutoDeleted()`
— bei `InMemoryStore` ein reines Prozess-Gedächtnis
(`Set<mailAccountId:messageIdHeader>`, kein Mail-Inhalt, geht bei Neustart
verloren), bei `PostgresStore` seit 09.09. (siehe Abschnitt "Persistenz"
unten) echt persistiert in der kleinen, inhaltslosen Tabelle
`auto_deleted_message_headers` (nur der Dedupe-Schlüssel, kein Mail-Inhalt).

**Audit-Log:** jeder Auto-Delete schreibt einen Eintrag in
`security_audit_log` (`action = 'auto_deleted_adult_gambling_spam'`,
`message_id = null`, da nie eine `messages`-Zeile existiert) — Transparenz
für den User, warum eine erwartete Mail fehlen könnte, auch wenn die Mail
selbst nicht bleibt. `security_audit_log` hat laut Schema kein Freitextfeld
für Betreff/Absender; dieser Log-Eintrag verrät also bewusst nichts über
den Inhalt der gelöschten Mail. `store.logSecurityAudit()` (neue
Store-Methode) ist aktuell der einzige Schreiber; es gibt (wie schon vor
diesem Feature, siehe "Annahmen" unten) keinen `GET`-Endpunkt dafür, da
`api-spec.yaml` keinen vorsieht.

`syncAccount()` gibt zusätzlich `autoDeleted: number` zurück (neben
`imported`), sichtbar auch in der `POST /internal/sync`-Antwort.

**Mock-Erkennung:** `src/ai/mockAdapter.ts` liefert `spamSubcategory` über
eine simple Keyword-Heuristik (z.B. "casino"/"jackpot" -> `gambling`),
NICHT echte Klassifikation — analog zum bisherigen Spam/Phishing-Mock.
Track B baut die echte Erkennungslogik; der Austausch betrifft weiterhin
nur `src/ai/index.ts` (siehe oben "Was ist echt, was ist Mock/Stub").
Integration mit Track B (echte `spamSubcategory`-Werte statt Mock) ist ein
separater, noch offener Schritt.

## Automatische Abmeldung bei Spam

Seit dem Contract-Update vom 09.09. (`WEB_INBOX.md` "Automatische Abmeldung
bei Spam", Tabelle `unsubscribe_actions` in `contracts/db-schema.sql`,
Endpunkt `POST /messages/{messageId}/unsubscribe` in
`contracts/api-spec.yaml`) gibt es zwei Wege, eine `unsubscribe_actions`-Zeile
anzulegen:

- **Automatisch** (`src/mail/sync.ts`, `maybeAutoUnsubscribeFromSpam()`): nur
  wenn `classification === "spam"` (egal welche `spamSubcategory`) UND die
  Mail einen syntaktisch gültigen `List-Unsubscribe`-Header hat. Läuft direkt
  in der Sync-Pipeline, entweder nach dem Anlegen der normalen `messages`-Zeile
  (`message_id` gesetzt) oder — bei adult/gambling-Spam — **vor** dem
  Auto-Delete (siehe oben), mit `message_id = null`, da dort nie eine
  `messages`-Zeile existiert. Status landet direkt auf `'confirmed'`
  (`user_confirmed_at = now()`), da hier kein User in der Schleife ist.
  `classification === "phishing"` löst NIE automatisch aus, auch wenn ein
  (dann meist gefälschter) `List-Unsubscribe`-Header vorhanden ist — ein
  Angreifer könnte sonst über einen frei erfundenen Header serverseitig einen
  Netzwerk-Call/E-Mail-Versand an eine beliebige Adresse auslösen.
- **Manuell** (`POST /messages/:messageId/unsubscribe`, `src/routes/
  messages.ts`): prüft nur, ob die (bereits gespeicherte) Nachricht einen
  gültigen `List-Unsubscribe`-Header hat — unabhängig von ihrer
  Klassifikation, da hier explizit der User selbst entscheidet. `404` wenn die
  `messageId` unbekannt ist, `400` wenn kein gültiger Header vorliegt, sonst
  `200` mit einer neuen Zeile im Status `'pending_confirmation'`.

**Header-Parsing** (`src/mail/listUnsubscribe.ts`,
`parseListUnsubscribeHeader()`): liest `mailto:`/`https:`-URIs aus den
kommagetrennten `<...>`-Einträgen von RFC 2369 (`List-Unsubscribe`), analog zu
RFC 8058. **Bewusste Einschränkung:** rein syntaktische Auswertung — es wird
nie wirklich eine Mail verschickt oder eine URL aufgerufen (kein
Netzwerk-Call), und der `List-Unsubscribe-Post`-Header (RFC 8058,
One-Click-Bestätigung per POST) wird nicht geprüft/verlangt. Für einen
echten Versand/Call bräuchte es eine explizite Freigabe (Netzwerkzugriff auf
beliebige, aus Mail-Headern stammende Adressen ist ein reales Missbrauchs-
/SSRF-Risiko) — außerhalb des Rahmens dieses ersten Durchstichs.

**Contract-Ergänzung (kleine, additive Änderung ohne Web-Vorabsprache, siehe
Muster unten "Annahmen"):** `unsubscribe_actions.message_id` war im Contract
`NOT NULL REFERENCES messages(id)`, das widerspricht aber direkt Webs eigener
Vorgabe, bei adult/gambling-Spam VOR dem Verwerfen abzumelden (dort gibt es
nie eine `messages`-Zeile). Analog zum bereits bestehenden Muster in
`security_audit_log` (identisches Problem, dort bereits mit eigener
`user_id`-Spalte + nullable `message_id` gelöst) `message_id` nullable gemacht
und eine `user_id`-Spalte ergänzt.

## Ordner (benutzerdefiniert)

Seit dem Contract-Update vom 08.09. (SYNC.md, Commit `734781e`) sind
Ordner eigene Datensätze (Tabelle `folders`) statt eines festen
Enum-Strings auf `messages.folder`:

- Jeder User bekommt beim Anlegen (`ensureDemoUser()` in `src/db/store.ts`)
  automatisch 7 System-Ordner (`is_system=true`), Namen/Icons/Reihenfolge
  1:1 aus `contracts/design-tokens.json` (`systemFolders.defaults`):
  `eingang` (inbox), `entwuerfe` (file-pencil), `gesendet` (send),
  `sonstiges` (folder), `quarantaene` (shield-exclamation), `spam`
  (trash), `papierkorb` (trash-2, seit dem Nachtrag vom 08.09., siehe
  Abschnitt "Papierkorb / Löschen" unten). **[2026-09-10] Ordner-Umbau**
  (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"):
  `wichtig`/`rechnungen` sind keine System-Ordner mehr (der User kann
  beides weiterhin als eigenen Ordner anlegen), `eingang` ersetzt
  `wichtig` als echte automatische Landezone für neue, normale Mail
  (`mail/sync.ts` `resolveFolderId()`), `entwuerfe`/`gesendet` sind neu
  (siehe eigener Abschnitt "Entwürfe" unten). Bestehende User (die schon
  die alten 6 System-Ordner hatten) werden bei jedem `ensureDemoUser()`-
  Aufruf automatisch migriert (`migrateLegacySystemFolders()`): fehlende
  neue Pflicht-Ordner werden nachgerüstet, Nachrichten aus `wichtig`/
  `rechnungen` wandern nach `eingang`, die beiden alten Ordner-Zeilen
  werden entfernt — gleiches Prinzip wie beim Löschen eines eigenen
  Ordners (Nachrichten gehen nie verloren), keine separate SQL-Migration
  nötig (kein Migrationstool in diesem Stand, siehe `db-schema.sql`-
  Kommentar).
- Eigene Ordner (`POST /folders`) haben `is_system=false`,
  `system_key=null` und als Default-Icon `folder`
  (`contracts/design-tokens.json` → `customFolder.defaultIcon`).
- `PATCH /folders/:folderId`: Name/Icon/Reihenfolge änderbar. Ausnahme:
  `quarantaene`, `spam`, `papierkorb`, `entwuerfe` und `gesendet` sind laut
  Design-Token (`renamable: false`) **nicht umbenennbar** — ein `PATCH`
  mit `name` auf diese fünf liefert `400`. Icon/Reihenfolge bleiben bei
  diesen fünf änderbar, da der Contract dazu nichts einschränkt.
- `DELETE /folders/:folderId`: System-Ordner (`is_system=true`) sind nicht
  löschbar (`400`).
- **Design-Entscheidung (nicht im Contract geregelt), 2026-09-08:**
  `messages.folder_id` ist laut Schema `NOT NULL`/FK und darf nie ins
  Leere zeigen. Beim Löschen eines eigenen Ordners werden dessen
  Nachrichten deshalb vorher automatisch in den System-Ordner "sonstiges"
  verschoben (`src/routes/folders.ts`, `DELETE`-Handler). Alternative wäre
  gewesen, das Löschen bei nicht-leeren Ordnern ganz abzulehnen — aus
  Sicht des Skeletons wirkte "nach sonstiges verschieben" nutzerfreundlicher
  und ist mit dem Schema vereinbar; sollte aber mit UI/Product nochmal
  bestätigt werden, falls das nicht das gewünschte Verhalten ist.
- `POST /messages/:messageId/move`: verschiebt eine Nachricht in einen
  beliebigen existierenden Ordner (System- oder eigenen), `400` falls
  `folderId` fehlt oder nicht existiert.
- Kein Multi-User: da dieses Skeleton nur den einen Demo-User kennt
  (siehe "Annahmen" unten), sind `folders`/`GET /folders` etc. nicht nach
  `userId` aus dem Request gefiltert, sondern greifen intern immer auf
  `ensureDemoUser()` zu — analog zum bestehenden Muster in
  `src/routes/capability.ts`.

## Papierkorb / Löschen

Seit dem Contract-Nachtrag vom 08.09. (`WEB_INBOX.md` "Fehlende
Basis-Funktion entdeckt", Commit `156f0fd`) kann eine Mail manuell gelöscht
werden — analog zu Gmail zweistufig:

- `DELETE /messages/{messageId}` (soft delete): verschiebt die Nachricht in
  den `papierkorb`-System-Ordner des Accounts. **Gleiche Mechanik wie `POST
  /messages/{messageId}/move`** (ruft intern dieselbe `store.moveMessage()`
  auf, kein eigener Mechanismus) — nur das Ziel ist fest der
  Papierkorb-Ordner statt eines beliebigen, im Body übergebenen Ordners.
  `404`, falls die Nachricht nicht existiert. Response `200` mit der
  aktualisierten Nachricht (`ApiMessage`).
- `DELETE /messages/{messageId}/permanent` (endgültig löschen): entfernt
  den Message-Datensatz (inkl. `message_security`/`message_ai_summary`)
  endgültig aus dem Store (`store.deleteMessage()`). Response `200`
  (`{ deleted: true }`).

**Design-Entscheidung (2026-09-08, nicht explizit im Auftrag):**
`permanent` ist standardmäßig **nur erlaubt, wenn sich die Nachricht gerade
im Papierkorb-Ordner befindet** — sonst `400` mit Erklärung im
Response-Body. Begründung: der Contract-Kommentar zu diesem Endpunkt sagt
selbst "nur sinnvoll aus dem Papierkorb heraus"; ohne diese Prüfung könnte
jede Mail aus jedem Ordner (Posteingang, Quarantäne, ...) ohne den
Zwischenschritt "erst in den Papierkorb verschieben" endgültig und ohne
jede Undo-Möglichkeit verschwinden — ein Foot-Gun bei versehentlichem
Klick/API-Call. Entspricht außerdem dem Gmail-Vorbild, an dem sich dieser
Nachtrag laut Auftrag orientiert (Gmail erlaubt "endgültig löschen"
ebenfalls nur aus dem Papierkorb heraus über die normale UI). Der
Papierkorb-Ordner selbst braucht laut Auftrag **keine** eigene
Retention-Tabelle wie `quarantine` (kein automatisches 30-Tage-Löschen) —
der User leert ihn manuell oder er bleibt liegen, wie bei Gmail.

**Provider-Spiegelung (integriert 09.09.):** `DELETE /messages/{messageId}`
ruft serverseitig zusätzlich `MailAdapter.trashMessage()` auf (Gmail API
`messages.trash`, IMAP `\Deleted`-Flag OHNE Expunge), `DELETE
/messages/{messageId}/permanent` entsprechend `permanentlyDeleteMessage()`
(Gmail `messages.delete`, IMAP `\Deleted` + `EXPUNGE` in einem Schritt über
`imapflow`s `messageDelete()`). Umgesetzt in `src/routes/messages.ts`
(`mirrorToProvider()`-Helper) + `src/mail/gmailAdapter.ts`/`imapAdapter.ts`.

- **`providerMessageId`:** `MailAdapter.fetchRecentMessages()` liefert seit
  dieser Integration zusätzlich ein `providerMessageId` pro Nachricht
  (Gmail: die Gmail-Message-ID, NICHT der RFC822-`Message-ID`-Header, mit
  dem `messageIdHeader`/das Dedupe-Feld befüllt ist; IMAP: die UID
  innerhalb von "INBOX"), das beim Import in `MessageRecord` mitgespeichert
  wird — ohne dieses Handle könnte man eine Nachricht später nicht mehr
  eindeutig beim Provider adressieren. Fixture-Nachrichten haben
  `providerMessageId: null` (kein echtes Postfach dahinter).
- **IMAP-UID-Grenze:** eine UID ist nur innerhalb ihrer Mailbox + aktueller
  `UIDVALIDITY` eindeutig. Da `fetchRecentMessages()` ausschließlich
  "INBOX" liest, ist das für diesen Durchstich unkritisch — bricht aber,
  falls eine Mailbox jemals neu erstellt wird (UIDVALIDITY-Wechsel) oder
  mehrere Mailboxen gelesen werden sollten. Nicht behandelt, da außerhalb
  des aktuellen Scopes (nur "INBOX").
- **Fehlerverhalten — best effort, kein Rollback:** schlägt der
  Provider-Call fehl (Netzwerk, abgelaufenes Token, ...), wird das nur mit
  `console.warn` geloggt, die lokale Store-Operation (Papierkorb/Löschen)
  läuft trotzdem durch. Begründung: der lokale Zustand ist bereits die
  Quelle der Wahrheit für die App-Ansicht selbst; ein User soll eine Mail
  aus seiner eigenen Ansicht auch dann entfernen können, wenn der
  Provider-Roundtrip gerade klemmt.
- **Nicht end-to-end getestet:** wie beim restlichen Gmail-/IMAP-Zugriff
  (siehe "Was ist echt, was ist Mock/Stub" oben) braucht ein echter Test
  echte Zugangsdaten. Der Smoketest läuft gegen den Fixture-Adapter, dessen
  `trashMessage()`/`permanentlyDeleteMessage()` ein dokumentiertes No-Op
  sind (kein echtes Postfach zum Spiegeln) — die Verdrahtung selbst
  (`mirrorToProvider()` wird aufgerufen, überlebt `providerMessageId ===
  null`) ist dadurch abgedeckt, die echten Gmail-/IMAP-API-Calls nicht.

**Tests:** `src/smoketest.ts` deckt soft delete (Nachricht landet im
Papierkorb-Ordner, `GET` bestätigt `folderId`), permanent delete aus dem
Papierkorb (Nachricht danach nicht mehr im Store, `GET` liefert `404`),
die Ablehnung von permanent delete außerhalb des Papierkorbs (`400`, aus
dem Spam-Ordner heraus versucht) sowie `404` bei `DELETE` auf eine
unbekannte `messageId` ab.

## Ausgehender Phishing-Check (Composer)

Seit dem Contract-Update vom 08.09. (`WEB_INBOX.md` "Ausgehender
Phishing-Check im Composer" + Erweiterung, Commit `b6b3eb2`) gibt es
`POST /messages/draft/phishing-check`: prüft einen Mail-ENTWURF (`bodyText`
+ `links`) vor dem Versand, bevor er den Composer verlässt.

**Implementierung (integriert 09.09.):** ruft direkt `checkDraftForPhishing()`
aus `@driftmail/security-classification` (Track B) auf, verdrahtet in
`src/routes/messages.ts`. Die vorherige Mock-Implementierung
(`src/ai/draftPhishingCheckMock.ts`) ist gelöscht. Damit laufen
Homoglyph-Domain-Erkennung, Mod-97-validierte IBAN- und Luhn-validierte
Kreditkarten-Erkennung sowie die Link-Mismatch-/Dringlichkeitssprache-Logik
jetzt echt, nicht mehr über vereinfachte Regex-/Keyword-Nachbauten.

**Einzige Anpassung beim Aufruf:** Track B's `ExtractedLink.displayText`
ist `string` (nicht nullable wie im API-Contract) — ein fehlender
Anzeigetext aus dem Request wird als leerer String übergeben, siehe
`src/routes/messages.ts`.

**`recipientReputation`:** bleibt bei Track B (`security-classification/`)
weiterhin immer `"unknown"` (das Paket bleibt bewusst zustandslos, siehe
"Architekturentscheidung" oben). Im Backend seit dem Lookup-Adapter-Schritt
(siehe "Externe Lookup-Adapter" unten) ein eigener Nachbearbeitungsschritt
NACH `checkDraftForPhishing()`, der `recipientAddress` (neues, optionales
Request-Feld, siehe `contracts/api-spec.yaml`) gegen den Store prüft —
bleibt `"unknown"`, wenn `recipientAddress` fehlt.

**Tests:** `src/smoketest.ts` deckt einen Block-Fall (Link-Mismatch,
`blocked === true` + `reason` gesetzt + genau 1 `riskyLink`), einen
Nicht-Block-Fall mit sensiblen Daten (eigene IBAN im Text — `blocked ===
false`, `containsSensitiveData` enthält `"iban"`, ohne `recipientAddress`
bleibt `recipientReputation === "unknown"`) sowie die
`recipientReputation`-Fälle `"safe"`/`"flagged"` über den
Lookup-Adapter ab (siehe "Externe Lookup-Adapter" unten).

## Versand (`POST /messages/send`)

Seit `WEB_INBOX.md` 09.09. ("Fehlender Senden-Endpunkt", `contracts/api-spec.yaml`
+ `src/routes/messages.ts`): sendet eine neue Mail oder eine Antwort über die
Provider-API des verbundenen Kontos (kein eigener Mailserver, gleiches Prinzip
wie beim Lesen — siehe "Was ist echt, was ist Mock/Stub" unten).

**Ablauf:**

1. Konto ermitteln: bei einer Antwort (`inReplyToMessageId` gesetzt) das Konto
   der Ursprungsnachricht, sonst das explizit übergebene `accountId` — genau
   eines von beidem ist erforderlich, sonst 400.
2. Phishing-Check serverseitig als letzte Instanz (dieselbe Logik wie
   `POST /messages/draft/phishing-check`, siehe oben), unabhängig davon, ob
   der Composer vorher schon geprüft hat. **Grenze:** der Request-Body dieses
   Endpunkts hat kein eigenes `links`-Feld (nur `bodyText`) — Links werden
   deshalb per Regex direkt aus dem Klartext extrahiert, mit `displayText ===
   actualUrl`. Der Link-Mismatch-Erkennungspfad (Anzeigetext täuscht eine
   andere Domain vor als das tatsächliche Linkziel) kann dadurch über diesen
   Endpunkt nie auslösen — das ist nur über den separaten Draft-Check mit
   echten HTML-Links (Anzeigetext ≠ URL) möglich. Homoglyph-Erkennung
   (innerhalb der URL selbst) und die Dringlichkeit+Zugangsdaten-Kombination
   funktionieren dagegen unverändert, weil sie nicht auf einem
   Anzeigetext/URL-Unterschied beruhen. `blocked === true` → 422, kein Versand.
3. `MailAdapter.sendMail()` (neu, siehe `src/mail/types.ts`) baut je Provider
   eine echte Mail und sendet sie:
   - **Gmail:** rohe RFC822-Mail (`To`/`Cc`/`Subject`/`In-Reply-To`/
     `References`/Body), base64url-kodiert, über `users.messages.send` — Gmail
     setzt Absender/Auth-Header selbst anhand des authentifizierten Kontos.
   - **IMAP:** IMAP selbst kann nicht senden (reines Abhol-Protokoll) — Versand
     läuft über SMTP (`nodemailer`, neue Dependency) mit denselben
     Zugangsdaten. **Grenze (nicht geraten, sondern bewusst dokumentiert):**
     SMTP-Host/Port sind bei generischen IMAP-Providern nicht automatisch aus
     den IMAP-Zugangsdaten ableitbar — mangels eigener Env-Vars fällt
     `adapterForAccount()` (`src/mail/sync.ts`) auf den IMAP-Host + Port 587
     (STARTTLS) zurück, überschreibbar über `SMTP_HOST`/`SMTP_PORT`/
     `SMTP_SECURE`. Funktioniert bei Providern mit demselben Mailserver für
     IMAP/SMTP (häufigster Fall), aber nicht garantiert korrekt bei jedem
     Provider.
   - **Fixture:** kein echtes Postfach — simuliert einen erfolgreichen Versand
     mit einer erfundenen `providerMessageId`, damit `npm run dev`/Smoketest
     ohne jede Konfiguration weiterhin end-to-end lauffähig bleiben.
   Schlägt der Provider-Call fehl, wird das geloggt und 502 zurückgegeben —
   anders als bei der Papierkorb-Spiegelung (best effort, siehe unten) KEIN
   stiller Fallback, weil ein Versand, der beim User als "gesendet" ankommt,
   aber nie beim Provider ankam, ein Vertrauensbruch wäre (im Gegensatz zu
   "Mail aus der eigenen Ansicht entfernen", wo die lokale Sicht bereits die
   Quelle der Wahrheit ist).
4. Nach erfolgreichem Versand: ein `outgoing_send_log`-Eintrag je Empfänger
   (`to` + `cc`, dedupliziert) über `store.recordOutgoingSend()` — die
   Infrastruktur dafür (Tabelle + Store-Methode) existierte bereits seit
   Commit `a5432e6`, wurde aber nie von einem echten Endpunkt aufgerufen.
   Grundlage für `recipientReputation` (`hasSentTo`, siehe oben) und eine
   künftige Bot/Human-Missbrauchserkennung (`send_abuse_flags`-Tabelle
   existiert bereits im Schema, die eigentliche Erkennungslogik
   `rate_burst`/`many_new_recipients`/`duplicate_content`/
   `no_read_before_reply`/`phishing_content` ist **nicht** Teil dieses
   Schritts und noch offen).

5. **[2026-09-10] Nachtrag (Ordner-Umbau, WEB_INBOX.md 09.09. "KORREKTUR/
   ERWEITERUNG des Ordner-Umbau-Eintrags"):** eine lokale `messages`-Zeile
   im "gesendet"-Systemordner wird jetzt tatsächlich angelegt (`folderId`
   = `gesendet`, `providerMessageId` = `sentMessageId`, keine
   `message_security`-Zeile — eine eigene ausgehende Mail wird nicht
   klassifiziert, `GET /messages/{id}` liefert dafür korrekt
   `classification: "unclear"`/`security: null`). Attachments werden per
   `store.linkAttachmentsToMessage()` mit dieser neuen Nachricht
   verknüpft (vorher unmöglich, weil es noch keine passende `messages`-
   Zeile gab, siehe "Anhänge" unten). Optionales Request-Feld `draftId`:
   falls gesetzt, wird der referenzierte Entwurf nach erfolgreichem
   Versand automatisch gelöscht (`store.deleteDraft()`, best effort, kein
   Fehler falls schon nicht mehr vorhanden).

Anhänge: siehe eigener Abschnitt "Anhänge" unten.

**Tests:** `src/smoketest.ts` deckt eine neue Mail (200 + `sentMessageId`,
`outgoing_send_log`-Eintrag über `hasSentTo` geprüft), eine Antwort (nur
`inReplyToMessageId`, Konto wird daraus abgeleitet), fehlendes `accountId`
ohne `inReplyToMessageId` (400), unbekannte `inReplyToMessageId` (404) sowie
den serverseitigen Phishing-Block (Dringlichkeit + Zugangsdaten-Anfrage, 422,
kein `outgoing_send_log`-Eintrag) ab.

## Entwürfe (`GET`/`POST /drafts`, `PATCH`/`DELETE /drafts/{draftId}`)

Seit `WEB_INBOX.md` 09.09. ("KORREKTUR/ERWEITERUNG des Ordner-Umbau-
Eintrags"): eigene `drafts`-Tabelle, bewusst getrennt von `messages` (ein
Entwurf hat keine echte `message_id_header` eines Providers — `messages`
ist auf empfangene/gesendete echte Mails ausgelegt, siehe UNIQUE-Constraint
dort). Der "entwuerfe"-Systemordner in der UI zeigt den Inhalt dieser
Tabelle, nicht `GET /messages`.

- `POST /drafts`: legt einen neuen (leeren oder vorbefüllten) Entwurf an.
  Anders als `POST /messages/send` (dort `accountId` ODER
  `inReplyToMessageId` erforderlich) reicht hier immer der Demo-User selbst
  — dieser Skeleton kennt ohnehin nur ein einziges Konto pro User
  (`ensureDemoUser()`), ein eigenes `accountId`-Feld im Request wäre
  redundant. Validiert `inReplyToMessageId` gegen `store.getMessage()`,
  falls gesetzt (404 sonst).
- `PATCH /drafts/{draftId}`: laufendes Speichern während des Tippens —
  jedes Feld optional, nur mitgeschickte Felder werden überschrieben.
- `DELETE /drafts/{draftId}`: Entwurf verwerfen. Wird auch **intern** von
  `POST /messages/send` aufgerufen, wenn dort `draftId` mitgegeben wurde
  (siehe Abschnitt "Versand" oben) — kein separater Client-Aufruf nötig.
- **Bewusst nicht Teil dieses Schritts:** kein "Neue Mail verfassen"-
  Compose-Screen in Web/iOS, der `POST /drafts` beim Start eines
  Compose-Vorgangs aufrufen und `PATCH /drafts/{draftId}` als Autosave
  während des Tippens nutzen würde — die Endpunkte sind Contract-vollständig
  und getestet, aber aktuell von keiner Client-UI konsumiert (Web/iOS zeigen
  den "entwuerfe"-Ordner nur lesend + mit Löschen, siehe `web/README.md`/
  `ios/README.md`).

**Tests:** `src/smoketest.ts` deckt Anlegen (inkl. `subject`-Übernahme),
`PATCH` (Feld-Update + unverändertes `subject` ohne erneutes Mitschicken),
`GET`-Liste, automatisches Verwerfen nach `POST /messages/send` mit
`draftId` (per anschließendem `PATCH` auf dieselbe `draftId` verifiziert,
das dann 404 liefert) sowie `PATCH`/`DELETE` auf unbekannte `draftId` (404
je) ab.

## Anhänge (`POST /attachments` + `POST /messages/send` `attachmentIds`)

Seit `WEB_INBOX.md` 09.09. ("Erweiterung des Send-Endpunkt-Eintrags von
eben"): Anhänge müssen VOR dem Versand hochgeladen und gescannt werden,
`POST /messages/send` lehnt ab (422, gleiche Fehlerform wie der
Phishing-Block), wenn irgendeine mitgegebene `attachmentId` nicht
`scan_status='clean'` hat — keine Ausnahme.

**Contract-Anpassung an `message_attachments`:** `message_id` ist jetzt
nullable, neue Spalte `uploaded_by_user_id` + Check-Constraint (genau eines
von beiden muss gesetzt sein) — direkt am `CREATE TABLE` geändert statt per
`ALTER TABLE` (Repo-Konvention, siehe Kommentar in `db-schema.sql`; die
Tabelle wurde bisher von keinem Code beschrieben, es gibt also keinen
Bestand, der eine echte Migration bräuchte).

**Ablauf:**

1. `POST /attachments` (`multipart/form-data`, Feld `file`, siehe
   `routes/attachments.ts`): Datei wird per `multer` (Memory-Storage, 15 MB
   Limit) entgegengenommen, sofort gescannt (`attachmentScanMock.ts`,
   siehe unten) und als `message_attachments`-Zeile mit `message_id = null`,
   `uploaded_by_user_id = <Demo-User>` gespeichert. Response:
   `attachmentId` + `scanStatus`.
2. `POST /messages/send` bekommt ein neues optionales Feld `attachmentIds`
   (Array). Jede ID muss existieren (sonst 400) und `scan_status='clean'`
   haben (sonst 422, `blocked: true` + `reason` mit Dateiname/Status) —
   geprüft NACH dem Phishing-Check, VOR dem eigentlichen Provider-Send-Call.

**Scan-Logik (`src/lookups/attachmentScanMock.ts`):** wie bei den externen
Lookups ein austauschbares `AttachmentScanner`-Interface
(`src/lookups/types.ts`) + eine bewusst simple Mock-Implementierung — KEIN
echter Virenscan (kein ClamAV-/VirusTotal-Aufruf). Prüft nur die
Dateiendung gegen eine Beispielliste ausführbarer/makrofähiger Typen (`.exe`,
`.bat`, `.js`, `.docm`, …) → `blocked_type`; ein Dateiname, der
`virus`/`malware` enthält, ist ein deterministischer Test-Trigger für
`malicious` (analog zur Botnetz-Beispiel-IP-Liste in `ipReputationMock.ts`);
alles andere → `clean`. `scan_failed` wird vom Mock nie geliefert (kein
echter Dienst, der fehlschlagen könnte) — der Enum-Wert existiert im
Contract für eine spätere echte Anbindung.

**Eine bewusste, dokumentierte Grenze dieses Schritts (kein Blocker, aber
nicht stillschweigend als "fertig" markiert):**

**Der Dateiinhalt selbst wird nicht gespeichert.** `message_attachments`
hat laut Contract keine `content`-Spalte (eine echte Implementierung
würde Objektspeicher wie S3 nutzen, kein DB-Feld) — der Scan läuft daher
nur gegen Metadaten (Dateiname/MIME-Typ/Größe), nicht gegen den
tatsächlichen Byte-Inhalt. Folge: `POST /messages/send` bettet geprüfte
Anhänge aktuell **nicht tatsächlich** in die ausgehende Mail ein (die
Bytes sind nach dem Upload-Request nicht mehr vorhanden) — der Endpunkt
stellt nur sicher, dass kein ungeprüfter/gefährlicher Anhang "mitgeschickt"
werden darf. Echte Speicherung + MIME-Einbettung beim Versand ist ein
späterer Schritt.

**[2026-09-10] Nachgezogen (Ordner-Umbau, WEB_INBOX.md 09.09.):**
`store.linkAttachmentsToMessage()` wird jetzt tatsächlich aufgerufen —
seit der "gesendet"-Systemordner existiert, gibt es die dafür nötige
lokale `messages`-Zeile (siehe Abschnitt "Versand" oben, Punkt 5). Der
`TODO`-Kommentar dazu in `routes/messages.ts` ist entfernt.

**Tests:** `src/smoketest.ts` deckt Upload einer unauffälligen Datei
(`clean`), einer Datei mit gefährlicher Endung (`blocked_type`), des
`malicious`-Test-Triggers, fehlendes Datei-Feld (400), Versand mit einem
`clean` Anhang (200) sowie Versand mit einem nicht-`clean` bzw. unbekannten
Anhang (422 bzw. 400) ab.

## Externe Lookup-Adapter

Seit der Web-Antwort auf die vier "wer macht den externen Lookup"-Fragen
(SYNC.md 08.09.) ist geklärt: `security-classification/` (Track B) bleibt
bewusst zustandslos (kein Netzwerk, keine DB) — Track A macht alle vier
Lookups als eigenen Nachbearbeitungsschritt, NACH dem Aufruf von
`aiAdapter.analyzeMail()` bzw. `checkDraftForPhishing()`, nicht als
Erweiterung der Funktionssignaturen selbst. Kein Contract-Bruch: die
Feld-Typen in `SecurityResult`/der phishing-check-Response bleiben
unverändert, nur **wer** sie befüllt ändert sich.

**Muster:** ein Interface pro externem Dienst (`src/lookups/types.ts`),
analog zu `AiAdapter` (`src/ai/types.ts`) — austauschbar gegen eine echte
Implementierung, ohne dass Aufrufer (Sync-Pipeline/Routen) etwas davon
merken. `src/lookups/index.ts` ist die einzige Stelle, die die konkreten
(Mock-)Implementierungen mit den Interfaces verdrahtet; der Austausch gegen
eine echte Implementierung betrifft jeweils nur eine Zeile dort.

| Interface | Feld(er) | Mock-Implementierung | Reale Implementierung wäre |
|---|---|---|---|
| `DomainReputationLookup` | `senderDomainAgeDays`, `domainReputationScore` | `domainReputationMock.ts`: deterministische Heuristik auf verdächtigen TLDs/Schlüsselwörtern im Domain-Namen (z.B. `.tk`, `"secure"`) | WHOIS-Abfrage + Reputationsdienst |
| `IpReputationLookup` | `ipReputationFlag` | `ipReputationMock.ts`: IP wird aus `X-Originating-IP`/`Received`-Header extrahiert (`extractSendingIp()`), gegen eine frei erfundene Beispiel-Adressliste geprüft; ohne ermittelbare IP immer `"unknown"`, nie geraten | Abgleich gegen einen DNSBL-Dienst (z.B. Spamhaus XBL/CBL) |
| `IbanHistoryCheck` | `containsNewIban` | `ibanHistoryCheck.ts`: IBAN-Kandidaten per simpler Regex extrahiert (`extractIbanCandidates()`, ohne eigene Mod-97-Prüfsumme — die eigentliche IBAN-Erkennung inkl. Prüfsumme läuft bereits vorher in `@driftmail/security-classification`), gegen eine **echte** Historie geprüft (`store.hasSeenIban()`/`recordIban()`, Schlüssel `userId`+`senderAddress`) — "neu" heißt: noch nie zuvor von diesem Absender an diesen User gesehen. Seit 09.09. (siehe "Persistenz" oben) echt persistiert in `iban_sightings`, wenn `DATABASE_URL` gesetzt ist, sonst In-Memory-Map wie bisher | bereits identisch — kein Unterschied mehr zwischen "Mock" und "real" bei gesetzter `DATABASE_URL` |
| `RecipientReputationLookup` | `recipientReputation` | `recipientReputationMock.ts`: `"safe"`, wenn der User laut `store.outgoingSendLog` dieser Adresse schon einmal geschrieben hat; `"flagged"`, wenn die Adresse/Domain schon als Absender einer `phishing`-klassifizierten eingehenden Mail aufgefallen ist (`store.messages`/`messageSecurity`); sonst `"unknown"` | Abgleich gegen `fraud_alerts`/`domain_reputation_score` in Postgres |

**Verdrahtung:**
- `src/mail/sync.ts`: Domain-, IP- und IBAN-Historie-Lookup laufen direkt
  nach `ai.analyzeMail(...)`, noch bevor die Nachricht/`message_security`
  persistiert wird — überschreiben also die vom Mock-KI-Adapter gelieferten
  Platzhalterwerte für diese drei Felder.
- `src/routes/messages.ts` (`POST /messages/draft/phishing-check`): der
  Empfänger-Reputations-Lookup läuft nach `checkDraftForPhishing(...)`,
  bevor die Response geschickt wird. Braucht die Ziel-Adresse — dafür neues,
  **optionales** Request-Feld `recipientAddress` (kleine Contract-Ergänzung,
  siehe `contracts/api-spec.yaml` + SYNC.md-Änderungsprotokoll; ohne dieses
  Feld bleibt `recipientReputation` weiterhin `"unknown"`).

**IBAN-Historie-Ablage:** `store.hasSeenIban()`/`recordIban()` — bei
`InMemoryStore` eine `Map<string, Set<string>>` (Schlüssel
`` `${userId}:${senderAddress}` ``), bei `PostgresStore` seit 09.09. (siehe
Abschnitt "Persistenz" unten) echt persistiert in der neuen Tabelle
`iban_sightings` (kleine Contract-Ergänzung — der ursprüngliche Auftrag
sagte "simple Set/Map ... in deinem bestehenden Store", was für den reinen
In-Memory-Durchstich richtig war, aber ohne eigene Tabelle bei einem
Neustart mit Postgres verloren gegangen wäre).

**Empfänger-Historie:** `store.outgoingSendLog`/`hasSentTo()`/
`recordOutgoingSend()` spiegelt `outgoing_send_log` (`db-schema.sql`,
Commit `a5432e6`) — bisher nur write-/lookup-seitig genutzt (kein eigener
`POST`-Endpoint für tatsächliches Versenden in diesem Durchstich, siehe
"Annahmen" unten). `ensureDemoUser()` seedet einen Beispiel-Eintrag
(`kollegin@example.com`, Fixture 4), damit der `"safe"`-Fall ohne echten
Versand-Pfad testbar ist — reiner Beispieldaten-Seed, keine echte
Versandhistorie.

**Grenzen (bewusst Mock, siehe Auftrag):** alle vier Lookups liefern
weiterhin Mock-Daten für die eigentliche Reputationsbewertung.
Domain-/IP-Reputation sind reine Heuristiken auf Beispiel-Listen, keine
echten WHOIS-/Spamhaus-Abfragen. IBAN-/Empfänger-Historie prüfen *echt*
gegen den Store (kein geratener Wert) — seit der Persistenz-Integration
(09.09., siehe unten) bei gesetzter `DATABASE_URL` auch echt in Postgres,
nicht mehr zwangsläufig In-Memory. Die echte Anbindung an WHOIS/Spamhaus/
einen Reputationsdienst bzw. eine echte `fraud_alerts`-Query ist ein
separater, noch nicht gestarteter Schritt — betrifft dann nur
`src/lookups/index.ts`.

**Tests:** `src/smoketest.ts` prüft je Lookup mind. einen Fall, in dem das
Feld jetzt tatsächlich befüllt wird (statt fest auf dem alten Platzhalter zu
stehen) — Domain-Reputation direkt (`domainReputationLookup.lookup(...)`,
verdächtige vs. unauffällige Domain) und end-to-end über
`GET /messages/:id` nach dem Sync (Fixture 1: unauffällige Domain +
`ipReputationFlag === "clean"`; Fixture 2: verdächtige Domain +
`ipReputationFlag === "known_botnet"` + `containsNewIban === true`;
Fixture 4: keine IP im Header -> `ipReputationFlag === "unknown"`),
außerdem: eine wiederholte IBAN vom selben Absender gilt **nicht** mehr als
neu (`ibanHistoryCheck.checkAndRecord(...)` zweimal mit derselben IBAN),
eine andere IBAN vom selben Absender weiterhin schon; `recipientReputation`
über `POST /messages/draft/phishing-check` für `"safe"` (bekannter Kontakt)
und `"flagged"` (Empfänger-Domain bereits als Phishing-Absender aufgefallen).

## Persistenz

Seit 09.09. (Web-Priorisierung "Persistenz zuerst", siehe
SYNC.md/TERMINAL_INBOX.md) gibt es eine echte Postgres-Anbindung
(`src/db/postgresStore.ts`, `PostgresStore`) neben dem ursprünglichen
In-Memory-Store (`src/db/store.ts`, `InMemoryStore`). Beide implementieren
dasselbe `Store`-Interface — Routen und Sync-Pipeline arbeiten nur dagegen,
nicht gegen eine der beiden konkreten Implementierungen oder gegen SQL
direkt (das war schon vorher so geschnitten, siehe Kopfkommentar in
`store.ts`).

**Welche Implementierung aktiv ist, entscheidet `DATABASE_URL`** — exakt
dasselbe "echt, wenn ENV gesetzt ist, sonst Zero-Config-Fallback"-Muster
wie beim Gmail-/IMAP-Adapter (`adapterForAccount()`): gesetzt ->
`PostgresStore`, sonst `InMemoryStore` (Daten gehen bei jedem Neustart
verloren, aber kein DB-Setup nötig).

**Setup:**
```bash
createdb driftmail_dev   # oder eine andere DB, braucht einen laufenden Postgres-Server
DATABASE_URL="postgresql://<user>@localhost:5432/driftmail_dev" npm run dev
```
`initStore()` (aufgerufen in `index.ts`/`smoketest.ts` vor dem ersten
Store-Zugriff) führt `contracts/db-schema.sql` einmal komplett aus. Alle
`CREATE TABLE`/`CREATE INDEX`-Anweisungen dort sind `IF NOT EXISTS` (kleine
Contract-Ergänzung, Terminal 09.09.) — kein separates Migrations-Tool
nötig, das Schema ist beliebig oft wiederholbar anwendbar.

**Contract-Ergänzungen für diesen Schritt** (kleinere Ergänzungen bereits
vereinbarter Features, siehe SYNC.md-Ankündigungsregel):
- `messages.provider_message_id` (nullable) — fehlte, obwohl das Feld seit
  der Provider-Spiegelung (siehe Abschnitt "Papierkorb / Löschen" oben)
  schon im internen `MessageRecord`-Typ existierte.
- `iban_sightings` (neue, kleine Tabelle) — die IBAN-Historie
  (`hasSeenIban`/`recordIban`, Grundlage für `containsNewIban`) war laut
  ursprünglichem Auftrag bewusst nur eine In-Memory-Map ohne
  `db-schema.sql`-Pendant. Für echte Persistenz jetzt nachgezogen, sonst
  wäre genau dieses eine Sicherheitsmerkmal nach einem Neustart verloren
  gegangen — ein Widerspruch zum Sinn dieses ganzen Schritts.
- `auto_deleted_message_headers` (neue, kleine Tabelle) — derselbe Fall wie
  oben, nur für den Dedupe-Fingerprint des Auto-Delete-Pfads
  (adult/gambling-Spam, siehe "Auto-Delete: adult/gambling-Spam" oben).

**Typ-Konvertierung** (siehe Kopfkommentar in `postgresStore.ts` für
Details): `pg` liefert `TIMESTAMPTZ` standardmäßig als JS-`Date` und
`NUMERIC` als String (Präzisionsschutz) — beides passt nicht zu den
`string`/`number`-Typen in `types.ts`. Global über `pg.types.setTypeParser`
umkonfiguriert: `TIMESTAMPTZ` -> ISO-8601-String, `DATE` -> unverändertes
`YYYY-MM-DD` (Postgres' Text-Ausgabe dafür ist schon exakt das richtige
Format), `NUMERIC` -> `parseFloat`.

**Bekannte Grenze:** `PostgresStore.updateContract()` (genutzt von `POST
/contracts/:id/confirm`) nutzt SQL `COALESCE` und kann deshalb "Feld nicht
im Patch enthalten" nicht von "Feld absichtlich auf `null` gesetzt"
unterscheiden — für den einzigen Aufrufer unkritisch (siehe Kommentar an
der Methode), aber kein generischer Patch-Mechanismus.

**Getestet:** `npm test` (Smoketest) läuft identisch gegen beide
Implementierungen — ohne `DATABASE_URL` (In-Memory, unverändertes
Verhalten) und mit `DATABASE_URL` gegen eine echte lokale Postgres-Instanz
(Daten danach per `psql` verifiziert: Nutzer/Ordner/Nachrichten/
Sicherheits-Analyse/Quarantäne/IBAN-Historie/Audit-Log landen tatsächlich
in den Tabellen, nicht nur im Prozessspeicher).

Nicht Teil dieses Schritts: Connection-Pooling-Tuning, Transaktionen über
mehrere Schreiboperationen hinweg (z.B. `insertMessage` +
`setMessageSecurity` laufen als zwei separate Queries, nicht atomar),
Datenbank-Migrationen im engeren Sinne (Schema-Änderungen an bestehenden
Spalten, nur `IF NOT EXISTS` für neue Tabellen/Indizes).

## Auth

Seit 09.09. (TERMINAL_INBOX.md, Web-Priorisierung direkt nach Persistenz;
"Automatische Abmeldung bei Spam" kam als Zwischen-Auftrag dazwischen, siehe
WEB_INBOX.md) gibt es echte, sitzungsbasierte Auth statt eines fest
verdrahteten Demo-Users. Der Contract schreibt `security: bearerAuth`
bereits seit 08.09. global vor (Commit `42a8b53`) — bis dahin wurde das nie
durchgesetzt, jede Route lief über `ensureDemoUser()`.

**Mechanismus:** `sessions`-Tabelle (Opaque-Token, kein JWT — ein einfacher
DB-Lookup reicht für diesen Umfang, keine Signaturprüfung nötig).
`middleware/auth.ts` (`requireAuth`) prüft `Authorization: Bearer <token>`
gegen `sessions`, hängt die aufgelöste `userId` an `req.userId`. Wird in
`app.ts` auf den gesamten `/v1`-Router angewendet, **außer** `routes/auth.ts`
(`POST /accounts`, `POST /auth/session`) — die beiden einzigen Endpunkte mit
`security: []` im Contract, weil man naturgemäß keinen Token verlangen kann,
um überhaupt einen zu bekommen.

**Login/Registrierung läuft über `POST /accounts` (Mail-Konto verbinden),
nicht über ein separates `/login`** — das war schon so im Contract-Kommentar
von `/auth/session` angelegt ("Login selbst passiert implizit durch den
OAuth-Flow beim Verbinden eines Mail-Kontos"), nur fehlte der Endpunkt dafür
komplett (Contract-Lücke, wie zuvor schon bei
`/messages/{messageId}/unsubscribe`). Find-or-create nach `emailAddress`:
neue Adresse → neuer User + dessen 7 Standard-Ordner
(`createSystemFoldersForUser()`, aus `ensureDemoUser()` herausgezogen);
bekannte Adresse → bestehender User/bestehendes Konto, neue Session. `POST
/auth/session` rotiert den Token einer noch gültigen Sitzung (neuer Token,
alter wird sofort ungültig — echte Rotation, keine bloße Verlängerung).

**Autorisierung (nicht nur Authentifizierung):** ein gültiger Token allein
reicht nicht — jede Route, die eine Ressource per ID lädt (Nachricht, Ordner,
Entwurf, Vertrag, Mail-Konto), prüft zusätzlich, dass die Ressource dem
angemeldeten User gehört (`403`, falls nicht — bewusst nicht `404`, um
zwischen "nicht gefunden" und "gehört jemand anderem" zu unterscheiden).
`GET /messages`/`GET /contracts`/`GET /accounts` ohne konkrete ID filtern
jetzt nach `req.userId`, statt (wie vorher) ungefiltert alles zu liefern —
unkritisch, solange es ohnehin nur den einen Demo-User gab, aber ein
notwendiger Schritt für echte Mehrbenutzerfähigkeit. `routes/messages.ts`
bündelt das in einem `requireOwnMessage()`-Helper (Nachrichten haben keine
eigene `user_id`-Spalte, nur `mail_account_id` → Besitz läuft über das
Konto). Mit einem zweiten, echten User im Smoketest verifiziert (nicht nur
behauptet), siehe unten.

**BEWUSSTE GRENZEN (kein Blocker, hier absichtlich transparent statt
stillschweigend übergangen):**
- **Kein echter OAuth-Code-Austausch (Gmail) bzw. keine echte
  IMAP-Zugangsdaten-Prüfung.** `POST /accounts` akzeptiert `provider` +
  `emailAddress`, `oauthCode`/`imapPassword` werden entgegengenommen, aber
  nicht ausgewertet — analog zum bestehenden Fixture-Adapter-Muster für den
  Mail-Sync selbst (`mail/fixtureAdapter.ts`): funktioniert ohne jede
  Konfiguration, echte Provider-Anbindung ist ein separater, späterer
  Schritt.
- **Keine sichtbare Login-UI in Web/iOS.** Web meldet sich beim ersten
  Request implizit mit einer festen Demo-Adresse an (`web/src/api.ts`,
  `ensureSessionToken()`) und hängt den erhaltenen Token an alle weiteren
  Requests — kein Retry bei 401/Ablauf. iOS bleibt unangetastet: `MockAPIClient`
  (aktuell die einzige aktive Implementierung, siehe `ios/README.md`) spricht
  ohnehin nie das echte Backend an, `RemoteAPIClient` ist weiterhin ein
  unverdrahtetes Skeleton — dort gibt es deshalb noch nichts zu verbinden.
- **Klartext-Token-Speicherung**, keine Rate-Limits gegen Brute-Force, kein
  vom Zugriffstoken getrennter Refresh-Token (siehe Kommentar an der
  `sessions`-Tabelle in `contracts/db-schema.sql`) — ausreichend für dieses
  Entwicklungsstadium, vor echtem Produktivbetrieb nachzurüsten.
- **Kein Logout-Endpoint** (Session-Invalidierung vor Ablauf) — 30 Tage
  TTL (`SESSION_TTL_MS`), sonst nur Rotation über `POST /auth/session`.
- **Web/mock-server CORS-Fund währenddessen:** der lokale Mock-Server
  (`web/mock-server/server.mjs`, kein Teil dieses Backends) erlaubte per
  `Access-Control-Allow-Headers` bisher nur `Content-Type` — der neue
  `Authorization`-Header wurde vom Browser nach einer eigentlich
  erfolgreichen CORS-Preflight-Antwort trotzdem blockiert. Im Mock-Server
  nachgezogen (`Content-Type, Authorization`), da web/README.md-Testfluss
  sonst gebrochen gewesen wäre. Das ECHTE Backend hier setzt bisher
  überhaupt keine CORS-Header (bestehende, unabhängige Lücke, nicht Teil
  dieses Schritts — Web müsste direkt aus dem Browser gegen `localhost:3000`
  sprechen, um das zu bemerken; bisher lief der Browser-Test immer nur gegen
  den Mock-Server).

**Getestet:** Backend-Smoketest um einen eigenen Auth-Block erweitert (401
ohne/mit ungültigem Token, `POST /accounts` inkl. Idempotenz bei
wiederholtem Login, `POST /auth/session` inkl. Token-Rotation + Invalidierung
des alten Tokens, sowie ein zweiter, echter User, der geprüft NICHT auf die
Nachrichten/Ordner des ersten zugreifen kann), `npm run typecheck`/`npm test`
grün. Zusätzlich manuell gegen eine echte, frische lokale Postgres-Instanz
verifiziert (`curl`): Login, Token-Refresh mit Rotation, sowie
Zwei-User-Isolation — alles wie im In-Memory-Smoketest, aber gegen echte
Tabellen. Web: `npm run build` grün, End-to-End im Browser gegen den
Mock-Server verifiziert (impliziter Login beim Laden, danach normale
Nutzung wie vorher, keine sichtbare Änderung für den User).

**Pre-existierender, unabhängiger Fund (nicht behoben, nicht Teil dieses
Schritts):** beim Testen gegen eine echte Postgres-Instanz schlägt der
bereits bestehende Migrations-Smoketest-Block ("Ordner-Umbau-Migration",
simuliert einen Bestands-User mit einem alten `wichtig`-Ordner) fehl —
`folders.system_key` hat seit dem Ordner-Umbau eine `CHECK`-Constraint, die
`'wichtig'` korrekt ablehnt, der Smoketest simuliert diesen Altzustand aber
per direktem `INSERT` gegen das AKTUELLE Schema, was gegen eine echte DB nie
so hätte vorkommen können (bei einer echten Migration hätte die Zeile mit
dem alten, damals noch gültigen Schema existiert). Gegen `InMemoryStore`
(keine Constraints) fällt das nicht auf. Verifiziert, dass dieser Fund
bereits vor diesem Schritt existierte (gleicher Fehler auf dem vorherigen
Commit). Kein Blocker für Auth selbst, aber ein Hinweis, dass der
Smoketest bisher nie vollständig gegen Postgres durchlief.

## Annahmen (nicht selbst im Contract entscheidbar, siehe SYNC.md)

- ~~`contracts/db-schema.sql` ist Postgres-DDL, aber ein DB-Server war
  nicht Teil des Auftrags/Setups.~~ **Nachgezogen (Terminal 09.09.):** siehe
  Abschnitt "Persistenz" oben — eine echte Postgres-Anbindung existiert
  jetzt, mit dem hier beschriebenen In-Memory-Verhalten als weiterhin
  gültigem Zero-Config-Fallback ohne `DATABASE_URL`.
- Kein Auth/Multi-User-Handling: `api-spec.yaml` enthält keine
  Auth-Parameter (kein `userId` in Pfaden/Query), daher arbeitet dieses
  Skeleton mit einem einzigen Demo-User (`ensureDemoUser()` in
  `src/db/store.ts`), analog zu `POST /capability-check`, dessen Body
  laut Contract ebenfalls kein `userId`-Feld hat.
- Gmail-OAuth-Consent-Flow (Autorisierung durch den End-User) ist nicht
  Teil dieses Durchstichs — der Adapter erwartet ein bereits vorhandenes
  Refresh-Token. Der eigentliche OAuth-Flow (Redirect/Callback-Route) ist
  ein späterer Schritt.
- Kein Hintergrund-Job/Webhook (Gmail Push, IMAP IDLE) — Sync läuft beim
  Serverstart und on-demand über `POST /internal/sync`
  (`src/routes/internal.ts`, **kein** Contract-Bestandteil, nur
  Betriebs-/Testhilfe für diesen Durchstich).
- `unsubscribe_actions`, `message_links`, `reminders`, `signatures`,
  `ai_provider_config` existieren in `db-schema.sql`, haben aber (noch)
  keine Entsprechung in `api-spec.yaml`. Nicht in diesem Durchstich
  implementiert — siehe "Offene Fragen" in `SYNC.md`.
- `security_audit_log` existiert seit dem Auto-Delete-Feature (siehe
  Abschnitt "Auto-Delete: adult/gambling-Spam" oben) teilweise: Write-Pfad
  über `store.logSecurityAudit()` ist da, aber weiterhin **kein**
  `GET`-Endpunkt, da `api-spec.yaml` keinen vorsieht.
- `fraud_alerts` (`contracts/db-schema.sql`) ist weiterhin nicht in
  `src/types.ts`/`src/db/store.ts` modelliert (an `messages`, nicht an
  Empfänger-Adressen geknüpft). `recipientReputation` in `POST
  /messages/draft/phishing-check` wird stattdessen seit dem
  Lookup-Adapter-Schritt (siehe "Externe Lookup-Adapter" oben) gegen
  `outgoing_send_log`/`messages`+`message_security` geprüft — ein
  plausibles, aber nicht 1:1 `fraud_alerts`-Äquivalent. Echte
  `fraud_alerts`-Anbindung wäre ein separater, noch offener Schritt.
- `send_abuse_flags` (Bot/Human-Missbrauchserkennung beim Versand,
  WEB_INBOX.md 08.09. "Ausgehender Phishing-Check im Composer") existiert
  seit Commit `a5432e6` als vollständige `CREATE TABLE` in
  `contracts/db-schema.sql` (zusammen mit `outgoing_send_log`), ist aber im
  Backend-Skeleton weiterhin nicht implementiert — `outgoing_send_log` wird
  seit dem Lookup-Adapter-Schritt zumindest als reine Historie genutzt
  (`store.outgoingSendLog`, siehe "Externe Lookup-Adapter" oben), aber ohne
  eigenen `POST`-Endpunkt zum tatsächlichen Versenden und ohne
  `send_abuse_flags`-Logik selbst. Kein eigener Versand-Pfad in diesem
  Durchstich (siehe oben, "Kein Hintergrund-Job"); siehe SYNC.md "Offene
  Fragen".

## Struktur

```
src/
  app.ts              Express-App, Router-Mounting (/v1 = Contract, sonst intern)
  index.ts             Serverstart + initialer Sync
  types.ts             interne Modelle + API-Shapes (Spiegel von db-schema.sql / api-spec.yaml)
  mappers.ts            interne Records -> API-Response-Shapes
  routes/               ein Router-Modul je api-spec.yaml-Ressource (inkl. folders.ts) + internal.ts (Health/Sync/Seed)
  db/store.ts           Store-Interface + InMemoryStore (Zero-Config-Fallback) + ensureDemoUser()
  db/postgresStore.ts   PostgresStore -- echte Persistenz, aktiv wenn DATABASE_URL gesetzt ist (siehe "Persistenz")
  mail/                 MailAdapter-Interface + Gmail/IMAP/Fixture-Implementierungen + Sync-Pipeline
  ai/                   AiAdapter-Interface (Spiegel von ai-adapter-interface.ts) + Adapter (analyzeMail() ruft @driftmail/security-classification, Rest weiterhin Mock)
  lookups/               vier externe Lookup-Adapter (Domain-/IP-Reputation, IBAN-Historie, Empfänger-Reputation), Mock-Implementierungen, siehe "Externe Lookup-Adapter"
  smoketest.ts           End-to-End-Test (npm test)
```
