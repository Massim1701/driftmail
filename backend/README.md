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

## Ordner (benutzerdefiniert)

Seit dem Contract-Update vom 08.09. (SYNC.md, Commit `734781e`) sind
Ordner eigene Datensätze (Tabelle `folders`) statt eines festen
Enum-Strings auf `messages.folder`:

- Jeder User bekommt beim Anlegen (`ensureDemoUser()` in `src/db/store.ts`)
  automatisch 6 System-Ordner (`is_system=true`), Namen/Icons/Reihenfolge
  1:1 aus `contracts/design-tokens.json` (`systemFolders.defaults`):
  `wichtig` (star), `sonstiges` (inbox), `rechnungen` (receipt),
  `quarantaene` (shield-exclamation), `spam` (trash), `papierkorb`
  (trash-2, seit dem Nachtrag vom 08.09., siehe Abschnitt "Papierkorb /
  Löschen" unten).
- Eigene Ordner (`POST /folders`) haben `is_system=false`,
  `system_key=null` und als Default-Icon `folder`
  (`contracts/design-tokens.json` → `customFolder.defaultIcon`).
- `PATCH /folders/:folderId`: Name/Icon/Reihenfolge änderbar. Ausnahme:
  `quarantaene`, `spam` und `papierkorb` sind laut Design-Token
  (`renamable: false`) **nicht umbenennbar** — ein `PATCH` mit `name` auf
  diese drei liefert `400`. Icon/Reihenfolge bleiben bei diesen drei
  änderbar, da der Contract dazu nichts einschränkt.
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
