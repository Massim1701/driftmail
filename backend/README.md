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
> ergänzt (Commit `5bb9531`). Mock-Adapter liefert `ipReputationFlag` immer
> `"unknown"` (kein echter Blocklist-Abgleich möglich), `heloMismatch`/
> `imageToTextRatio` einfache Platzhalterwerte (`false`/`null`) — echte
> Erkennung baut Track B.

> **Contract-Update (2026-09-08, WEB_INBOX.md "Ausgehender Phishing-Check im
> Composer" + Erweiterung, Commit `b6b3eb2`):** neuer Endpoint `POST
> /messages/draft/phishing-check` hinzugekommen. Mock-Implementierung siehe
> Abschnitt "Ausgehender Phishing-Check (Composer, Mock)" unten.

```
Mail-Adapter (Gmail/IMAP/Fixture) -> Sync-Pipeline -> Mock-KI-Analyse
  -> Ordner-Zuordnung + ggf. Auto-Quarantäne (phishing) / Auto-Delete
     (adult/gambling-Spam) -> API (GET/POST wie im Contract)
```

Node/TypeScript + Express. Kein produktionsreifer Code, sondern ein
startbares, testbares Skeleton für den ersten Track-übergreifenden
Durchstich.

## Starten

```bash
npm install
npm run dev        # tsx watch, http://localhost:3000
# oder:
npm run build && npm start
```

Ohne jede Konfiguration synct der Server beim Start automatisch ein
Demo-Konto gegen den **Fixture-Mail-Adapter** (5 Beispiel-Mails: normale
Mail, Phishing-Versuch, Spam-Newsletter [marketing], Vertragsmail,
Glücksspiel-Spam [wird sofort automatisch gelöscht, siehe unten]) und
läuft sofort end-to-end durch — kein Postgres, kein Google/IMAP-Setup
nötig.

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
Umbenennung/Löschung bei System-Ordnern), `/v1/messages` (inkl.
`folderId`-Filter), `/v1/messages/:id`, `/v1/messages/:id/move`,
`/v1/messages/:id/summary`, `/v1/messages/:id/reply-draft`,
`/v1/messages/:id/quarantine`, `/v1/contracts`,
`/v1/contracts/:id/confirm`, `/v1/capability-check`. Bricht mit
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
- Sync-Pipeline (`src/mail/sync.ts`): Dedupe über
  `(mail_account_id, message_id_header)` wie im Schema (`UNIQUE`-Constraint
  auf `messages`), Ordner-Zuordnung, Auto-Quarantäne bei
  `classification === "phishing"`, Auto-Delete bei `classification ===
  "spam"` + `spamSubcategory` `adult`/`gambling` (siehe eigener Abschnitt
  unten).
- Ordner-Verwaltung (`src/routes/folders.ts`): System-Ordner + eigene
  Ordner, siehe Abschnitt "Ordner (benutzerdefiniert)" unten.

**Mock/Stub (bewusst, siehe Auftrag):**
- **KI-Logik** (`src/ai/mockAdapter.ts`): implementiert
  `contracts/ai-adapter-interface.ts` vollständig, aber mit simplen
  Keyword-Heuristiken statt echter Klassifikation/Extraktion — liefert
  plausible Beispieldaten. Track B (Sicherheits-Klassifikation) und Track D
  (Vertrag & Reminder) ersetzen das später; der Austausch betrifft nur
  `src/ai/index.ts` (eine Zeile), da Routen/Sync-Pipeline ausschließlich
  gegen das `AiAdapter`-Interface arbeiten.
- **Fixture-Mail-Adapter** (`src/mail/fixtureAdapter.ts`): Standardpfad
  ohne echte Zugangsdaten, damit das Skeleton ohne Setup läuft und
  testbar ist (siehe "Annahmen" unten).
- **Persistenz**: In-Memory-Store (`src/db/store.ts`) statt echtem
  Postgres, siehe "Annahmen".
- **Auth**: keine — kein Login/Session/Token-Handling in diesem
  Durchstich, ein fester "Demo-User" wird beim Start angelegt.
- **Ausgehender Phishing-Check** (`src/ai/draftPhishingCheckMock.ts`,
  Endpoint `POST /messages/draft/phishing-check`): simple, ehrliche
  Mock-Heuristik (Link-Mismatch, einfache Regex-Erkennung für IBAN/
  Kreditkarte, `recipientReputation` immer `"unknown"`) — NICHT die echte
  Erkennungslogik. Track B hat diese bereits gebaut
  (`security-classification/src/draftPhishingCheck.ts`), siehe eigener
  Abschnitt unten.

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
erneut "entdeckt". Behelf dafür: `store.autoDeletedHeaders`
(In-Memory-`Set<mailAccountId:messageIdHeader>`, kein Mail-Inhalt) in
`src/db/store.ts` — reines Prozess-Gedächtnis, geht bei Neustart verloren;
für eine echte Postgres-Anbindung müsste das durch eine leichtgewichtige,
inhaltslose Tabelle (nur Header-Hash) ersetzt werden.

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
  automatisch 5 System-Ordner (`is_system=true`), Namen/Icons/Reihenfolge
  1:1 aus `contracts/design-tokens.json` (`systemFolders.defaults`):
  `wichtig` (star), `sonstiges` (inbox), `rechnungen` (receipt),
  `quarantaene` (shield-exclamation), `spam` (trash).
- Eigene Ordner (`POST /folders`) haben `is_system=false`,
  `system_key=null` und als Default-Icon `folder`
  (`contracts/design-tokens.json` → `customFolder.defaultIcon`).
- `PATCH /folders/:folderId`: Name/Icon/Reihenfolge änderbar. Ausnahme:
  `quarantaene` und `spam` sind laut Design-Token (`renamable: false`)
  **nicht umbenennbar** — ein `PATCH` mit `name` auf diese beiden liefert
  `400`. Icon/Reihenfolge bleiben bei diesen beiden änderbar, da der
  Contract dazu nichts einschränkt.
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

## Ausgehender Phishing-Check (Composer, Mock)

Seit dem Contract-Update vom 08.09. (`WEB_INBOX.md` "Ausgehender
Phishing-Check im Composer" + Erweiterung, Commit `b6b3eb2`) gibt es
`POST /messages/draft/phishing-check`: prüft einen Mail-ENTWURF (`bodyText`
+ `links`) vor dem Versand, bevor er den Composer verlässt.

**Implementierung:** `src/ai/draftPhishingCheckMock.ts`
(`checkDraftForPhishingMock()`), verdrahtet in `src/routes/messages.ts`.

**Grenze — bewusst Mock, kein `AiAdapter`-Austausch wie sonst:** Track B
(Sicherheits-Klassifikation, Branch `track-b-security`) hat die ECHTE
Erkennungslogik dafür bereits gebaut
(`security-classification/src/draftPhishingCheck.ts`,
`checkDraftForPhishing()`) — inkl. Homoglyph-Domain-Erkennung, Mod-97
validierter IBAN- und Luhn-validierter Kreditkarten-Erkennung. Track A
(`backend/`) und Track B (`security-classification/`) sind aktuell zwei
getrennte npm-Packages ohne formale Abhängigkeit zueinander — `backend/`
hat keine Dependency auf `security-classification/`. Die echte Integration
(dieses Mock-Modul durch einen Aufruf von Track B's Funktion ersetzen, z.B.
über eine Workspace-Dependency oder einen internen Aufruf) ist ein
separater, noch **nicht gestarteter** Integrations-Schritt — bewusst außen
vor gelassen (siehe Auftrag), analog zur "Was ist echt/Mock"-Trennung beim
`AiAdapter` oben.

Diese Mock-Implementierung folgt derselben Grund-Logik wie Track B, aber
vereinfacht:
- **Link-Mismatch:** simple Heuristik — Domain aus dem tatsächlichen
  Link-Ziel (`actualUrl`) und aus dem Anzeigetext (`displayText`, falls der
  selbst wie eine Domain/URL aussieht) extrahieren und vergleichen; kein
  Homoglyph-Check (anders als Track B), keine Subdomain-Sonderbehandlung.
- **`blocked` (harter Block, siehe api-spec.yaml-Kommentar):** `true`, wenn
  ein Link-Mismatch gefunden wurde ODER Dringlichkeits-Sprache UND eine
  Zugangs-/Zahlungsdaten-Anfrage gleichzeitig im Text vorkommen (simple
  Keyword-Listen, gleiches Muster wie `src/ai/mockAdapter.ts`s
  `PHISHING_KEYWORDS`) — bewusst eine UND-Verknüpfung wie bei Track B, weil
  jedes Signal allein auch in legitimen Mails vorkommt.
- **`containsSensitiveData` (IBAN/Kreditkarte):** simple Regex-Kandidaten,
  **ohne** Prüfsumme (kein Mod-97 für IBAN, kein Luhn für Kreditkarten) —
  Auftrag sagt explizit "IBAN-Erkennung simple Regex reicht". Mehr false
  positives/negatives als Track B's validierte Version. `"other"` (z.B.
  Sozialversicherungsnummer) bewusst nicht implementiert, gleiche
  Begründung wie bei Track B (kein einheitliches, per Regex sauber
  erkennbares Format über Länder hinweg).
- **`recipientReputation`:** immer `"unknown"`, genau wie bei Track B
  dokumentiert. Bei Track B, weil das Paket zustandslos ist (kein
  DB-Zugriff). Hier im Backend absichtlich **genauso** gehalten, obwohl
  `backend/` grundsätzlich DB-Zugriff hätte: die dafür nötige
  `fraud_alerts`-Tabelle (`contracts/db-schema.sql`) ist in diesem Skeleton
  noch nicht modelliert (kein Record-Typ in `src/types.ts`, kein
  Store-Zugriff) — ein echter Empfänger-Reputations-Lookup ist wie die
  Track-B-Integration ein separater, noch offener Schritt (siehe SYNC.md
  "Offene Fragen").

**Tests:** `src/smoketest.ts` deckt einen Block-Fall (Link-Mismatch,
`blocked === true` + `reason` gesetzt + genau 1 `riskyLink`) und einen
Nicht-Block-Fall mit sensiblen Daten ab (eigene IBAN im Text —
`blocked === false`, `containsSensitiveData` enthält `"iban"`,
`recipientReputation === "unknown"`).

## Annahmen (nicht selbst im Contract entscheidbar, siehe SYNC.md)

- `contracts/db-schema.sql` ist Postgres-DDL, aber ein DB-Server war nicht
  Teil des Auftrags/Setups. Für den ersten Durchstich wurde eine
  In-Memory-Repository-Schicht mit identischen Feldern/Typen gebaut
  (`src/db/store.ts`). Der Wechsel auf echtes Postgres (z.B. mit `pg`)
  sollte nur dieses eine Modul betreffen, da Routen/Sync-Pipeline nur
  gegen die Store-Methoden arbeiten, nicht gegen SQL direkt.
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
- `fraud_alerts` (`contracts/db-schema.sql`) ist ebenfalls noch nicht in
  `src/types.ts`/`src/db/store.ts` modelliert — deshalb liefert
  `recipientReputation` in `POST /messages/draft/phishing-check` immer
  `"unknown"` statt eines echten Lookups, siehe Abschnitt "Ausgehender
  Phishing-Check (Composer, Mock)" oben.
- `send_abuse_flags` (Bot/Human-Missbrauchserkennung beim Versand,
  WEB_INBOX.md 08.09. "Ausgehender Phishing-Check im Composer") existiert
  bisher **weder** in `contracts/db-schema.sql` noch in
  `contracts/api-spec.yaml` — nur als SQL-Vorschlag in `WEB_INBOX.md`
  dokumentiert. Kein eigener Versand-Pfad in diesem Durchstich (siehe
  oben, "Kein Hintergrund-Job"), daher hier nicht mitgebaut; siehe
  SYNC.md "Offene Fragen".

## Struktur

```
src/
  app.ts              Express-App, Router-Mounting (/v1 = Contract, sonst intern)
  index.ts             Serverstart + initialer Sync
  types.ts             interne Modelle + API-Shapes (Spiegel von db-schema.sql / api-spec.yaml)
  mappers.ts            interne Records -> API-Response-Shapes
  routes/               ein Router-Modul je api-spec.yaml-Ressource (inkl. folders.ts) + internal.ts (Health/Sync/Seed)
  db/store.ts           In-Memory-Repository (siehe "Annahmen")
  mail/                 MailAdapter-Interface + Gmail/IMAP/Fixture-Implementierungen + Sync-Pipeline
  ai/                   AiAdapter-Interface (Spiegel von ai-adapter-interface.ts) + Mock-Implementierung + draftPhishingCheckMock.ts (Composer-Phishing-Check-Mock)
  smoketest.ts           End-to-End-Test (npm test)
```
