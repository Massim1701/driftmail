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
`/v1/capability-check`, `/v1/trusted-senders` (GET/POST/DELETE, inkl.
Idempotenz bei erneutem Hinzufügen derselben Adresse und Besitz-Prüfung
über zwei User hinweg). Bricht mit Fehlermeldung ab, sobald eine Response
nicht zum erwarteten Contract-Format passt. Prüft zusätzlich direkt gegen
`store` (kein HTTP-Endpunkt dafür, siehe oben): den Auto-Delete-Pfad
(adult/gambling/advance_fee_scam-Spam-Fixtures werden nicht persistiert,
hinterlassen je Kategorie einen eigenen `security_audit_log`-Eintrag, ein
zweiter Sync-Lauf dedupliziert korrekt und erzeugt keinen weiteren
Eintrag), sowie die Whitelist-Wirkung (ein zweiter, frisch angelegter User
markiert einen Absender vor dem ersten Sync als vertrauenswürdig -- dessen
eigentlich phishing-artige Fixture-Mail landet danach trotzdem in
`eingang`, nicht in Quarantäne).

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
  attachments.ts` + `AttachmentScanner`): ~~echte Dateityp-/Endungsprüfung
  (`attachmentScanMock.ts`), kein echter Virenscan-Dienst — Mock, analog zu
  den externen Lookup-Adaptern~~. **Nachgezogen (Terminal 21.09., "WICHTIGE
  LUECKE ENTDECKT - echter Malware-Scan"):** siehe Abschnitt "Malware-Scan
  (echt, ClamAV)" unten — echter ClamAV-Scan + Magic-Bytes-Prüfung, jetzt
  auch für EINGEHENDE Anhänge, nicht mehr nur beim Senden. Dateiinhalt wird
  weiterhin nicht dauerhaft gespeichert (keine `content`-Spalte im
  Contract), deshalb wird ein geprüfter Anhang weiterhin nicht tatsächlich
  in die ausgehende Mail eingebettet. Siehe eigener Abschnitt "Anhänge"
  unten.
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

**Update 15.09. (`WEB_INBOX.md` "Neue Auto-Loesch-Kategorie: klassischer
Vorschussbetrug"):** dritte Auto-Delete-Kategorie `advance_fee_scam`
("Prinz aus Nigeria"-Muster) dazugekommen, gleiche Behandlung wie
`adult`/`gambling` (nicht persistieren, kein Undo) in `src/mail/sync.ts`.
Bewusst ein eigener Audit-Log-Action-Name (`auto_deleted_advance_fee_scam`
statt des bestehenden `auto_deleted_adult_gambling_spam`), damit die drei
Kategorien in `security_audit_log` unterscheidbar bleiben, ohne den
bestehenden Action-Namen (und darauf aufbauende Auswertungen/Tests) zu
ändern. Erkennung liegt in `security-classification/src/spamSubcategory.ts`
(Track B, siehe dortiges README "Design-Entscheidungen").

## Whitelist vertrauenswürdiger Absender

Seit dem Contract-Update vom 15.09. (`WEB_INBOX.md` "Whitelist fuer
vertrauenswuerdige Absender", Tabelle `trusted_senders`) kann der User eine
Absenderadresse per `POST /trusted-senders` explizit als vertrauenswürdig
markieren -- eine bewusste User-Entscheidung, **keine** automatische
Klassifikation.

**Wirkung (`src/mail/sync.ts`):** direkt nach `ai.analyzeMail()`, VOR den
externen Lookups und dem Auto-Delete-Pfad, wird geprüft, ob
`mail.fromAddress` auf der Whitelist des Kontobesitzers steht
(`store.isTrustedSender()`). Falls ja, werden `classification` auf
`"safe"` und `spamSubcategory` auf `null` überschrieben -- die Mail landet
danach unabhängig vom sonstigen Auth-/Link-/Inhalts-Signal in `eingang`,
auch wenn `analyzeMail()` sie eigentlich als `phishing` oder `spam`
eingestuft hätte. Bewusst VOR (nicht NACH) dem Auto-Delete-Pfad geprüft,
damit eine whitelisted Adresse mit z.B. `advance_fee_scam`-artigem Inhalt
nicht trotzdem automatisch gelöscht wird, bevor die Whitelist greifen kann.

**Grenzen (bewusst, kein Blocker):**
- Wirkt nur für **künftige** Mail ab dem Zeitpunkt des Hinzufügens, kein
  rückwirkendes Neu-Einordnen bereits importierter Nachrichten (so auch im
  Auftrag spezifiziert).
- Adressvergleich ist case-insensitiv (E-Mail-Adressen sind lokal meist
  case-insensitiv), Adresse wird deshalb kleingeschrieben gespeichert
  (`InMemoryStore`/`PostgresStore` verhalten sich hier identisch, siehe
  Kommentare dort). Kein Domain-Wildcard (z.B. `*@firma.de`) -- nur exakte
  Adressen, wie im Auftrag beschrieben.
- `POST /trusted-senders` ist idempotent (find-or-create über
  `UNIQUE(user_id, sender_address)`): erneutes Hinzufügen derselben Adresse
  liefert `201` mit dem bestehenden Eintrag statt eines Konflikts.

**Übergabe:** Track C/F (Web-/iOS-UI für "Absender als vertrauenswürdig
markieren"-Button in der Detailansicht sowie eine Verwaltungsansicht für die
Whitelist) ist bewusst **nicht** Teil dieses Schritts -- Contract + Track A/B
(Backend-Endpunkte + Wirkung in der Sync-Pipeline) sind vollständig, siehe
`SYNC.md`.

## Anzeigename-Spoofing / Reply-To-Mismatch / "Erster Kontakt"

Seit dem Contract-Update vom 19.09. (`WEB_INBOX.md` 15.09., "6 Sicherheits-
Ergaenzungen" Punkt 1/2/4) drei zusätzliche, unabhängige Phishing-Signale.

**1) Anzeigename-Spoofing (Track B, `displayNameSpoofingDetected`):**
Bekannter Markenname im Absender-Anzeigenamen (z.B. "PayPal Support"), aber
die tatsächliche Absenderdomain gehört nicht zu dieser Marke --
`security-classification/src/displayNameSpoofing.ts`, Startliste
bekannter Marken (PayPal, Amazon, Apple, Microsoft, Google, mehrere
deutsche Banken, DHL, Netflix), bewusst nicht erschöpfend.

**2) Reply-To-Mismatch (Track B, `replyToMismatchDetected`):**
Reply-To-Header vorhanden UND dessen Domain weicht von der From-Domain ab
-- klassischer BEC-Trick. Nur der Domain-Vergleich zählt (nicht die volle
Adresse), ein anderer lokaler Teil auf derselben Domain (z.B. "no-reply@"
vs. "support@" bei derselben Firma) ist üblich und wird NICHT geflaggt --
`security-classification/src/replyToMismatch.ts`.

Beide Signale fließen in `classify()` (`classification.ts`) mit eigenem
Gewicht in den `phishingScore` ein (0.3 bzw. 0.25, siehe dortiger
Kommentar) und verhindern zusätzlich die "safe"-Einstufung, wenn sie allein
auftreten. Neue Spalten `message_security.display_name_spoofing_detected`/
`reply_to_mismatch_detected` (Default `false`).

**Fund beim Bauen:** die `FixtureMailAdapter`-Testdaten (`mail/
fixtureAdapter.ts`) hatten bisher bei KEINER Fixture einen echten
"From"-Header in `rawHeaders`, obwohl mehrere Erkennungsfunktionen (u.a.
die bereits bestehende `detectHomoglyphs`) genau den erwarten -- nur die
strukturierten Felder `fromAddress`/`fromDisplayName` waren gesetzt. Echte
Gmail-/IMAP-Adapter kopieren alle Header 1:1 aus der echten Mail, dort gab
es die Lücke nie. Nachgezogen: jede Fixture hat jetzt einen passenden
"From"-Header (Fixture 2 zusätzlich "Reply-To", passend zu ihrem
`replyToAddress`-Feld), Fixture 6 zeigt jetzt bewusst BEIDE unabhängigen
Phishing-Signale (Homoglyph im Body-Link + Anzeigename-Spoofing im Header).

**3) "Erster Kontakt"-Kennzeichnung (Track A, `MessageDetail.isNewSender`):**
`true`, wenn es für das Konto keine ANDERE Nachricht mit derselben
`fromAddress` gibt (`store.hasOtherMessageFromAddress()`). Kein neues
Feld/Cache, zur Laufzeit bei `GET /messages/{messageId}` abgeleitet -- wie
im Auftrag vorgesehen. Bewusste Design-Entscheidung: der Vergleich prüft
nur "existiert eine andere Nachricht", nicht "existiert eine ÄLTERE
Nachricht" -- bei nachträglich eintreffender älterer Mail (z.B. erneuter
Sync mit größerem `limit`) kann sich `isNewSender` für eine bereits
gesehene Nachricht rückwirkend auf `false` ändern. Für den Zweck (Warnhinweis
bei neuen Absendern) unkritisch, aber bewusst dokumentiert statt
stillschweigend in Kauf genommen. Ergänzt sich mit der Whitelist (siehe
oben) -- die Client-UI kombiniert `isNewSender=true` mit "Absender nicht
auf der Whitelist" für den eigentlichen Badge, das ist reine UI-Logik
(Backend liefert nur das Rohsignal).

**Übergabe:** Track C/F (UI-Kennzeichen "Neuer Absender" in Nachrichtenliste/
-detailansicht) bewusst **nicht** Teil dieses Schritts, siehe `SYNC.md`.

**Tests:** `security-classification` neue Dateien `displayNameSpoofing.ts`/
`replyToMismatch.ts` mit je eigenem Testfile (12 neue Tests), plus
Integrationstests in `index.test.ts`. Backend-Smoketest: Fixture 6 beweist
`displayNameSpoofingDetected`, Fixture 2 beweist `replyToMismatchDetected`,
Fixture 1/4 beweisen die jeweilige Negativabgrenzung (kein Fehlalarm bei
legitimem Anzeigenamen bzw. fehlendem Reply-To). `isNewSender` über Fixture
1/4 (beim ersten Kontakt `true`) sowie eine direkt eingefügte zweite
Nachricht desselben Absenders (danach `false` für BEIDE Nachrichten dieses
Absenders) verifiziert.

**Nebenbei gefunden und behoben (nicht Teil des eigentlichen Auftrags, aber
notwendig für zuverlässige Tests):** `GET /messages` (`listMessages()`)
sortiert nur nach `received_at DESC` ohne Tiebreaker -- mehrere Fixtures
teilen denselben `receivedAt`-Wert (`daysAgo(0)`), wodurch die Auswahl von
"der ersten Nachricht" in `smoketest.ts` gegen echtes Postgres nicht
deterministisch war (reproduzierbar beobachtet: traf einmal Fixture 4 statt
der bisher immer unauffälligen Fixture 2/6, was spätere Fixture-4-
spezifische Assertions zum Flackern brachte). Smoketest jetzt bewusst auf
Fixture 2 fixiert statt auf eine mehrdeutige Sortierposition. Die
zugrundeliegende fehlende Tiebreaker-Sortierung selbst ist NICHT behoben
(kein Contract-/API-Verhalten geändert, nur der Test robuster gemacht) --
falls das an anderer Stelle (z.B. Pagination) relevant wird, bitte dort
gesondert aufgreifen.

## IBAN-Wechsel im selben Thread

Seit dem Contract-Update vom 19.09. (`WEB_INBOX.md` 15.09., "6 Sicherheits-
Ergaenzungen" Punkt 3) ein weiteres, thread-bezogenes Betrugssignal.

**Contract-Lücke entdeckt beim Bauen:** der Auftrag setzt eine
"in_reply_to_message_id-Kette" für empfangene Mail voraus, die es bisher
NICHT gab -- `messages` (empfangene Mail) hatte anders als `drafts`
(Entwürfe) keine Thread-Verknüpfung. Nachgezogen (additive Contract-
Ergänzung, keine Vorabankündigung nötig laut SYNC.md-Regel "kleinere
Ergänzungen"): `messages.in_reply_to_message_id` (self-referencing FK,
gleiches Muster wie bei `drafts`). Wird beim Sync aus dem "In-Reply-To"-
Header aufgelöst (`src/mail/inReplyTo.ts`, `parseInReplyToHeader()`) gegen
`message_id_header` desselben Kontos (`store.findMessageByHeader()`) --
`null`, wenn kein Header vorhanden ist oder der Thread-Vorgänger nicht
synchronisiert wurde (externer/unsynchronisierter Thread-Start), gleiches
Grenzen-Muster wie überall sonst in diesem Backend. `POST /messages/send`
befüllt das Feld ebenfalls (bereits vorhandene, aufgelöste
`inReplyToMessageId` aus dem Request-Body wiederverwendet).

**Erkennung (`src/lookups/ibanThreadCheck.ts`, `StoreIbanThreadCheck`):**
reale Implementierung von Anfang an, kein Mock -- arbeitet nur gegen den
eigenen Store, kein externer Dienst beteiligt (analog zu
`ibanHistoryCheck.ts`). Geht die `in_reply_to_message_id`-Kette der
aktuellen Nachricht rückwärts durch (bis zu 50 Ebenen, reine
Sicherheitsgrenze gegen eine unerwartet lange/zyklische Kette), extrahiert
je Vorgänger die IBAN-Kandidaten aus dessen `bodyText` (gleiche einfache
Regex-Erkennung wie `ibanHistoryCheck.ts`, kein Mod-97-Check nötig für
diesen Vergleich) und meldet `true`, sobald eine frühere Nachricht eine
IBAN enthielt, die NICHT unter den IBANs der aktuellen Nachricht ist.

**Abgrenzung zu `containsNewIban`/`ibanHistoryCheck` (bewusst zwei
unabhängige Signale, nicht zusammengelegt):** `containsNewIban` fragt "hat
DIESER Absender diese IBAN schon einmal genannt" (sender-bezogen, über alle
Threads hinweg). `ibanChangedInThread` fragt "hat sich die IBAN INNERHALB
DIESES Threads geändert" (thread-bezogen). Ein klassischer Rechnungsbetrug-
Fall (Angreifer antwortet im bestehenden Rechnungs-Thread mit neuer IBAN)
löst typischerweise BEIDE Signale aus, aber nicht jeder Fall von einem
überschneidet sich mit dem anderen -- z.B. ein Absender, der in zwei
komplett getrennten Threads unterschiedliche (jeweils legitime) IBANs
nennt, triggert `containsNewIban`, aber NICHT `ibanChangedInThread`.

**Tests:** Backend-Smoketest, zweiteiliger Fixture-Thread (Fixture 8:
Original-Rechnung mit IBAN A, Fixture 9: Antwort per "In-Reply-To" mit
IBAN B) -- verifiziert sowohl die Header-Auflösung
(`messages.in_reply_to_message_id`) als auch `ibanChangedInThread=false`
für Fixture 8 (erste Nachricht, kein Vorgänger) und `=true` für Fixture 9.
Bewusst technisch "sauber" gehalten (SPF pass, keine weiteren Signale) --
zeigt, dass dieser Check Fälle auffängt, die die übrigen Signale allein
nicht erkennen würden.

**Übergabe:** Track C/F (UI-Warnhinweis bei erkanntem IBAN-Wechsel) bewusst
**nicht** Teil dieses Schritts, siehe `SYNC.md`.

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
  `messages`-Zeile existiert. Status spiegelt seit dem Nachtrag unten das
  ECHTE Ergebnis des Abmelde-Aufrufs (`'confirmed'`/`'failed'`,
  `user_confirmed_at = now()` nur bei Erfolg), keine Rückfrage nötig, da hier
  kein User in der Schleife ist. `classification === "phishing"` löst NIE
  automatisch aus, auch wenn ein (dann meist gefälschter)
  `List-Unsubscribe`-Header vorhanden ist — ein Angreifer könnte sonst über
  einen frei erfundenen Header serverseitig einen Netzwerk-Call/E-Mail-Versand
  an eine beliebige Adresse auslösen.
- **Manuell** (`POST /messages/:messageId/unsubscribe`, `src/routes/
  messages.ts`): prüft, ob die (bereits gespeicherte) Nachricht einen
  gültigen `List-Unsubscribe`-Header hat — unabhängig von ihrer
  Klassifikation, da hier explizit der User selbst entscheidet. `404` wenn die
  `messageId` unbekannt ist, `400` wenn kein gültiger Header vorliegt, sonst
  `200` mit dem tatsächlichen Ergebnis (`'confirmed'`/`'failed'`) des sofort
  ausgeführten Abmelde-Aufrufs.

**Header-Parsing** (`src/mail/listUnsubscribe.ts`,
`parseListUnsubscribeHeader()`): liest `mailto:`/`https:`-URIs aus den
kommagetrennten `<...>`-Einträgen von RFC 2369 (`List-Unsubscribe`), analog zu
RFC 8058, sowie den `List-Unsubscribe-Post`-Header (RFC 8058, bestätigt den
sicheren One-Click-POST-Mechanismus).

### [2026-09-21] Nachtrag: echter Abmelde-Aufruf (WEB_INBOX.md 21.09.
"LUECKE SCHLIESSEN - echter Abmelde-Aufruf")

**Fund:** bis zu diesem Schritt war der komplette Mechanismus oben rein
syntaktisch — der Header wurde geparst, `status` aber blind auf
`'confirmed'` gesetzt (automatischer Pfad) bzw. auf einen dauerhaften
`'pending_confirmation'`-Endzustand ohne je folgenden Schritt (manueller
Pfad), OHNE dass je eine Mail verschickt oder eine URL aufgerufen wurde.
Eine bereits als "fertig" kommunizierte Funktion war damit faktisch eine
Attrappe — von Massimo beim Nachfragen aufgedeckt.

**`performUnsubscribe()`** (`src/mail/listUnsubscribe.ts`), jetzt von
beiden Pfaden genutzt:

- **`mailto:`-Ziel:** eine Mail (Betreff aus einem etwaigen
  `?subject=`-Query-Parameter der mailto-URI, sonst `"unsubscribe"`,
  Text `"unsubscribe"`) über den bestehenden Provider-Sende-Mechanismus
  (`MailAdapter.sendMail()` des Kontos, intern genutzt — nicht über den
  öffentlichen `POST /messages/send`-Pfad, kein Phishing-Check/
  `outgoing_send_log`-Eintrag dafür nötig, das ist kein User-Compose).
- **`https:`-Ziel:** ein echter HTTP-Request — `POST` mit Body
  `List-Unsubscribe=One-Click` (RFC 8058 "One-Click"), wenn der
  `List-Unsubscribe-Post`-Header vorhanden ist, sonst `GET` als Fallback.
- **Sicherheitsbewusst umgesetzt** (wie im Auftrag verlangt): 8-Sekunden-
  Timeout (`AbortController`) pro Request, damit ein hängender Server nicht
  den Mail-Sync blockiert. Redirects werden manuell verfolgt (`redirect:
  "manual"`), maximal 3 Hops, und NUR wenn Ziel-Host === Ursprungs-Host der
  `List-Unsubscribe`-URL — ein Redirect auf eine fremde Domain wird
  abgelehnt (`status: 'failed'`) statt automatisch verfolgt zu werden (ein
  Absender könnte sonst über eine Redirect-Kette auf beliebige interne/
  fremde Ziele zeigen, SSRF-artiges Risiko).
- Jeder Fehlerpfad (Netzwerkfehler, Timeout, 4xx/5xx, fremde Redirect-
  Domain, kein `mailto:`/`https:`-Ziel) liefert `{ status: 'failed', error
  }` statt zu werfen — `maybeAutoUnsubscribeFromSpam()` darf den restlichen
  Mail-Sync nie blockieren/abbrechen.

**`unsubscribe_actions.status`** bekommt den neuen Wert `'failed'`
(`contracts/db-schema.sql`, echte Migration in `postgresStore.ts`
`migrateUnsubscribeActionsStatusCheck()` — anders als die meisten anderen
Tabellen in diesem Schritt war diese schon von echtem Code beschrieben,
eine reine `CREATE TABLE IF NOT EXISTS`-Änderung hätte auf einer
bestehenden DB nicht gewirkt). Der manuelle Endpunkt liefert jetzt nur noch
`'confirmed'`/`'failed'` (kein `'pending_confirmation'`/`'rejected'` mehr —
der Aufruf ist synchron, das Ergebnis steht sofort fest).

**Tests:** `smoketest.ts` nutzt bewusst die vorhandenen Fixtures, um echtes
Verhalten zu beweisen, nicht nur zu behaupten: Fixture 3s `mailto:`-Ziel
läuft über den `FixtureMailAdapter` (simuliert in Tests immer einen
erfolgreichen Versand) → `'confirmed'`. Fixture 5s `https:`-Ziel zeigt auf
eine frei erfundene, nicht auflösbare Test-Domain → der jetzt echte
HTTP-Aufruf schlägt zwangsläufig fehl (DNS-Fehler) → `'failed'` — genau der
Beweis, dass hier wirklich ein Netzwerk-Request passiert (vorher wäre das
blind `'confirmed'` gewesen, egal ob die Domain existiert). Migration
zusätzlich manuell gegen eine simulierte Alt-Schema-DB verifiziert (alte
3-Wert-Constraint → neue 4-Wert-Constraint). Grün ohne UND mit
`DATABASE_URL` gegen frisches Postgres.

**Übergabe an Track C/F:** `UnsubscribeStatus`/der entsprechende Web-Typ
verlieren `pending_confirmation`/`rejected`, bekommen `failed` -- beide
Clients zeigen bei `failed` jetzt einen "Erneut versuchen"-Button statt
den User mit einer stillen/falschen "Abgemeldet"-Anzeige hängenzulassen
(war vorher ein Bug-in-Wartestellung: der bisherige Zwei-Werte-Ternary
`status === 'pending_confirmation' ? ... : "Abgemeldet"` hätte einen
künftigen dritten Wert fälschlich als "Abgemeldet" angezeigt).

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
   (`to` + `cc` + `bcc`, dedupliziert) über `store.recordOutgoingSend()` — die
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

### [2026-09-21] Nachtrag: CC/BCC (WEB_INBOX.md 21.09. "CC/BCC beim Verfassen")

`POST /messages/send` akzeptiert jetzt ein optionales `bcc`-Feld (Array von
Adressen, wie `cc`). Anders als `cc` taucht `bcc` in keinem sichtbaren Header
der versendeten Mail auf:

- **Gmail:** die rohe RFC822-Mail bekommt intern trotzdem einen `Bcc:`-Header
  gesetzt — genau das macht auch Gmails eigener Web-Compose-Pfad. Gmails
  ausgehende Zustellung entfernt diesen Header vor der Auslieferung an die
  `To`/`Cc`-Empfänger (Standard-Verhalten jedes Mailservers), die
  Bcc-Adresse bekommt die Mail trotzdem zugestellt. Ein separater
  API-Parameter dafür existiert bei der Gmail-API nicht.
- **IMAP/SMTP:** `nodemailer` unterstützt `bcc` nativ über den SMTP-Envelope
  (`RCPT TO`) — dort ist die Trennung von Header und Umschlag ohnehin die
  normale Funktionsweise, kein Sonderfall nötig.

`bcc`-Empfänger fließen wie `to`/`cc` in den `outgoing_send_log` ein (Grundlage
für `recipientReputation`). **Tests:** `src/smoketest.ts` prüft einen Versand
mit gesetztem `cc` + `bcc` (200) und dass der `bcc`-Empfänger anschließend über
`store.hasSentTo()` bekannt ist.

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

**Scan-Logik:** austauschbares `AttachmentScanner`-Interface
(`src/lookups/types.ts`), produktiv verdrahtet mit
`src/lookups/attachmentScanClamAv.ts` (echter ClamAV-Scan + Magic-Bytes-
Prüfung, siehe Abschnitt "Malware-Scan (echt, ClamAV)" weiter unten für
die vollen Details). ~~KEIN echter Virenscan (kein ClamAV-/VirusTotal-
Aufruf) — reine Dateiendungs-/Dateiname-Heuristik~~ **Nachgezogen (Terminal
21.09.).** Die frühere Mock-Implementierung (`attachmentScanMock.ts`,
reine Dateiendungs-Blockliste + deterministischer `virus`/`malware`-
Dateiname-Trigger) bleibt als Referenz/für Tests ohne laufenden
ClamAV-Daemon im Repo, ist aber nicht mehr produktiv verdrahtet.

**Eine bewusste, dokumentierte Grenze dieses Schritts (kein Blocker, aber
nicht stillschweigend als "fertig" markiert):**

**Der Dateiinhalt selbst wird nicht dauerhaft gespeichert.**
`message_attachments` hat laut Contract keine `content`-Spalte (eine
echte Implementierung würde Objektspeicher wie S3 nutzen, kein DB-Feld).
[2026-09-21] **Nachgezogen:** der Scan selbst läuft inzwischen echt gegen
die tatsächlichen Bytes (`multer`-Memory-Storage hält den Upload während
des Requests, siehe Abschnitt "Malware-Scan (echt, ClamAV)") — nur *nach*
dem Scan werden die Bytes nicht weiter aufgehoben. Folge weiterhin
unverändert: `POST /messages/send` bettet geprüfte Anhänge aktuell
**nicht tatsächlich** in die ausgehende Mail ein (die Bytes sind nach dem
Upload-Request nicht mehr vorhanden) — der Endpunkt stellt nur sicher,
dass kein ungeprüfter/gefährlicher Anhang "mitgeschickt" werden darf.
Echte Speicherung + MIME-Einbettung beim Versand ist ein späterer Schritt.

**[2026-09-10] Nachgezogen (Ordner-Umbau, WEB_INBOX.md 09.09.):**
`store.linkAttachmentsToMessage()` wird jetzt tatsächlich aufgerufen —
seit der "gesendet"-Systemordner existiert, gibt es die dafür nötige
lokale `messages`-Zeile (siehe Abschnitt "Versand" oben, Punkt 5). Der
`TODO`-Kommentar dazu in `routes/messages.ts` ist entfernt.

### [2026-09-15] Sensible-Dokument-Erkennung (Fotos von Ausweisen/Kreditkarten)

WEB_INBOX.md 15.09. "Sensible-Daten-Erkennung um Fotos von Ausweisen/
Kreditkarten erweitern": Erweiterung der bestehenden Text-Erkennung (IBAN/
Kreditkarte im Composer-Text, siehe `@driftmail/security-classification`)
um Bild-Anhänge. Neuer Nachbearbeitungsschritt in `POST /attachments`
(`src/attachments/`), läuft NACH dem bestehenden Malware-/Dateityp-Scan,
nur bei `scan_status='clean'` (ein bereits blockiertes Bild bekommt ohnehin
die dominante Warnung, ein zusätzlicher OCR-Lauf wäre verschwendete Arbeit).

**Architektur (Auftrag: "OCR statt neues Bildmodell, bestehende
Text-Pattern-Erkennung wiederverwenden"):**

1. `src/attachments/types.ts` — `OcrAdapter`-Interface, gleiches
   austauschbares Adapter-Muster wie `AiAdapter`/die externen Lookups.
2. `src/attachments/tesseractOcrAdapter.ts` — **echte** Implementierung
   über `tesseract.js` (WASM, läuft lokal/offline, kein API-Key). Anders
   als bei den externen Lookups (WHOIS/Spamhaus/Fraud-DB brauchen echte,
   hier nicht vorhandene Zugangsdaten) ist Bild-zu-Text-Erkennung ohne
   externen Dienst möglich — deshalb echt gebaut, kein Mock. Nur das
   Englisch-Sprachmodell geladen (`eng`, nicht `deu+eng`): beide erkannten
   Muster sind kein natürlicher Fließtext, sondern strukturierter Code
   (Kreditkarten-Ziffern, MRZ laut ICAO 9303 ohnehin sprachneutral) — ein
   zusätzliches deutsches Wörterbuchmodell verschlechtert die Erkennung
   hier nachweislich (siehe Kommentar in der Datei, lokal reproduziert: mit
   `deu+eng` wurde eine lange MRZ-"<"-Füllzeichen-Folge fälschlich zu
   "Z"/"E"-Zeichen korrigiert, mit reinem `eng` blieb der Text sauber).
3. `security-classification/src/mrzDetection.ts` (**neu**, Track B) —
   erkennt die MRZ (Machine Readable Zone, ICAO 9303) im OCR-Text: zwei
   aufeinanderfolgende Zeilen mit MRZ-typischer Form (Länge 26–50 Zeichen,
   nur `A-Z0-9<`, mindestens 20% `<`-Füllzeichen). Bewusst KEINE
   Prüfziffern-Validierung (anders als Luhn/IBAN-Mod-97) — eine echte,
   fotografierte/OCR-gescannte MRZ hat unvermeidbar einzelne Fehllesungen,
   eine strikte Prüfziffernprüfung würde genau die echten Treffer meist
   verwerfen. Stattdessen toleranter Formheuristik-Ansatz, mit echten
   OCR-Fehlerfällen getestet (siehe `mrzDetection.test.ts`).
4. `src/attachments/sensitiveDocumentScan.ts` — Orchestrierung: nur für
   `image/jpeg`/`image/png` (OCR-Versuch), OCR-Text durch
   `detectCreditCard()` (bereits vorhanden, Luhn-Algorithmus) und
   `detectMrz()` (neu, s.o.) geschickt. Treffer-Priorität bei (seltenem)
   Doppeltreffer: `credit_card` vor `id_document`, willkürlich aber
   dokumentiert (Contract erlaubt nur einen Enum-Wert, kein Array).

**Contract-Ergänzung** (kleine, additive Änderung wie üblich hier
dokumentiert): `message_attachments.contains_sensitive_document TEXT
CHECK (IN 'none','credit_card','id_document') DEFAULT 'none'`, `POST
/attachments`-Response um `containsSensitiveDocument` ergänzt. NICHT
blockierend, reiner Warnhinweis — exakt gleiches Prinzip wie
`containsSensitiveData` beim Draft-Phishing-Check.

**Bewusste Grenze — `heic` nicht unterstützt:** die Spec nennt explizit
`jpg/png/heic` als Bildformate. `heic` ist von `tesseract.js` nicht direkt
lesbar (bräuchte eine vorgeschaltete Konvertierung, z.B. `libheif`) —
bewusst nicht Teil dieses Schritts. Ein `heic`-Anhang bekommt ehrlich
`'none'` (kein OCR-Versuch, kein geratenes Ergebnis), keinen Fehler.

**Bewusste Grenze — nur Backend, kein iOS-Vision-Framework-Pfad:** der
Auftrag nennt als mögliche OCR-Quelle für iOS "Apples Vision-Framework
(`VNRecognizeTextRequest`), läuft on-device". Nicht gebaut: `POST
/attachments` ist bereits die EINE zentrale Stelle, über die Anhänge von
JEDER Plattform laufen (iOS hat keinen eigenen Attachment-Upload-Pfad,
siehe `ios/README.md`) — ein zusätzlicher on-device-Vorab-Check auf iOS
wäre eine rein lokale Optimierung/Duplikation desselben, bereits
funktional vollständigen Backend-Scans, kein für diesen Schritt nötiger
Bestandteil. Könnte ein späterer, eigenständiger iOS-Schritt sein (z.B. um
den Upload eines erkannt sensiblen Bildes gar nicht erst anzustoßen), ist
hier aber bewusst nicht mitgebaut.

**Ressourcen-Detail (echter Fund, nicht nur Design):** `tesseract.js`
erzeugt bei der ersten Nutzung einen `worker_threads`-Worker, der den
Node-Prozess am Leben hält — `server.close()` allein reicht in
`smoketest.ts` NICHT zum sauberen Prozessende (Symptom: der Testlauf
"hängt" nach dem letzten `console.log`, obwohl alle Assertions schon
bestanden haben). `OcrAdapter.terminate?()` ergänzt, `smoketest.ts` ruft
es im `finally`-Block nach `server.close()` auf. Ein echter, dauerhaft
laufender Server-Prozess (`index.ts`) braucht das nicht.

**Tests:** drei echte Bild-Fixtures (`test-fixtures/*.png`, per
Chrome-Rendering erzeugt, keine handgezeichneten Platzhalter) — ein
Kreditkarten-Foto (Luhn-gültige Testnummer `4539 1488 0343 6467`), ein
Passfoto mit MRZ-Block, ein unauffälliges Foto ohne jedes Muster. Alle drei
laufen durch die ECHTE OCR-Pipeline (kein Mock), Ergebnis
(`credit_card`/`id_document`/`none`) wird geprüft. Zusätzlich: ein
Nicht-Bild-Anhang bekommt `'none'` ohne OCR-Versuch (MIME-Type-Weiche).
`security-classification`: 7 neue Tests für `detectMrz()` (u.a. gegen
echten, per `tesseract.js` erzeugten verrauschten OCR-Text, nicht nur
sauberen Idealfall). `npm run typecheck`/`npm test` (beide Pakete) grün,
zusätzlich gegen eine echte, frische lokale Postgres-Instanz verifiziert.

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
- ~~**Kein echter OAuth-Code-Austausch (Gmail) bzw. keine echte
  IMAP-Zugangsdaten-Prüfung.** `POST /accounts` akzeptiert `provider` +
  `emailAddress`, `oauthCode`/`imapPassword` werden entgegengenommen, aber
  nicht ausgewertet.~~ **Für Gmail nachgezogen (Terminal, 10.09.):** siehe
  neuer Abschnitt "Echter Google-Login" unten — `POST /accounts` bleibt nur
  noch als Fallback (kein Google-OAuth konfiguriert) und für `provider=imap`
  (dort weiterhin ungeprüft, analog zum Fixture-Adapter-Muster für den
  Mail-Sync selbst).
- ~~**Keine sichtbare Login-UI in Web/iOS.**~~ **Für Web nachgezogen
  (Terminal, 10.09.):** siehe "Echter Google-Login" unten. iOS bleibt
  unangetastet: `MockAPIClient` (aktuell die einzige aktive Implementierung,
  siehe `ios/README.md`) spricht ohnehin nie das echte Backend an,
  `RemoteAPIClient` ist weiterhin ein unverdrahtetes Skeleton.
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

**Pre-existierender, unabhängiger Fund — behoben (15.09., WEB_INBOX.md
14.09. "FREIGABE", Punkt 2):** beim Testen gegen eine echte Postgres-Instanz
schlug der bereits bestehende Migrations-Smoketest-Block
("Ordner-Umbau-Migration", simuliert einen Bestands-User mit einem alten
`wichtig`-Ordner) fehl — `folders.system_key` hat seit dem Ordner-Umbau eine
`CHECK`-Constraint (`folders_system_key_check`), die `'wichtig'` korrekt
ablehnt, der Smoketest simulierte diesen Altzustand aber per direktem
`INSERT` gegen das AKTUELLE Schema.

**Ursache (verifiziert, nicht nur vermutet):** auf einer frisch aus
`contracts/db-schema.sql` aufgesetzten Test-DB gilt die verschärfte
Constraint von Anfang an — eine Zeile mit `'wichtig'` kann dort nie
entstehen. Auf einer ECHTEN, bereits vor dem Ordner-Umbau angelegten
Produktions-DB kann so eine Zeile aber sehr wohl noch existieren: `CREATE
TABLE ... IF NOT EXISTS` (siehe Kopfkommentar von `db-schema.sql`) wendet
eine nachträglich verschärfte Constraint nie rückwirkend auf eine bereits
bestehende Tabelle an. Der Smoketest simulierte also nicht den echten
Altzustand, sondern einen auf frischem Schema unmöglichen Zwischenzustand.

**Fix:** `PostgresStore.runWithRelaxedSystemKeyConstraint()`
(`src/db/postgresStore.ts`) entfernt die Constraint für die Dauer des
simulierten Alt-User-Szenarios (`ALTER TABLE ... DROP CONSTRAINT IF
EXISTS`) und stellt sie danach wieder her (`ALTER TABLE ... ADD CONSTRAINT`)
— bildet damit exakt nach, was auf einer echten Alt-DB der Fall wäre: die
Zeile mit `'wichtig'` existiert, bis `migrateLegacySystemFolders()` sie
aufräumt, danach gilt die Constraint wie gewohnt. `smoketest.ts` ruft das
nur für `store instanceof PostgresStore` auf; gegen `InMemoryStore` (kein
echtes Constraint-Konzept) läuft derselbe Code unverändert direkt.

**Verifiziert (nicht nur behauptet):** gegen eine frische lokale
Postgres-16-Instanz (`DATABASE_URL` gesetzt, `npm test`) läuft der komplette
Smoketest jetzt grün durch, inkl. des Migrations-Blocks. Danach per `psql`
geprüft: die Constraint ist wiederhergestellt (`\d folders` zeigt
`folders_system_key_check`), die simulierte Alt-Zeile ist weg, ein erneutes
manuelles `INSERT` mit `system_key='wichtig'` wird korrekt abgelehnt. Damit
läuft der Smoketest jetzt erstmals wirklich vollständig gegen echtes
Postgres durch, nicht nur teilweise wie zuvor dokumentiert.

### Echter Google-Login (10.09., WEB_INBOX.md "Antwort auf die zwei Fragen zu Auth")

Massimo hat beide offenen Fragen aus dem vorigen Auth-Schritt beantwortet:
echter Gmail-OAuth-Flow (er richtet ein Google-Cloud-Projekt ein) UND
Allowlist statt freier Registrierung. Beides umgesetzt:

**Mechanismus:** Server-seitiger OAuth-Redirect-Flow, kein clientseitiger
Code-Austausch — der Browser navigiert (nicht `fetch`) zu `GET
/auth/google/start`, das Backend leitet direkt zu Googles Consent-Screen
weiter. Nach Zustimmung landet der Browser bei `GET
/auth/google/callback?code=...`, das Backend tauscht den Code serverseitig
gegen Tokens (`googleapis`, derselbe `google.auth.OAuth2`-Client wie
`mail/gmailAdapter.ts` — ein Google-Cloud-Projekt für Login UND Sync, wie
von Massimo vorgeschlagen), liest die **verifizierte** E-Mail-Adresse über
Googles eigenen `oauth2.userinfo.get()`-Endpoint (nie vom Client vertraut —
gleiches Prinzip wie `userId` serverseitig aus dem Session-Token statt aus
Body/Query/Pfad), prüft sie gegen die Allowlist, legt bei Erstanmeldung
User + Mail-Konto + Standard-Ordner an (Refresh-Token landet in
`mail_accounts.encrypted_oauth_token` — künftige echte Gmail-Sync-Anbindung
für dieses Konto kann diesen direkt verwenden, statt wie bisher nur über die
einzelne `GMAIL_REFRESH_TOKEN`-Env-Var) und leitet danach IMMER zu
`FRONTEND_URL/auth/callback` weiter, mit `?token=...` bei Erfolg oder
`?error=<code>` bei Fehler. Mögliche `error`-Codes:
`oauth_not_configured`, `missing_code`, `token_exchange_failed`,
`userinfo_failed`, `email_not_verified`, `not_allowlisted`.

**Scopes** (Consent-Screen, siehe `.env.example`-Kommentar):
`openid email profile` (verifizierte Identität) +
`gmail.readonly gmail.modify` (bestehender Sync) + `gmail.send` (`POST
/messages/send`).

**Allowlist** (`src/auth/allowlist.ts`, `ALLOWED_EMAILS`-Env-Var,
kommagetrennt): greift an JEDER Stelle, an der ein neuer User entstehen
kann — sowohl `GET /auth/google/callback` als auch der `POST
/accounts`-Fallback, sonst wäre sie nur eine halbe Absicherung. Bewusst
keine eigene DB-Tabelle (wie in der Antwort als Alternative genannt): eine
von Massimo per Hand gepflegte Handvoll Adressen braucht kein Laufzeit-CRUD,
ein Server-Neustart nach Env-Änderung reicht. Nicht gesetzt → jede Adresse
erlaubt (Zero-Config-Dev-Fallback, gleiches Muster wie
`DATABASE_URL`/Gmail-Sync-Envs) — **muss vor einem öffentlich erreichbaren
Deploy gesetzt werden**, sonst kann sich jede beliebige Google-Adresse
selbst registrieren. Google deckt die Allowlist für die Login-Prüfung selbst
teilweise bereits ab (Consent-Screen im "Testing"-Status akzeptiert ohnehin
nur eingetragene Test-User), die serverseitige Prüfung ist die zusätzliche,
von Google unabhängige Absicherung, die Massimo explizit wollte (siehe
WEB_INBOX.md).

**An Massimo für das Google-Cloud-Projekt (siehe `.env.example`):**
Redirect-URI muss exakt `GOOGLE_OAUTH_REDIRECT_URI` entsprechen, für lokale
Entwicklung z.B. `http://localhost:3000/v1/auth/google/callback`. Scopes
siehe oben.

**Web:** `web/src/api.ts` verwaltet den Token jetzt explizit (nicht mehr
implizit über eine feste Demo-Adresse) — `localStorage`
(`driftmail.token`), keine automatische Anmeldung mehr beim Laden. Neuer
`LoginScreen` (`src/components/LoginScreen.tsx`) mit Button "Mit Google
anmelden" (navigiert zu `${VITE_API_BASE_URL}/auth/google/start`), `App.tsx`
zeigt ihn, solange kein Token vorhanden ist. `/auth/callback`-Route wird
clientseitig (keine echte Router-Library im Projekt, siehe
`web/README.md`) anhand von `window.location.pathname` erkannt, übernimmt
`?token=`/`?error=` aus der URL und säubert sie danach per
`history.replaceState`. Mock-Server (`web/mock-server/server.mjs`) bekommt
ein `GET /auth/google/start`-Äquivalent, das SOFORT (ohne echtes Google) zu
`.../auth/callback?token=mock-server-token` redirected — gleiches Prinzip
wie beim bestehenden `POST /accounts`-Mock: derselbe Client-Code läuft
unverändert gegen Mock- und echtes Backend, nur die lokale UI-Entwicklung
bleibt ohne echte Google-Zugangsdaten funktionsfähig.

**Getestet:** Backend `npm run typecheck`/`npm test` weiterhin grün
(Kern-Smoketest nutzt weiterhin `POST /accounts` ohne `ALLOWED_EMAILS`,
unverändertes Verhalten). Manuell per `curl` verifiziert: `GET
/auth/google/start` ohne Konfiguration → `503`; mit
`GMAIL_CLIENT_ID`/`GMAIL_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI` → `302`
zu einer korrekten Google-Consent-URL (Client-ID, Redirect-URI, alle sechs
Scopes, `access_type=offline&prompt=consent`); `POST /accounts` mit
gesetztem `ALLOWED_EMAILS` → `403` für nicht gelistete, `200` für gelistete
Adresse. Den vollständigen Callback (echter Code-Austausch) kann ich ohne
echte Google-Zugangsdaten von Massimo nicht selbst end-to-end durchspielen —
sobald das Google-Cloud-Projekt/die Credentials stehen, bitte einmal echt
gegentesten. Web `npm run build`/`tsc -b` grün.

### Provider-Support (19.09., WEB_INBOX.md 15.09. "ECHTE LUECKE ENTDECKT")

Massimo hatte nachgefragt, ob der Einrichtungsassistent bereits gängige
Mail-Provider unterstützt — verifiziert: nein, bisher ausschließlich
Gmail-OAuth. Reihenfolge laut Auftrag: Gmail-OAuth zuerst fertigstellen
(lief bereits, siehe oben), danach IMAP-Passwort-Weg mit Provider-Presets
(GMX/web.de/iCloud/generisch); Outlook/Yahoo-OAuth warten (eigene
Provider-Projekte bei Microsoft/Yahoo nötig, noch nicht eingerichtet).

**Zwei echte, während der Umsetzung entdeckte Lücken, beide behoben:**

1. **`mail_accounts.encrypted_oauth_token`/`encrypted_imap_credentials`
   waren nie wirklich verschlüsselt.** Der Gmail-Refresh-Token landete seit
   dem echten Login (10.09.) im Klartext in der Spalte, die "encrypted_*"
   heißt — der Name versprach etwas, das der Code nicht einhielt. Neu:
   `src/auth/credentialsEncryption.ts`, AES-256-GCM
   (`encryptCredentials`/`decryptCredentials`), Schlüssel aus
   `CREDENTIALS_ENCRYPTION_KEY` (scrypt-Ableitung) mit
   Dev-Fallback-Schlüssel (siehe `.env.example` — **MUSS vor einem echten
   Deploy gesetzt werden**, sonst ist die "Verschlüsselung" nur eine
   Kodierung mit öffentlich in diesem Repo stehendem Schlüssel). Angewendet
   auf beide Spalten: Gmail-Refresh-Token (`routes/auth.ts`
   `GET /auth/google/callback`) und die neuen IMAP-Zugangsdaten (siehe
   unten).
2. **`account.encryptedOauthToken`/`encryptedImapCredentials` wurden vom
   Mail-Sync selbst NIE gelesen.** Trotz echtem Gmail-Login (Refresh-Token
   landete korrekt in der DB) lief der tatsächliche Sync für JEDES Konto
   ausschließlich über die einzelnen, global-einen-Account-großen Env-Vars
   (`GMAIL_REFRESH_TOKEN` bzw. `IMAP_HOST`/`IMAP_USER`/`IMAP_PASSWORD`) --
   ein zweiter, echter User hätte nie seine eigene Mail gesehen, nur
   (falls überhaupt konfiguriert) das eine Env-Var-Konto. `.env.example`
   behauptete an dieser Stelle bereits das Gegenteil ("brauchen dafür KEINE
   eigene Env-Var") -- ein Dokumentations-/Code-Auseinanderlaufen, jetzt
   nachgezogen statt nur die Doku zu korrigieren. Fix:
   `mail/sync.ts` `adapterForAccount()` versucht jetzt ZUERST die
   Konto-eigenen (entschlüsselten) Zugangsdaten, die globalen Env-Vars
   bleiben als Fallback für das Demo-/Dev-Konto ohne echten Login.

**Neu: `GET /mail-providers`** (`routes/mailProviders.ts`,
`contracts/mail-providers.json`) — statische Liste unterstützter Provider
für die künftige Onboarding-Provider-Auswahl (Track C/F), EINE Quelle statt
pro Plattform hartcodierter Presets (gleiches Prinzip wie
`design-tokens.json`). Läuft vor dem Login (`security: []`, wie
`authRouter`). Enthält Gmail (authType `oauth`, fertig), Outlook/Yahoo
(authType `oauth`, `comingSoon: true`), iCloud/GMX/web.de (authType `imap`,
vorbefüllte Host/Port/Secure-Presets für IMAP+SMTP) und `other_imap`
(authType `imap`, Host-Felder `null` — User trägt selbst ein).
`appPasswordHelpUrl`-Werte sind Best-Effort-Links auf offizielle
Provider-Doku (Apple/GMX/web.de) — vor dem Verwenden in einer echten UI
nochmal verifizieren, dass sie noch auflösen.

**`POST /accounts` `provider=imap` ist jetzt echt** (vorher: `imapPassword`
wurde entgegengenommen, aber nie ausgewertet). Neue optionale Body-Felder
`imapHost`/`imapPort`/`imapSecure`/`imapUser`/`smtpHost`/`smtpPort`/
`smtpSecure` (siehe `api-spec.yaml`), `imapUser` fällt auf `emailAddress`
zurück, SMTP-Felder auf `imapHost` + Port 587/STARTTLS (identisches
Fallback-Verhalten wie der bestehende Env-Var-Pfad). **Echter
Verbindungstest vor dem Speichern:** `new ImapAdapter(credentials).
testConnection()` (bereits vorhandene, echte `imapflow`-Implementierung,
bisher nur für den Sync selbst genutzt) — schlägt der Login fehl, gibt es
sofort `422` statt falsche Zugangsdaten stillschweigend zu speichern und
erst beim nächsten Sync-Versuch scheitern zu lassen. Bei Erfolg werden die
Zugangsdaten als ein JSON-Blob (`ImapCredentials`) verschlüsselt in
`encrypted_imap_credentials` abgelegt.

**Bewusste Grenze (wie beim bestehenden "kein Multi-Account"-Verhalten des
gesamten Endpunkts):** gilt nur beim ERSTMALIGEN Verbinden dieser
E-Mail-Adresse — ein zweiter `POST /accounts`-Aufruf mit derselben Adresse
(z.B. nach einer App-Passwort-Rotation beim Provider) ändert die bereits
gespeicherten IMAP-Zugangsdaten NICHT, es gibt in diesem Schritt keinen
Update-Pfad. Kein neuer `provider`-Wert pro IMAP-Anbieter (GMX/web.de/
iCloud/generisch teilen sich weiterhin `provider='imap'`, wie schon im
Contract angelegt) — welcher Anbieter es war, ist reine Client-Auswahl-
Information, für die Funktion selbst zählen nur die tatsächlichen
Host/Port/Secure-Werte.

**Getestet:** Backend-Smoketest neu: Verschlüsselungs-Rundreise
(`encryptCredentials`/`decryptCredentials`, inkl. Prüfung, dass zwei
Verschlüsselungen desselben Klartexts sich unterscheiden -- zufälliger IV),
`GET /mail-providers` (unauthentifiziert, erwartete Presets für
gmail/outlook/gmx/other_imap), `POST /accounts provider=imap` ohne
imapHost/imapPassword → `400`, mit nicht auflösbarem Host → `422` UND
verifiziert, dass dabei kein Mail-Konto angelegt wird. `npm run
typecheck`/`npm test` grün, ohne UND mehrfach hintereinander mit
`DATABASE_URL` gegen eine frisch aufgesetzte lokale Postgres-Instanz.
**Wie beim Gmail-OAuth-Callback (siehe oben) kann ich einen ECHTEN,
erfolgreichen IMAP-Login ohne eine reale Mailbox in dieser Umgebung nicht
end-to-end durchspielen** — Massimo müsste einmal mit einem echten GMX-/
web.de-/iCloud-Konto (App-Passwort) gegentesten, sobald eine Onboarding-UI
dafür existiert oder testweise direkt per `curl` gegen `POST /accounts`.

**Übergabe:** Track C/F (Onboarding-Provider-Auswahlbildschirm, IMAP-
Verbindungsformular mit Preset-Vorbefüllung aus `GET /mail-providers`,
App-Passwort-Erklärung mit Link) bewusst **nicht** Teil dieses Schritts,
siehe `SYNC.md`. Outlook/Yahoo-OAuth ebenfalls offen (wartet laut Auftrag
auf jeweils ein eigenes Provider-Projekt bei Microsoft/Yahoo).

## Automatischer + manueller Mail-Abruf

WEB_INBOX.md 21.09. "SEHR WICHTIGE LUECKE - HOECHSTE PRIORITAET": bis
hierhin gab es NUR den einmaligen Sync beim ersten Verbinden eines Kontos
(`index.ts` beim Serverstart) — danach passierte nie wieder etwas
automatisch, egal wie viele neue Mails eintrafen. Massimo hat das im
echten web.de-Live-Test entdeckt (Testmail kam nie an, ohne manuellen
`POST /internal/sync`-Aufruf).

**Automatisch (`src/mail/scheduler.ts`):** klassisches Polling per
`setInterval`, Default alle 3 Minuten, konfigurierbar über
`MAIL_SYNC_INTERVAL_MINUTES` (Dezimalwerte erlaubt, z.B. `0.5` für
30 Sekunden im Dev-Betrieb). Iteriert **alle** `mail_accounts` über **alle**
User hinweg, jedes Konto unabhängig über `Promise.allSettled` — ein
langsames/fehlerhaftes Konto blockiert die anderen nicht (Vorgabe aus dem
Auftrag). Ruft dieselbe `syncAccount()`-Funktion auf wie der initiale Sync
und der manuelle Endpunkt unten — keine eigene, zweite Sync-Logik.

**Manuell (`POST /accounts/{accountId}/sync`):** für einen "Jetzt
aktualisieren"-Button/Pull-to-Refresh in der Client-UI, löst denselben
Sync sofort für genau ein (eigenes) Konto aus. Ownership-Check wie bei
jedem anderen Endpunkt (404 bei fremder/unbekannter accountId).

**Dedupe kommt kostenlos mit:** `syncAccount()` prüft bereits vor jedem
Import `store.findMessageByHeader()`/`wasAutoDeleted()` — wiederholtes
Aufrufen (Intervall-Timer UND manueller Button gleichzeitig für dasselbe
Konto) ist von Haus aus sicher, kein neuer State im Scheduler nötig.

**IMAP-IDLE-Vormerkung** (im Auftrag als spätere Ausbaustufe erwähnt):
der Scheduler ruft nur `syncAccount()` in Intervallen auf — ein späterer
IDLE-Adapter müsste nur den Trigger ersetzen (Server-Push statt Timer),
nicht `syncAccount()` selbst.

**Bekannte, ehrlich benannte Grenze:** `ImapAdapter.fetchRecentMessages()`
holt bei jedem Aufruf die letzten `limit` (Default 20) Nachrichten der
Mailbox nach Sequenznummer, kein "seit Zeitpunkt X"/UID-basierter Cursor.
Treffen zwischen zwei Polling-Durchläufen mehr als `limit` neue Mails ein,
werden die ältesten davon nie importiert (fallen aus dem Fenster). Bei
einem 2-5-Minuten-Intervall für private/kleine Business-Postfächer ein
sehr seltener Randfall, aber nicht stillschweigend hingenommen — ein
UID-/cursor-basierter Abruf wäre die nächste Ausbaustufe, falls das in der
Praxis relevant wird.

**Tests:** `smoketest.ts` prüft `POST /accounts/{accountId}/sync` (Erfolg
inkl. Dedupe-Check, 404 bei fremder accountId, 401 ohne Token) und ruft
`runSyncForAllAccounts()` (dieselbe Funktion, die der Timer aufruft)
direkt auf. **Bewusst ganz am Anfang von `main()` platziert, vor jedem
Test, der eine Fixture-Nachricht verschiebt/endgültig löscht** — der
`FixtureMailAdapter` liefert bei jedem Aufruf dieselben statischen
Test-Mails zurück (kein echtes Postfach, aus dem eine gelöschte Mail auch
wirklich verschwindet, anders als bei einem echten Gmail-/IMAP-Konto, wo
`mirrorToProvider()` ein permanentes Löschen tatsächlich zum Provider
spiegelt). Ein Sync-Aufruf NACH einem Fixture-Permanent-Delete-Test würde
die Nachricht fälschlich als "neu" re-importieren — ein Artefakt des
statischen Test-Fixtures, kein Bug im echten Dedupe. `npm run
typecheck`/`npm test` grün, ohne UND mit `DATABASE_URL` gegen eine frisch
aufgesetzte lokale Postgres-Instanz (bestehende Nicht-Wiederholbarkeit des
Gesamt-Smoketests gegen einen bereits befüllten Postgres-Stand ist
vorbestehend, nicht durch diesen Schritt verursacht — Ursache liegt an
früheren, unabhängigen Assertions, nicht an den neuen Sync-Tests).

**Übergabe:** Track C/F müssen einen "Jetzt aktualisieren"-Button/Pull-to-
Refresh verdrahten, der `POST /accounts/{accountId}/sync` aufruft und
danach die Nachrichtenliste neu lädt.

## Mehrfach-Konten-Unterstützung (WEB_INBOX.md 21.09. Punkt 2)

Vorher: 1:1-Annahme zwischen User und Mail-Konto überall im Code
(`getMailAccountByUserId()`, `POST /accounts` legt bei erster Verbindung
einer E-Mail-Adresse einen NEUEN User an statt ein zweites Konto an einen
bestehenden zu hängen) UND Ordner waren an `user_id` gebunden -- alle
Konten eines Users hätten sich denselben Ordnerbaum geteilt. Massimo hat
sich für **"getrennte Ansichten pro Konto"** entschieden (Rückfrage per
AskUserQuestion, 21.09.), nicht einen vereinheitlichten Eingang über alle
Konten hinweg.

**Ordner sind jetzt an `mail_account_id` gebunden, nicht mehr an
`user_id`** (`contracts/db-schema.sql`, analog zu `messages`). Jedes
verbundene Konto bekommt seine eigenen 7 System-Ordner
(`createSystemFoldersForAccount()`, vorher `createSystemFoldersForUser()`).
Betroffen: `db/store.ts`/`postgresStore.ts` (Interface + beide
Implementierungen), `routes/folders.ts`, `routes/messages.ts` (Ownership-
Checks liefen vorher über `folder.userId`, jetzt über das Konto des
Ordners), `mail/sync.ts` `resolveFolderId()`.

**Echte Postgres-Migration nötig** (kein reiner App-Logik-Move wie beim
Ordner-Umbau vom 09.09. -- hier ändert eine SPALTE selbst ihre Bedeutung,
nicht nur Zeileninhalte): `postgresStore.ts` `migrateFoldersToAccountScope()`
läuft bei jedem Start VOR `db-schema.sql` (Reihenfolge wichtig -- das
Schema selbst enthält schon `CREATE INDEX ... (mail_account_id)`, das auf
einer noch nicht migrierten DB sonst fehlschlägt, bevor die Migration
überhaupt drankäme). Erkennt die alte Spalte `folders.user_id` per
`information_schema`-Check, backfilled `mail_account_id` (vor diesem
Schritt hatte jeder User höchstens ein Konto, die Zuordnung ist also
eindeutig), entfernt die alte Spalte + Constraint. Auf einer frischen DB
sofortiger No-Op. **Live gegen eine simulierte Alt-DB verifiziert** (echte
`user_id`-Spalte + 14 Ordner-Zeilen über 2 Konten manuell zurückgebaut,
Server gestartet, Migration griff automatisch, alle 14 Zeilen korrekt den
richtigen Konten zugeordnet).

**`POST /accounts` unterstützt jetzt zwei Modi:**
- **Ohne** gültigen Bearer-Token: unverändert der bisherige Login-/
  Registrierungs-Weg (erstes Konto, User wird über die E-Mail-Adresse
  gefunden/angelegt).
- **Mit** gültigem Bearer-Token: das neue Konto wird an DIESEN
  angemeldeten User gehängt, nicht über die E-Mail-Adresse aufgelöst --
  echtes "weiteres Konto hinzufügen". Idempotent pro (User,
  E-Mail-Adresse): derselbe Login + dieselbe Adresse liefert das
  bestehende Konto zurück, kein Duplikat. Gibt bei diesem Pfad denselben
  Token zurück (kein neuer Token nötig, der Client ist ja schon
  eingeloggt).
- Gilt aktuell nur für `provider=imap` bzw. den Fallback-Weg ohne
  Google-OAuth. Der ECHTE Gmail-Login (`GET /auth/google/start`)
  unterstützt das Anhängen an einen bestehenden User NICHT -- der
  Redirect-Callback kennt keinen bestehenden Login-Zustand (kein `state`-
  Parameter, der eine Session durchreicht). **Offene Frage an Track C/F/
  Web** (siehe SYNC.md): `GET /auth/google/start` um einen optionalen
  Redirect-Ziel-Parameter erweitern, damit ein zweites Gmail-Konto auch
  über den echten OAuth-Weg hinzufügbar wird? Bis dahin: zweites Gmail-
  Konto nur über den (ungeprüften) Fallback-Pfad möglich, genau wie das
  erste Konto ohne konfiguriertes Google-OAuth.

**`GET /folders?accountId=`**: mit `accountId` nur die Ordner dieses
Kontos (Ownership-geprüft), ohne `accountId` die Ordner ALLER eigenen
Konten zusammen (flache Liste, jeder Folder trägt seine `accountId` --
"getrennte Ansichten" ist bewusst Client-Sache, nicht serverseitig
gruppiert). **`POST /folders`**: `accountId` im Body erforderlich, sobald
mehr als ein Konto verbunden ist (sonst 400 -- nicht erratbar, welchem
Konto ein neuer Ordner gehören soll), bei genau einem Konto weiterhin
automatisch.

**`GET /messages`** ohne `accountId`/`folderId` fällt weiterhin auf "das
EINE Konto" zurück (`getMailAccountByUserId()`, unverändert) -- für
Mehrfach-Konten-Clients bewusst nicht automatisch erraten, welches der
mehreren Konten gemeint ist. Client-UI mit Account-Switcher muss
`accountId` explizit mitschicken, sobald mehr als ein Konto existiert.

**Tests:** `smoketest.ts` verifiziert: zweites Konto zum selben Login
anlegen (eigener User, kein neuer), Idempotenz (gleiche Adresse zweimal ->
dasselbe Konto), 7 eigene Ordner fürs zweite Konto, `GET /folders` ohne
`accountId` liefert beide Konten zusammen (14 = 7+7), `GET
/folders?accountId=<fremd>` -> 403, `POST /folders` ohne `accountId` bei
&gt;1 Konten -> 400, mit explizitem `accountId` weiterhin 201. Grün ohne
UND mit `DATABASE_URL` gegen frisches Postgres, plus die oben beschriebene
manuelle Migrations-Simulation gegen eine Alt-Schema-DB.

**Übergabe:** Track C/F müssen einen Account-Switcher bauen ("getrennte
Ansichten pro Konto") + einen "Konto hinzufügen"-Einstiegspunkt außerhalb
des Erst-Onboardings (z.B. in den Einstellungen) -- beide können den
bereits bestehenden Onboarding-Provider-Auswahlbildschirm wiederverwenden
(Provider-Liste + IMAP-Formular sind identisch, nur der Aufrufkontext
unterscheidet sich).

## Suche über Mails (WEB_INBOX.md 21.09. "Suche ueber Mails")

`GET /messages` akzeptiert jetzt einen optionalen Query-Parameter `q`
(zusätzlich zu `folderId`/`accountId`, mit diesen kombinierbar). Findet
Treffer per Substring-Suche (case-insensitive) über `subject`,
`from_address`, `from_display_name` und `body_text` — ein Treffer in
irgendeinem dieser vier Felder genügt (OR-Verknüpfung).

**Implementierung:** Postgres per `ILIKE '%q%'` (ein `OR`-Block über die vier
Spalten), In-Memory-Store per `.toLowerCase().includes()` auf denselben vier
Feldern — beide Store-Implementierungen bewusst mit identischer Semantik
gehalten (siehe "Was ist echt, was ist Mock/Stub").

**Grenze (bewusst, kein Versehen):** das ist eine einfache
Substring-/`ILIKE`-Suche, **kein** Volltextindex (`tsvector`/`GIN`,
Ranking, Stemming, Tippfehlertoleranz). Bei kleinen bis mittleren
Postfächern (der hier realistische Rahmen) ist das schnell genug ohne
zusätzliche Infrastruktur. Falls die Mailbox-Größe das später zum Problem
macht: Migration auf einen `tsvector`-Spalten-Index ist ein reiner
Backend-/DB-Schritt, der Contract (`q`-Parameter, Response-Form) müsste
sich dafür nicht ändern — bewusst als Upgrade-Pfad offengelassen, nicht
jetzt schon gebaut, weil noch keine reale Notwendigkeit dafür erkennbar
ist.

**Tests:** `smoketest.ts` prüft einen Treffer über einen Betreff-Substring,
einen Treffer über einen Absender-Adress-Substring sowie eine Suche ohne
Treffer (leeres Array, 200 statt Fehler). Grün ohne UND mit `DATABASE_URL`
gegen frisches Postgres.

**Übergabe:** Track C/F müssen ein Such-UI-Element bauen (Eingabefeld +
`q`-Parameter an `GET /messages` anhängen, idealerweise mit der aktuell
aktiven `accountId`/`folderId` kombiniert, damit die Suche im Kontext der
gerade sichtbaren Ansicht bleibt).

## KI-Anbindung (BYOK) -- [2026-09-21] Nachtrag
(TERMINAL_INBOX.md 21.09. "KORREKTUR", ersetzt WEB_INBOX.md 21.09. "ECHTE
KI-ANBINDUNG" Commit c3ec563 vollstaendig -- siehe dort fuer den
ueberholten Ursprungsauftrag)

**Kernentscheidung (Massimo woertlich, direkt an Claude Code korrigiert,
nicht ueber WEB_INBOX.md):** Geraete-eigene KI ist die PRIMAERE Quelle
(Apple Intelligence/Foundation Models auf iOS, browser-eigene On-Device-KI
auf Web falls verfuegbar) -- KEIN driftmail-finanzierter Cloud-API-Key.
Cloud-KI (gleich welcher Anbieter) nur, wenn der User selbst einen eigenen
Zugang/API-Key in den Einstellungen eintraegt ("BYOK" -- Bring Your Own
Key), dann auf seine eigenen Kosten. Consent-Pruefung vor jedem
Cloud-Dispatch bleibt Pflicht, unabhaengig davon wer zahlt.

**Wichtige Abgrenzung:** Backend kennt gar keinen On-Device-Pfad -- das
entscheidet ausschliesslich der jeweilige Client (iOS/Web), BEVOR er das
Backend fuer eine der drei KI-Aktionen ueberhaupt anfragt. Ein Client mit
funktionierender On-Device-KI sollte diese Endpunkte fuer summarize/
draftReply im Idealfall nie aufrufen. Das Backend selbst kann nur zwischen
zwei Quellen waehlen: BYOK-Cloud (echter externer Anbieter, User-Kosten)
oder Heuristik (deterministische Mustererkennung, kein KI-Modell).

**Drei Quellen, ehrlich unterschieden (`AiSource`, contracts/
ai-adapter-interface.ts):**
- `on_device`: lief auf dem Geraet des Users, hat es nie verlassen (rein
  Client-seitig, Backend sieht das nur als fertiges Ergebnis oder gar
  nicht).
- `cloud_fallback`: echter Netzwerk-Call an einen externen KI-Anbieter,
  NUR mit BYOK-Konfiguration + Consent moeglich.
- `heuristic`: NEU seit dieser Korrektur. Kein KI-Modell beteiligt,
  dieselbe deterministische Mustererkennung wie vorher (`MockAiAdapter`,
  Track B fuer `analyzeMail`, simple Keyword-Heuristik fuer die anderen
  drei Funktionen) -- vorher fälschlich immer als `cloud_fallback`
  gelabelt, obwohl nie ein externer Anbieter aufgerufen wurde. Das war die
  eigentliche Namensluege, die diese Korrektur behebt, unabhaengig von der
  BYOK-Frage selbst.

**Umfang: nur die drei bereits im Ursprungsauftrag genannten Funktionen**
(`extractContract`/`summarize`/`draftReply`) -- `analyzeMail` (Spam-/
Phishing-Klassifikation) ist explizit NICHT Teil dieser KI-Anbindung,
bleibt unveraendert die deterministische Track-B-Logik
(`@driftmail/security-classification`), unabhaengig von BYOK-Konfiguration.
Sicherheitsklassifikation soll nie davon abhaengen, ob ein User einen
eigenen KI-Key hinterlegt hat.

**`user_ai_preference` (db-schema.sql, KORREKTUR-Version):** `mode`
('off'/'byok', Default 'off' -- kein driftmail-finanzierter "free"-Modus
mehr, die urspruenglich dafuer vorgesehene `ai_provider_config`-Tabelle
bleibt bewusst ungenutzt, siehe Kommentar dort), `byok_provider`
('anthropic'/'openai'/'google'/'other'), `encrypted_api_key` (AES-256-GCM,
**wiederverwendet** `src/auth/credentialsEncryption.ts` -- dieselbe
Verschluesselung wie fuer OAuth-/IMAP-Zugangsdaten, kein zweites Krypto-
Modul), `cloud_consent_given_at` (NULL = kein Consent). Tabelle war zu
Beginn dieses Schritts von keinem Code beschrieben, direkt am CREATE TABLE
geändert (Repo-Konvention), kein ALTER noetig.

**`GET`/`PUT /ai-settings`** (`src/routes/aiSettings.ts`): eigene
Cloud-KI-Einstellung lesen/setzen. `apiKey` wird NIE zurueckgegeben, nur
`hasApiKey` (boolean). `PUT` mit `mode=byok` verlangt `byokProvider` +
`apiKey` (Ausnahme: `apiKey` darf weggelassen werden, wenn schon einer
hinterlegt ist und nur `cloudConsent` geaendert wird). `mode=off` setzt
Provider/Key/Consent IMMER zurueck -- ein spaeteres erneutes Aktivieren
verlangt bewusst wieder ein explizites Consent, kein "totes" Consent-Flag,
das unbemerkt Monate spaeter ohne erneute Bestaetigung wieder greift.

**Anbieter-Umfang, ehrlich benannt (kein stiller Fehlschlag):** nur
`anthropic`/`openai` sind in `src/ai/cloudAdapter.ts` wirklich angebunden
(einfache, gut dokumentierte REST-APIs, echte Netzwerk-Calls, keine
Mocks). `google`/`other` existieren im Contract/DB-Enum fuer spaetere
Erweiterung, werden aber bereits bei `PUT /ai-settings` mit 400
("noch nicht implementiert") abgelehnt -- **Fail fast beim Konfigurieren,
nicht erst beim spaeteren Nutzen.** Modelle bewusst klein/guenstig gewaehlt
(`claude-haiku-4-5-20251001`/`gpt-4o-mini`) -- diese drei Funktionen sind
kurze, on-demand ausgeloeste Aktionen auf Kosten des Users, kein Grund fuer
ein teures Modell.

**Graceful Fallback (`src/ai/index.ts` `runAiTask()`):** schlaegt der
echte BYOK-Cloud-Call fehl (falscher/abgelaufener Key, Netzwerk,
Rate-Limit, unerwartete Antwortform), faellt die Route automatisch auf die
Heuristik zurueck statt eines 500ers -- eine BYOK-Fehlkonfiguration soll
eine KI-Aktion nie kaputtmachen, nur schlechter machen. Der Fehlschlag
wird serverseitig geloggt, nicht dem User als Fehler angezeigt.
`source` in der Antwort spiegelt IMMER, was tatsaechlich passiert ist
(nie das, was eigentlich versucht war) -- bei einem Fallback also
`heuristic`, nicht `cloud_fallback`.

**`GET /messages/{id}/summary` + `POST /messages/{id}/reply-draft`:**
nutzen jetzt `getAiAdapterForUser(req.userId)`/`runAiTask()` statt des
vorher global fest verdrahteten Mock-Adapters. `reply-draft` bekam dabei
ein bisher fehlendes `source`-Feld in der Antwort (Contract-Luecke, siehe
api-spec.yaml-Kommentar -- `draftReply()` liefert laut
ai-adapter-interface.ts schon seit dem 08.09. ein `AiAdapterResult<string>`
mit Quelle, das Feld fehlte aber im HTTP-Response-Schema).

**Bewusste Grenze -- `extractContract` bleibt NUR heuristisch:** die
Vertragsextraktion laeuft waehrend des Hintergrund-Syncs
(`syncAccount()`/`mail/scheduler.ts`), nicht als on-demand User-Aktion wie
die anderen beiden Funktionen. Ein Per-User-BYOK-Upgrade dort haette eine
zusaetzliche asynchrone Preference-Lookup fuer JEDEN einzelnen
Sync-Tick JEDES Kontos bedeutet (Scheduler laeuft alle paar Minuten fuer
alle Konten aller User) -- unverhaeltnismaessiger Aufwand/Latenz-Zuwachs
fuer diesen ersten Schritt. `extractContract` nutzt deshalb weiterhin
IMMER den heuristischen Singleton-Adapter (`aiAdapter`-Export in
`src/ai/index.ts`, unveraendert), auch wenn ein User BYOK konfiguriert
hat. Spaetere Ausbaustufe, nicht Teil dieses Schritts.

**Onboarding-Zustimmungsschritt, bewusst NICHT als eigener Onboarding-
Screen gebaut:** ein frueheres Mockup (SYNC.md 15.09., "Willkommen ->
Mail-Konto verbinden -> KI-Capability-Check/Zustimmung -> Signatur ->
Fertig") sah einen eigenen Onboarding-Schritt vor. Mit BYOK als Default-
"off"-Zustand braucht die grosse Mehrheit der User NIE einen
Cloud-Consent-Dialog (nur wer aktiv einen eigenen Key eintraegt) -- ein
verpflichtender Onboarding-Schritt fuer alle waere fuer den Normalfall
irrefuehrend/unnoetige Reibung. Der Consent lebt deshalb direkt in den
KI-Einstellungen (`cloudConsent` in `PUT /ai-settings`), an der einzigen
Stelle, an der er ueberhaupt relevant wird -- serverseitig bei JEDEM
einzelnen Dispatch geprueft (`getAiAdapterForUser()`), nicht nur einmalig
beim Speichern vertraut. Web/iOS bauen die UI dafuer in ihren jeweiligen
Einstellungen, nicht im Onboarding-Flow.

**Tests:** `smoketest.ts` deckt ab: Default-Zustand (`mode=off`,
`hasApiKey=false`), `summary`/`reply-draft` liefern ohne BYOK `source:
"heuristic"`, `PUT /ai-settings` lehnt `byokProvider=google` mit 400 ab,
lehnt `mode=byok` ohne `apiKey` mit 400 ab, akzeptiert eine gueltige
Provider-Kombination (Key wird NIE in der Antwort zurueckgegeben), UND
ein echter Graceful-Fallback-Test mit einem absichtlich UNGUELTIGEN
Anthropic-Key -- **echter Netzwerk-Roundtrip zu api.anthropic.com** (kein
Mock), die Anthropic-API lehnt mit 401 ab, die Route faellt automatisch
auf `heuristic` zurueck statt eines 500ers. `mode=off` setzt Provider/Key/
Consent nachweislich zurueck. Gruen ohne UND mit `DATABASE_URL` gegen
frisches Postgres. **Nicht getestet (kein gueltiger Key verfuegbar, aus
gutem Grund nicht erfunden):** ein tatsaechlich ERFOLGREICHER BYOK-Cloud-
Aufruf -- die Request-/Response-Parsing-Logik selbst (`cloudAdapter.ts`)
ist gegen die dokumentierten, oeffentlichen API-Formate beider Anbieter
geschrieben, aber nie gegen eine echte erfolgreiche Antwort verifiziert.

**Uebergabe an Track C (iOS) + Track F (Web):** beide bauen jeweils (1)
eine Einstellungs-UI fuer `GET`/`PUT /ai-settings` (Provider-Auswahl,
API-Key-Eingabe als Passwort-Feld, Consent-Checkbox), (2) einen echten
On-Device-KI-Versuch VOR jedem Aufruf der Backend-Endpunkte fuer
summarize/draftReply (iOS: Apple Foundation Models, verfuegbar ab iOS 26
laut SDK-Check in dieser Umgebung, mit Verfuegbarkeits-Gate + Fallback auf
den bisherigen Heuristik-Stub fuer aeltere Geraete; Web: Browser-eigene
On-Device-KI falls in der Zielumgebung ueberhaupt verfuegbar, sonst
dokumentierter Verzicht, kein Blocker). `CapabilityChecker`
(iOS)/aequivalent (Web) sollten dabei von reinen Platzhaltern auf eine
echte Verfuegbarkeitspruefung umgestellt werden.

## Einstellungsbereich (Backend-Grundlage) -- [2026-09-21] Nachtrag
(WEB_INBOX.md 21.09. "NEUER AUFTRAG - Einstellungsbereich + Info-Seite")

Backend-seitige Grundlage fuer den gebuendelten Einstellungsbereich (die
UI selbst bauen Track C/F) -- zwei neue Stücke:

**1) `DELETE /accounts/{accountId}`** (Konten-Verwaltung): entfernt ein
verbundenes Konto inkl. aller daran haengenden Daten (Ordner, Nachrichten,
Entwuerfe, ...). Bei Postgres laeuft das Aufraeumen komplett ueber die
bereits bestehenden `ON DELETE CASCADE`-Foreign-Keys (kein neuer Code
noetig), bei `InMemoryStore` manuell nachgebildet
(`deleteMailAccount()` in `src/db/store.ts`). **400, wenn es das letzte
Konto des Users waere:** Auth laeuft aktuell implizit ueber Mail-Konto-
Verbindung (siehe Abschnitt "Auth" unten) -- ein User ohne jedes Konto
haette keinen sinnvollen Weg mehr, sich je wieder anzumelden.

**2) `GET`/`PUT /settings`** (`src/routes/settings.ts`): allgemeine
UI-Praeferenzen des Users, aktuell nur `accentTheme`. Eigener,
erweiterbarer Endpunkt statt in ein bestehendes Objekt gequetscht --
gleiches Prinzip wie `/ai-settings` fuer BYOK. Fuenf waehlbare Werte
(`teal`/`ocean_blue`/`violett`/`koralle`/`ocean_verlauf`), Default `teal`,
siehe `contracts/design-tokens.json` `color.accentThemes` fuer die
tatsaechlichen Farbwerte (inkl. der Zwei-Farb-Gradient-Definition fuer
`ocean_verlauf`). **Bewusste Grenze, aus einer frueheren Design-Vorgabe
(WEB_INBOX.md, "ERGAENZUNG zur Design-Richtung"):** NUR die neutrale
Akzentfarbe ist waehlbar -- `danger`/`warning`/`success` bleiben fuer alle
User fest, sind nicht Teil dieser Liste, damit das bestehende
Sicherheits-Warnsystem seine Eindeutigkeit nicht verliert.

`users.accent_theme` ist neu (`contracts/db-schema.sql`) -- echte
`ALTER TABLE`-Migration in `postgresStore.ts`
(`migrateUsersAccentTheme()`), da `users` (anders als die zuletzt
angefassten, bis dahin ungenutzten KI-Tabellen) schon von echtem
Auth-Code beschrieben wird. Einfacher als die Migrationen davor: reine
`ADD COLUMN IF NOT EXISTS ... DEFAULT 'teal'`-Ergaenzung, kein Umbau einer
bestehenden Constraint, der `DEFAULT`-Wert backfuellt bestehende Zeilen
automatisch.

**Tests:** `smoketest.ts` nutzt die im Mehrfach-Konten-Testblock bereits
verbundenen zwei Konten: zweites Konto loeschen (204, Ordner mit-entfernt,
Fremde/unbekannte accountId -> 404), letztes verbleibendes Konto ->
400 (bleibt unangetastet). `GET`/`PUT /settings`: Default `teal`,
ungueltiger Wert -> 400, gueltige Aenderung wird korrekt gespeichert und
bei erneutem `GET` widergespiegelt. Migration zusaetzlich manuell gegen
eine simulierte Alt-Schema-DB verifiziert (Spalte fehlte, Migration legt
sie mit korrektem Backfill an, idempotent bei zweimaligem Lauf). Gruen
in-memory + gegen frisches Postgres.

**Uebergabe an Track C/F:** die eigentliche Einstellungsbereich-UI
(Konten-Liste + Hinzufuegen/Entfernen, Akzentfarben-Auswahl, gebuendelte
Sicherheit-Sektion mit KI-Einstellungen/BYOK + App-Sperre + einer
einfachen Text-Uebersicht der aktiven Sicherheits-Features, Link zur
Installationsanleitung) ist noch zu bauen -- dieser Nachtrag liefert nur
die dafuer noetigen neuen Endpunkte.

## Fuenf Komfort-Features (Backend-Grundlage) -- [2026-09-21] Nachtrag
(WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES")

Backend-Bausteine fuer drei der fuenf vorgeschlagenen Komfort-Features
(UI folgt in Web/iOS). Die anderen zwei brauchten keine Backend-Aenderung
bzw. existierten bereits, siehe unten.

**1) "Unbekannte Absender streng behandeln":** `users.strict_unknown_senders`
(Default `true`, wie im Auftrag vorgegeben) -- neues Feld in `GET`/`PUT
/settings` neben `accentTheme` (siehe Abschnitt "Einstellungsbereich"
oben, `updateUserAccentTheme()` dafuer zu `updateUserSettings()`
verallgemeinert statt einer zweiten near-doppelten Methode). Reine
Client-Darstellungsentscheidung -- das Backend liefert `isNewSender`
unveraendert weiter, nur dieser Schalter ist neu. Migration laeuft ueber
dieselbe `migrateUsersAccentTheme()`-Methode wie `accent_theme` (gleiches
ADD-COLUMN-Muster, dort inzwischen treffender benannt "beide neuen
users-Spalten").

**2) Kontakt-Autovervollstaendigung:** neuer Endpunkt `GET /contacts`
(`src/routes/contacts.ts`) -- bekannte Adressen fuer An/CC/BCC-Vorschlaege
im Compose-Screen. Einfache Ableitung aus bisherigen Absenderadressen
(empfangene Mail, ueber ALLE eigenen Konten hinweg) und bereits gesendeten
Adressen (`outgoing_send_log`), dedupliziert (case-insensitive) und
alphabetisch sortiert -- kein eigenes Kontakte-Feature/keine eigene
Tabelle, wie im Auftrag ausdruecklich als ausreichend markiert.

**3) Entwuerfe automatisch speichern:** KEINE Backend-Aenderung noetig --
`POST`/`PATCH /drafts/{id}` existieren bereits vollstaendig (seit
09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"). Reine
Client-Aufgabe: periodisch/bei Fokus-Verlust denselben Mechanismus
aufrufen, den ein manuelles Speichern schon nutzen wuerde.

**4) Threaded Ansicht:** `Message` (die LISTEN-Form, `GET /messages`)
bekommt `inReplyToMessageId` -- vorher nur auf `MessageDetail` vorhanden.
Ohne dieses Feld haette der Client fuer jede einzelne Nachricht in der
Liste extra `GET /messages/{id}` nachladen muessen, nur um sie gruppieren
zu koennen. **Bewusste Grenze:** kein serverseitiges "vollstaendiges
Thread"-Konzept (kein `thread_id`, keine Mehrfach-Message-ID-Aufloesung
ueber den `References`-Header) -- `inReplyToMessageId` zeigt weiterhin nur
auf den DIREKTEN Elternteil (siehe `mail/inReplyTo.ts`-Kommentar, "mehr
Praezision braeuchte echtes Threading ueber References, nicht Umfang
dieses Auftrags"). Client-seitiges Gruppieren kann deshalb nur Ketten
INNERHALB derselben Ordner-Abfrage aufloesen; ein Elternteil in einem
anderen Ordner (z.B. eine Antwort in "gesendet" auf eine Mail in
"eingang") bleibt unverknuepft. Dokumentiert als Ausbaustufe, nicht Teil
dieses Schritts.

**5) Manueller Abmelden-Button auf jeder Mail mit List-Unsubscribe-Header:**
bereits VOLLSTAENDIG erledigt, ohne dass dieser Schritt noch etwas tun
musste -- `MessageDetail.canUnsubscribe` (`src/mappers.ts`) war schon
immer rein von der Existenz eines gueltigen Headers abgeleitet
(`parseListUnsubscribeHeader(m.rawHeaders) !== null`), NIE von der
Spam-Klassifikation abhaengig. Web (`MessageDetailPane.tsx`) und iOS
(`MessageDetailView.swift`) zeigen den Button entsprechend schon
unabhaengig von der Klassifikation. Der einzige echte Fehlteil war der
zuvor behobene fehlende ECHTE Netzwerk-Aufruf (siehe Abschnitt "Automatische
Abmeldung bei Spam" oben, "LUECKE SCHLIESSEN" Nachtrag) -- der ist bereits
fertig.

**Tests:** `smoketest.ts` deckt `strictUnknownSenders` (Default,
unabhaengige Aenderung ohne `accentTheme` zu beruehren) und `GET /contacts`
(Dedupe ueber zwei Quellen, Sortierung) ab, sowie `inReplyToMessageId` in
der Nachrichtenliste anhand der bereits gesendeten Test-Antwort. Migration
manuell gegen eine simulierte Alt-Schema-DB verifiziert. Gruen in-memory +
gegen frisches Postgres.

**Uebergabe an Track C/F:** UI fuer alle fuenf Punkte noch zu bauen (Punkt
5 ist Backend-seitig schon fertig, aber pruefen ob Web/iOS den Button
wirklich schon ueberall zeigen, nicht nur behaupten). Details siehe
WEB_INBOX.md-Originaltext fuer die genauen UI-Vorschlaege pro Punkt.

## Signaturen & Abwesenheitsassistent -- [2026-09-21] Nachtrag
(WEB_INBOX.md 21.09. "NEUER AUFTRAG - Abwesenheitsassistent")

**Vorgefundene Luecke:** `signatures` stand schon laenger als
`CREATE TABLE` in `contracts/db-schema.sql` und `GET /signatures` schon
laenger in `api-spec.yaml` -- aber es gab dafuer **keine einzige Zeile
Backend-Code**. Kein Router, keine `Store`-Methoden, kein `types.ts`.
Reine Vertrags-Leiche, siehe vorheriger Annahmen-Punkt weiter unten. Fuer
diesen Auftrag ("Default-Signatur automatisch unter die
Abwesenheitsantwort haengen") musste das jetzt sowieso nachgezogen werden.

**Wiederverwendung statt Neubau:** die eigentliche Signatur-Auswahl-Logik
(genau eine Default-Signatur pro Mail-Konto, automatische Neuvergabe beim
Loeschen der aktuellen Default-Signatur, Anhaengen an Neu-/Antwort-Mails)
existierte bereits fertig getestet in `mail-actions/src/signatures.ts` --
einem eigenstaendigen Geschwister-Package (Track E), das aber selbst noch
nie vom Backend importiert wurde. Statt das nochmal im Backend
nachzubauen, jetzt echt verdrahtet: `backend/package.json` bekommt
`"@driftmail/mail-actions": "file:../mail-actions"`.

**Dabei gefundener und behobener Packaging-Fehler in `mail-actions`:**
`mail-actions/src/types.ts` importierte Typen ueber die Package-Grenze
hinweg direkt aus `../../contracts/ai-adapter-interface` (`export type
{...} from ...`). Auch wenn `export type`-Re-Exports zur Laufzeit
komplett wegfallen (kein JS-Output), berechnet `tsc` mit `declaration:
true` trotzdem einen gemeinsamen `rootDir` ueber ALLE referenzierten
Dateien -- inklusive der Datei ausserhalb des Package-Verzeichnisses --
fuer die `.d.ts`-Generierung. Ergebnis: ein kaputter, verschachtelter
`dist/`-Baum (`dist/mail-actions/src/...` + `dist/contracts/...`) statt
des erwarteten flachen `dist/index.js`. Gefixt durch lokales Spiegeln der
drei betroffenen Typen (`AiSource`, `MailThread`, `AiAdapterResult`)
direkt in `mail-actions/src/types.ts`, mit Kommentar warum -- exakt die
Konvention, die `backend/src/ai/types.ts` und
`security-classification/src/types.ts` schon vorher befolgt hatten (dort
steht es sogar explizit im Kommentar: "damit dieses Modul als
eigenstaendiges npm-Package ohne Pfad-Abhaengigkeit ausserhalb seines
eigenen Verzeichnisses baubar bleibt"). Zusaetzlich musste
`mail-actions/tsconfig.json` von `module`/`moduleResolution: "ESNext"`/
`"Bundler"` auf `"NodeNext"`/`"NodeNext"` umgestellt werden (plus
explizite `.js`-Endungen an allen relativen Imports im Quellcode) --
sonst behaelt der kompilierte Output endungslose relative Imports, die
unter echtem Node-ESM zur Laufzeit mit `ERR_MODULE_NOT_FOUND` scheitern
(vor dem Fix reproduziert, nach dem Fix per `node -e
"import('./dist/index.js')..."` echt gegengetestet). Nebenbei
`mail-actions/package.json` um `main`/`types`/`build`-Script ergaenzt --
das Package hatte vorher gar keinen definierten Einstiegspunkt.

**Echte neue Backend-Teile:**
- `src/routes/signatures.ts`: echtes `GET`/`POST`/`PATCH`/`DELETE
  /signatures` (mit `?accountId=`-Filter), Ownership-Pruefung nach
  demselben Muster wie `requireOwnFolder` in `folders.ts`.
- `Store`-Interface (`store.ts`/`postgresStore.ts`) bekommt
  `listSignatures`/`getSignature`/`createSignature`/`updateSignature`/
  `deleteSignature`, inklusive der Default-Invariante (erste Signatur
  eines Kontos wird automatisch Default, Loeschen der Default-Signatur
  befoerdert automatisch eine verbleibende).
- `src/routes/absenceResponder.ts`: `GET`/`PUT /absence-responder`
  (neuer Contract-Pfad + `AbsenceResponder`-Schema in `api-spec.yaml`).
  `PUT` mit `active: true` verlangt `startDate`+`subject`+`body` (400
  sonst), erlaubt aber partielle Updates (nur uebergebene Felder werden
  geaendert, Rest bleibt wie zuvor gespeichert).
- `src/mail/absenceResponder.ts` (`maybeSendAbsenceResponse()`): die
  eigentliche Ausloese-Entscheidung, aufgerufen aus `mail/sync.ts` direkt
  nach der Spam/Phishing-Klassifikation jeder neu eingegangenen Mail.

**Sicherheits-Verbesserung ueber Gmail/Outlook hinaus (Massimos Vorschlag,
explizit im Auftrag genannt):** KEINE automatische Antwort an Absender,
die als `spam`/`phishing` klassifiziert wurden, und KEINE Antwort, wenn
die Mail einen `List-Unsubscribe`-Header traegt (Newsletter/Mailingliste
statt persoenlicher Mail). Verhindert, dass Betrueger per
Abwesenheitsantwort erfahren, dass der User gerade nicht erreichbar ist --
ein bekanntes Social-Engineering-Einfallstor. `advance_fee_scam` braucht
keine eigene Pruefung: diese Mails landen auf dem Auto-Delete-Pfad in
`mail/sync.ts` und erreichen `maybeSendAbsenceResponse()` strukturell nie
(`continue` VOR dem Aufruf).

**Pro-Absender-Cooldown:** `absence_responder_log` (`user_id` +
`sender_address` als Composite-PK, gleiches Muster wie
`outgoing_send_log`/`hasSentTo()`), Default 4 Tage (konfigurierbar ueber
`ABSENCE_RESPONDER_COOLDOWN_DAYS`) -- verhindert Antwort-Schleifen bei
mehreren Mails derselben Person waehrend der Abwesenheit.

**Signatur-Anhang:** falls das Mail-Konto eine Default-Signatur hat, wird
sie automatisch unter den Abwesenheitstext gehaengt (`appendSignature()`
aus `@driftmail/mail-actions`) -- kein eigenes Signatur-Feld am
Abwesenheitsassistenten selbst noetig.

**Tests:** `smoketest.ts` deckt Signatur-CRUD (erste Signatur wird
automatisch Default, zweite nicht, `PATCH isDefault` entzieht anderen
Signaturen den Default-Status, `DELETE` der Default-Signatur befoerdert
automatisch eine verbleibende) sowie den Abwesenheitsassistenten ab:
`GET`-Default (`active: false`), `PUT active:true` ohne Pflichtfelder
(400), `PUT` mit vollstaendiger Konfiguration, und ueber einen direkten
Aufruf von `maybeSendAbsenceResponse()` (bewusst nicht ueber den vollen
Sync-HTTP-Weg, da das Cooldown-Testen sonst die bestehende
Fixture-Dedup-Logik umgehen muesste -- gleiches Vorgehen wie beim
bestehenden `store.hasSentTo()`-Test): normaler Versand, Cooldown
blockiert Wiederholung, Spam sendet nie, `List-Unsubscribe`-Header sendet
nie, inaktiv sendet nie. Gruen in-memory + gegen frisches Postgres
(`signatures`/`absence_responder`/`absence_responder_log` sind komplett
neue Tabellen ohne bestehende Konsumenten, deshalb reines `CREATE TABLE
IF NOT EXISTS` statt einer `ALTER TABLE`-Migration -- kein
Alt-Schema-Fall zu simulieren).

**Uebergabe an Track C/F:** Einstellungsbildschirm noch zu bauen (Ein/Aus-
Schalter, Start-/End-Datumsfelder, Betreff-/Text-Eingabe, gebunden an
`GET`/`PUT /absence-responder`) plus ein aktiver Banner mit
"Jetzt beenden"-Schnellaktion, wie im WEB_INBOX.md-Originaltext
vorgeschlagen.

## Drei weitere Features -- Gmail-Recherche (Backend-Grundlage) -- [2026-09-21] Nachtrag
(WEB_INBOX.md 21.09. "DREI WEITERE FEATURES - Gmail-Recherche")

Backend-Teile fuer zwei der drei vorgeschlagenen Features (Punkt 1,
"Vergessener-Anhang-Erkennung", ist reine Client-Logik ohne Contract-
Aenderung, siehe unten). UI fuer alle drei folgt in Web/iOS.

**1) Vergessener-Anhang-Erkennung:** KEINE Backend-Aenderung -- reine
Client-seitige Textsuche im Compose-Screen nach typischen Phrasen ("im
Anhang", "siehe Anhang", "anbei", "attached", "see attachment") vor dem
Senden, kein neuer Endpunkt noetig.

**2) "Nudge" -- Erinnerung an unbeantwortete Mails:** `Message.awaitingReply`
(neu, zur Laufzeit abgeleitet, kein eigenes Feld/Cache -- siehe
`mail/nudge.ts`) ist true, wenn eine Nachricht mindestens
`NUDGE_THRESHOLD_DAYS` (Default 3, wie Gmail) alt ist UND in der jeweils
GEGENUEBERLIEGENDEN Ordner-Richtung desselben Kontos keine Antwort
existiert: fuer eine Nachricht im "eingang"-Ordner wird geprueft, ob im
"gesendet"-Ordner eine Nachricht mit `inReplyToMessageId` darauf zeigt
(hat der USER geantwortet, nicht nur "gibt es irgendeine weitere Nachricht
im Thread") -- fuer eine eigene Nachricht im "gesendet"-Ordner umgekehrt,
ob im "eingang"-Ordner eine Antwort ankam. Als spam/phishing klassifizierte
Mail nudgt nie. `users.nudge_unanswered_enabled` (Default true, wie im
Auftrag verlangt "manche Nutzer empfinden es als aufdringlich") schaltet
die Berechnung komplett ab, ueber `GET`/`PUT /settings`.

Gepruefte Wiederverwendung der bestehenden reminders-Infrastruktur
(`Reminder`-Contract-Typ, `contracts-logic/src/scheduler.ts`) wie im
Auftrag vorgeschlagen -- **bewusst NICHT wiederverwendet**: `Reminder` ist
fest an `contractId` gebunden (Vertragserkennungs-Feature), eine eigene,
kleinere zur-Laufzeit-Ableitung passt hier besser als ein Schema-Umbau
eines fachlich anderen Features.

**3) Vertraulicher Modus:** `messages.confidential_until` (neu, additive
Spalte) -- setzbar ueber `POST /messages/send` (`confidentialUntil`, muss
ein gueltiger, in der Zukunft liegender Zeitpunkt sein, sonst 400). Nach
Ablauf wird `bodyText` serverseitig geloescht -- **kein Hintergrund-Job**
(gleiche bewusste Grenze wie ueberall sonst in diesem Projekt, siehe
"Annahmen" unten): der Ablauf wird stattdessen LAZY beim naechsten
Lesezugriff (`store.getMessage()`/`listMessages()`) geprueft und dann
EINMALIG echt geloescht (persistiert, nicht nur pro Response maskiert),
siehe `mail/confidential.ts` (reine Entscheidungsfunktion) + die
`expireConfidentialIfDue()`-Methoden in `store.ts`/`postgresStore.ts`
(die eigentliche Loesch-Mutation, je Persistenzschicht). Das Feld
`confidentialUntil` selbst bleibt auf der Nachricht erhalten (auch nach
Ablauf), damit der Client "war vertraulich, seit X nicht mehr lesbar"
anzeigen kann, statt einfach kommentarlos leer zu wirken.

Automatischer Vorschlag "Vertraulich senden?" bei erkannten sensiblen
Daten (IBAN/Kreditkartennummer): **keine Backend-Aenderung noetig** --
`POST /messages/draft/phishing-check` liefert `containsSensitiveData`
(`iban`/`credit_card`/`other`) bereits seit laengerem
(`security-classification/src/draftPhishingCheck.ts`), der Client kann
das direkt fuer den proaktiven Vorschlag nutzen, ohne dass der Composer
dafuer einen zweiten Request braucht.

**Bewusst nicht umgesetzt (ehrlich dokumentierte Grenze, wie im Auftrag
selbst schon vorweggenommen):** kein Kopieren-/Weiterleiten-/Drucken-Schutz
clientseitig erzwingbar -- reine Client-Beschraenkung wie bei jedem
Anbieter, kein technischer Schutz gegen Screenshots o.ae. Attachment-Bytes
werden ueber diese API ohnehin nie ausgeliefert (kein Download-Endpunkt
existiert, siehe "Anhänge" oben) -- fuer den "Vertraulich"-Zweck also
bereits strukturell kein zusaetzliches Leck.

**Tests:** `smoketest.ts` deckt Punkt 2 (alte unbeantwortete Eingang-Mail
-> `awaitingReply=true`, eigene Antwort im gesendet-Ordner macht es wieder
false, alte eigene gesendete Mail ohne Antwort -> true, als-spam-
klassifizierte Mail -> nie true, Ein/Aus-Schalter blendet alles aus) und
Punkt 3 ab (Ablaufzeit in der Vergangenheit -> 400 beim Senden, gueltige
Ablaufzeit -> vor Ablauf lesbar, nach Ablauf `bodyText=null` sowohl in der
API-Response als auch bei direktem `store.getMessage()`-Zugriff --
Persistenz-Check, keine reine Pro-Response-Maskierung -- waehrend
`confidentialUntil` selbst erhalten bleibt). Migration
(`messages.confidential_until` + `users.nudge_unanswered_enabled`) manuell
gegen eine simulierte Alt-Schema-DB verifiziert (beide Spalten fehlten
vorher, `migrate()` legt sie korrekt nach, Smoketest bleibt danach gruen).
Gruen in-memory + zweimal hintereinander gegen dieselbe frische Postgres-DB
(Migrations-Idempotenz).

**Dabei gefundener und behobener Bug:** `PostgresStore.updateUserSettings()`
kannte `nudgeUnansweredEnabled` zunaechst nicht (nur beim InMemoryStore
ergaenzt) -- `PUT /settings` mit diesem Feld hatte gegen eine echte
Postgres-DB stillschweigend keine Wirkung (die Spalte wurde nie
geschrieben). Nur durch den Postgres-Smoketest-Lauf aufgefallen (der
In-Memory-Lauf verdeckte den Fehler, da `InMemoryStore` korrekt war) --
weiterer Beleg dafuer, warum dieses Projekt konsequent gegen BEIDE Stores
testet, nicht nur gegen den bequemeren In-Memory-Fallback.

**Uebergabe an Track C/F:** UI fuer alle drei Punkte noch zu bauen (Punkt 1
komplett client-seitig, Punkt 2 dezenter Listen-Hinweis + Einstellungs-
Schalter, Punkt 3 Compose-Option + automatischer Vorschlag bei erkannten
sensiblen Daten + Anzeige des Ablaufzustands in der Detailansicht).

## 5 Wettbewerbs-Luecken (Proton/Hey/Superhuman-Vergleich) -- [2026-09-21] Nachtrag
(WEB_INBOX.md 21.09. "NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken")

**1) Tracking-Pixel-Blockierung:** `GET`/`PUT /privacy-settings`
(`user_privacy_settings`, `routes/privacySettings.ts`) -- ein echter,
gespeicherter Schalter, aber mit einer wichtigen Einordnung:
**`blockRemoteImages` hat aktuell KEINE technische Wirkung.** driftmail
parst/rendert nirgends HTML-Mail-Inhalte -- `mail/imapAdapter.ts`
(`simpleParser().text`) und `mail/gmailAdapter.ts`
(`extractPlainTextBody()`) extrahieren durchgaengig nur die
"text/plain"-Variante. Der klassische Tracking-Pixel-Angriffsweg (ein
unsichtbares `<img>`, das beim automatischen Laden der HTML-Mail dem
Absender IP/Oeffnungszeitpunkt meldet) kann in dieser Architektur schon
strukturell nicht greifen -- eine Mail, die NUR als HTML vorliegt, wird
von `mailparser`/der Gmail-API bereits vor der Speicherung auf reinen Text
reduziert, jedes `<img>` faellt dabei weg. Das ist ein echter,
unbeabsichtigter Privatsphäre-Vorteil des bestehenden Designs, kein
Feature, das extra gebaut werden musste -- der Schalter existiert trotzdem
echt (nicht nur ein Mock-Wert), fuer Transparenz und falls HTML-Rendering
je nachgezogen wird.

`blockTrackingLinks` hat ebenfalls noch keine technische Wirkung: eine
echte Umsetzung braeuchte die Link-Extraktion aus `message_links` (Tabelle
existiert seit Track 0 im Contract, hat aber -- unabhaengig von diesem
Auftrag entdeckt -- bis heute keine Backend-Implementierung, siehe
"Annahmen" unten). Separate, noch offene Luecke.

**2) Undo Send:** bewusst OHNE Backend-Aenderung -- wie im Auftrag selbst
vorgeschlagen ("Client zeigt sofort eine Rueckgaengig-Leiste, der
tatsaechliche Provider-Send-Call wird verzoegert ausgefuehrt") ist das eine
reine Client-Verzoegerung vor dem `POST /messages/send`-Aufruf. Kein
serverseitiger Zustand noetig.

**3) Darkweb-/Datenleck-Ueberwachung:** `GET /security/breaches` +
`PATCH /security/breaches/{id}` (`data_breach_findings`,
`data_breach_check_log`, `routes/breaches.ts`). Anbieter bewusst gemockt
(`lookups/dataBreachMock.ts`) -- ein echter Dienst wie haveibeenpwned
verlangt inzwischen einen kostenpflichtigen API-Key, den driftmail nicht
ungefragt fuer alle User vorfinanzieren will (gleiche Ueberlegung wie bei
der KI-Anbindungs-Korrektur, TERMINAL_INBOX.md 21.09.) -- ein BYOK-Modell
passt hier aber auch nicht (geteilter Bedrohungsdaten-Dienst, kein
persoenlicher KI-Zugang mit eigenen Nutzungskosten). Deterministischer
Test-Ausloeser (Adresse enthaelt "leaktest"/"pwned"), analog zu anderen
Mocks in `lookups/`. Laeuft periodisch im bestehenden Scheduler-Tick
(`mail/scheduler.ts runDataBreachChecks()`), aber mit eigenem
24-Stunden-Cooldown pro Konto (`data_breach_check_log`) -- Datenlecks
aendern sich nicht minuetlich. Upsert nach `(mail_account_id,
breach_name)` verhindert Duplikate bei wiederholten Läufen.

**4) Schedule Send:** `drafts` um `bccAddresses`/`scheduledFor` erweitert
(`POST`/`PATCH /drafts`). Der eigentliche Versand-Kern von
`POST /messages/send` wurde nach `mail/sendMessage.ts` ausgelagert
(`sendMessageForUser()`) -- sowohl die Route als auch der Scheduler
(`mail/scheduler.ts runDueScheduledSends()`) rufen jetzt exakt dieselbe
Funktion auf, damit ein automatisch verschickter geplanter Entwurf
GENAU denselben Weg nimmt (Phishing-Check, Anhang-Gate,
`outgoing_send_log`, "gesendet"-Ordner) wie ein direkter Versand -- gleiches
Prinzip wie `syncAccount()`, das ebenfalls sowohl vom manuellen
Sync-Endpunkt als auch vom Scheduler aufgerufen wird. Schlaegt der
automatische Versand fehl (Phishing-Check greift, Provider-Fehler): die
Planung wird aufgehoben (`scheduledFor` -> `null`), der Entwurf selbst
bleibt als normaler Entwurf erhalten (kein Datenverlust, kein endloser
Wiederholungsversuch).

**Bewusste Grenze:** Anhaenge werden bei Schedule Send (noch) nicht
unterstuetzt -- `DraftRecord` hat kein `attachmentIds`-Feld, waere ein
separater, groesserer Schritt (Anhaenge muessten bis zum faelligen
Versandzeitpunkt irgendwo vorgehalten werden, siehe die bestehende Grenze
bei "Anhänge" weiter unten -- Bytes werden aktuell generell nicht
dauerhaft gespeichert).

**5) Snooze:** `messages.snoozed_until` (additive Spalte, echte
ALTER-TABLE-Migration siehe unten). `POST /messages/{id}/snooze`
(`until: null` hebt ein bestehendes Snooze sofort auf). Bewusst OHNE
periodischen Scheduler-Job -- `store.listMessages()` filtert
`snoozed_until IS NULL OR snoozed_until <= now()` bei jedem Lesezugriff,
eine gesnoozte Nachricht taucht dadurch automatisch wieder auf, sobald die
Zeit erreicht ist, ohne dass sie irgendwo aktiv "entsnoozed" werden muss.
`GET /messages/{id}` direkt bleibt davon unberuehrt (zeigt eine gesnoozte
Nachricht weiterhin, inkl. `snoozedUntil`). Geprueft, ob die bestehende
`reminders`-Tabelle wiederverwendbar ist (wie im Auftrag vorgeschlagen) --
bewusst NICHT wiederverwendet: `reminders.contract_id` ist `NOT NULL`,
fest an die Vertragserkennung gebunden, nicht an einzelne Nachrichten --
gleiche Abwaegung wie schon beim "Nudge"-Feature.

**Tests:** `smoketest.ts` deckt alle vier Backend-relevanten Punkte ab
(Punkt 2 ist reine Client-Logik, nichts zu testen): Privatsphäre-
Einstellungen (Default + partielles Update), Snooze (ausgeblendet in der
Ordner-Liste, weiterhin sichtbar per direktem GET, Wiedereinblenden per
`until: null`), Schedule Send (Ablehnung bei Zeitpunkt in der
Vergangenheit/fehlendem Empfaenger, PATCH mit `scheduledFor: null` zum
Aufheben vs. undefined = unveraendert, ein noch-nicht-faelliger
Scheduler-Lauf tut nichts, ein faelliger verschickt echt + loescht den
Entwurf), Darkweb-Ueberwachung (drittes Test-Konto mit Trigger-Adresse,
zwei erwartete Treffer, kein Duplikat bei wiederholtem Lauf, das
unauffaellige Demo-Konto bleibt treffer-frei, Bestaetigen per PATCH).
Gruen in-memory + gegen frisches Postgres + gegen eine simulierte
Alt-Schema-DB (`drafts.bcc_addresses`/`scheduled_for` und
`messages.snoozed_until` fehlten vorher, `migrate()` legt sie korrekt
nach).

**Dabei behoben:** `PUT /settings`-Requestbody in `api-spec.yaml` hatte
`nudgeUnansweredEnabled` nicht dokumentiert, obwohl das Backend es schon
laenger akzeptiert (Uebersehen beim urspruenglichen Nudge-Auftrag) --
nachgetragen. Ausserdem `PostgresStore.updateDraft()` von einem
COALESCE-Muster (kann "Feld fehlt" nicht von "Feld = null" unterscheiden,
gleiche bekannte Grenze wie `updateContract()`) auf ein echtes
Lesen-Mergen-Schreiben umgestellt, weil Schedule Send eine echte
"Planung auf null setzen"-Semantik braucht, die COALESCE nicht kann.

## Malware-Scan (echt, ClamAV) -- [2026-09-21] Nachtrag
(WEB_INBOX.md 21.09. "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan")

**Vorgefundene Luecke:** Anhang-Scan existierte bisher NUR beim SENDEN
(`POST /attachments`), und selbst dort war es laut eigener Dokumentation
nur ein Mock (`attachmentScanMock.ts`: Dateiendungs-Blockliste + ein
deterministischer Dateiname-Trigger fuer "malicious", kein echter
Signatur-Abgleich). Fuer EINGEHENDE Mail-Anhaenge gab es ueberhaupt
keinen Scan -- eine Mail mit boesartigem Anhang landete komplett ungeprueft
im Postfach.

**Drei Ebenen, wie im Auftrag verlangt** (`lookups/attachmentScanClamAv.ts`,
jetzt die produktiv verdrahtete `AttachmentScanner`-Implementierung statt
des Mocks, siehe `lookups/index.ts`):
1. Dateiendungs-Blockliste (aus `attachmentScanMock.ts` uebernommen --
   ausfuehrbare/Makro-faehige Typen werden unabhaengig vom Inhalt geblockt).
2. Magic-Bytes-Pruefung (`lookups/magicBytes.ts`): erkennt eine als
   harmlos (z.B. `.jpg`/`.pdf`) getarnte, aber tatsaechlich ausfuehrbare
   Datei (PE/ELF/Mach-O-Header oder Shell-Skript-Shebang in den ersten
   Bytes) -- der klassische Umbenennungs-Trick. Bewusst kein npm-Paket wie
   `file-type` (reines ESM, wuerde in diesem CommonJS-Backend nur per
   dynamischem `import()` gehen) -- fuer die paar sicherheitsrelevanten
   Signaturen reicht eine kleine, selbst gepflegte Liste.
3. Echter ClamAV-Signaturabgleich ueber einen lokalen `clamd`-Daemon (per
   `clamscan`-npm-Package, Unix-Socket oder TCP), inklusive laufender
   Virendefinitionen (`freshclam`).

**Beide Richtungen** (wie im Auftrag "Bestehend (Senden)" + "NEU
(Empfangen)"):
- **Senden** (`routes/attachments.ts`): `multer` haelt den Upload ohnehin
  im Speicher (`file.buffer`) -- der Scan bekommt jetzt echte Bytes statt
  nur Metadaten (Dateiname/MIME-Typ/Groesse wie zuvor).
- **Empfangen** (neu, `mail/incomingAttachments.ts`): jeder Mail-Adapter
  liefert Anhaenge jetzt mit (`FetchedMail.attachments`, neues Feld in
  `mail/types.ts`) -- `imapAdapter.ts` bekommt sie direkt von `mailparser`
  fertig geparst mit, `gmailAdapter.ts` braucht dafuer einen zusaetzlichen
  `users.messages.attachments.get`-Aufruf pro Anhang (Gmail liefert bei
  `format=full` nur eine `attachmentId`-Referenz, nicht die Bytes selbst).
  `mail/sync.ts` scannt jeden Anhang direkt nach dem Import der Nachricht,
  unabhaengig von deren Spam/Phishing-Klassifikation.

**Wichtige Verhaltens-Entscheidung:** ein als `malicious` erkannter
eingehender Anhang loescht NICHT automatisch die ganze Mail (anders als
der bestehende spam/gambling-Auto-Delete-Pfad) -- ein legitimer Absender
koennte versehentlich einen infizierten Anhang mitschicken, der User soll
die Mail selbst trotzdem sehen koennen. Nur der Anhang selbst bleibt
gesperrt: `GET /messages/{id}` liefert jetzt ein neues
`attachments`-Array (`MessageAttachment`-Schema, api-spec.yaml) mit
`scanStatus` je Anhang, die Client-UI darf einen nicht-`clean` Anhang
nicht zum Oeffnen/Herunterladen anbieten.

**Ehrlicher Umgang mit einem nicht erreichbaren ClamAV-Daemon:** schlaegt
die Verbindung zu `clamd` fehl, faellt der Scanner NICHT stillschweigend
auf "clean" zurueck (anders als z.B. der KI-Adapter, wo ein Fallback auf
eine schwaechere Heuristik bei einem reinen Komfort-Feature vertretbar
ist) -- bei einem Sicherheits-Scanner waere das grob irrefuehrend.
Stattdessen liefert er den dafuer bereits im Contract vorgesehenen Wert
`scan_failed`: `POST /messages/send` lehnt das wie jeden Nicht-`clean`-
Status mit 422 ab, ein eingehender Anhang mit `scan_failed` wird in der
API-Antwort wie `malicious` behandelt (nicht oeffenbar). Echt
gegengetestet: `clamd` waehrend der Entwicklung kurz beendet, Scan-Aufruf
liefert nachweislich `scan_failed` (nicht `clean`), danach `clamd` wieder
gestartet und erneut gruen verifiziert.

### Lokales Setup (macOS, Homebrew)

```bash
brew install clamav

# Freshclam (Virendefinitionen) -- einmalig konfigurieren + laden:
cp /opt/homebrew/etc/clamav/freshclam.conf.sample /opt/homebrew/etc/clamav/freshclam.conf
# "Example"-Zeile am Anfang der Datei entfernen/auskommentieren, dann:
/opt/homebrew/opt/clamav/bin/freshclam --config-file=/opt/homebrew/etc/clamav/freshclam.conf

# clamd (Scan-Daemon) -- einmalig konfigurieren:
cp /opt/homebrew/etc/clamav/clamd.conf.sample /opt/homebrew/etc/clamav/clamd.conf
# "Example"-Zeile entfernen, dann LocalSocket (z.B. /tmp/clamd.sock) +
# DatabaseDirectory ergaenzen, siehe die Kommentare in clamd.conf.sample.

# Starten:
/opt/homebrew/opt/clamav/sbin/clamd --config-file=/opt/homebrew/etc/clamav/clamd.conf --foreground=false
```

Ohne laufenden `clamd` liefert JEDER Scan `scan_failed` (siehe oben) --
`POST /messages/send` mit einem Anhang schlaegt dann immer mit 422 fehl,
und der Smoketest scheitert an den EICAR-/Magic-Bytes-Testfaellen (siehe
unten). Ein laufender `clamd` ist damit fuer `npm test` PFLICHT, anders
als `DATABASE_URL` (die dort weiterhin optional bleibt, In-Memory-
Fallback).

**Tests:** `smoketest.ts` deckt beide Richtungen ab:
- Senden: eine unauffaellige Datei (`clean`), eine gefaehrliche Endung
  (`blocked_type`), die echte EICAR-Test-Signatur (offizieller,
  ungefaehrlicher AV-Test-String, von jedem echten Scanner inkl. ClamAV
  als Virus erkannt -> `malicious`), eine als `.jpg` getarnte Datei mit
  echtem PE-Header (`blocked_type` per Magic-Bytes).
- Empfangen: Fixture 4 (`fixtureAdapter.ts`, sonst ein voellig
  unauffaelliger, vertrauenswuerdiger Absender) hat jetzt einen echten
  EICAR-Anhang -- muss als `malicious` erkannt werden, UND die Mail selbst
  bleibt normal sichtbar (kein Auto-Delete). Fixture 9 (IBAN-Wechsel-im-
  Thread-Testfall) hat einen als PDF getarnten PE-Anhang -> `blocked_type`.

Gruen in-memory + gegen frisches Postgres (kein Migrations-Bedarf --
`message_attachments` existierte als Tabelle bereits, nur ohne bisherigen
Konsumenten fuer den Empfangen-Fall).

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
- ~~Gmail-OAuth-Consent-Flow (Autorisierung durch den End-User) ist nicht
  Teil dieses Durchstichs — der Adapter erwartet ein bereits vorhandenes
  Refresh-Token. Der eigentliche OAuth-Flow (Redirect/Callback-Route) ist
  ein späterer Schritt.~~ **Nachgezogen (Terminal, 10.09.):** siehe Abschnitt
  "Echter Google-Login" oben — der Redirect/Callback-Flow existiert jetzt
  für den Login, `mail_accounts.encrypted_oauth_token` wird dabei befüllt.
  `mail/gmailAdapter.ts` selbst nutzt dieses per-Konto-Token aber noch
  nicht (liest weiterhin nur die einzelne `GMAIL_REFRESH_TOKEN`-Env-Var) —
  die Verdrahtung "Sync nutzt das beim Login erhaltene Token pro Konto"
  bleibt ein separater, späterer Schritt (kein Blocker für Login/Auth
  selbst).
- Kein Hintergrund-Job/Webhook (Gmail Push, IMAP IDLE) — Sync läuft beim
  Serverstart und on-demand über `POST /internal/sync`
  (`src/routes/internal.ts`, **kein** Contract-Bestandteil, nur
  Betriebs-/Testhilfe für diesen Durchstich).
- `unsubscribe_actions`, `message_links`, `reminders`, ~~`signatures`~~,
  `ai_provider_config` existieren in `db-schema.sql`, haben aber (noch)
  keine Entsprechung in `api-spec.yaml`. Nicht in diesem Durchstich
  implementiert — siehe "Offene Fragen" in `SYNC.md`. **Nachgezogen
  (Terminal 21.09.):** `signatures` — siehe Abschnitt "Signaturen &
  Abwesenheitsassistent" unten, `api-spec.yaml` hat jetzt echte
  `GET`/`POST`/`PATCH`/`DELETE /signatures`-Pfade und das Backend liefert
  sie wirklich aus. `message_links`, `reminders` (Contract-Pfade existieren
  zwar bereits, siehe `/reminders`, aber ohne Backend-Implementierung) und
  `ai_provider_config` (ersetzt durch `user_ai_preference`, siehe
  "BYOK-Cloud-KI" oben) bleiben offen.
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
