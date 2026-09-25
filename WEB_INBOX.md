# WEB_INBOX.md — Warteschlange von Web-Claude an Claude Code

Protokoll: Web-Claude hängt neue Einträge unten an (nie mittendrin einfügen,
immer ans Ende, das ist sicherer als in bestehende Dateien zu springen).
Claude Code prueft diese Datei in seiner Loop (git pull + Blick auf diese
Datei vor jedem Task-Start reicht). Fuer jeden offenen Eintrag:

1. Aenderung im Zieldateipfad umsetzen
2. Committen + pushen
3. Eintrag hier von "offen" auf "erledigt: <commit-hash>" setzen

Format: [Datum] [Status] [Zieldatei] — Beschreibung + Code-Block

---

[2026-09-08] [erledigt: 004c3b6] [contracts/db-schema.sql] — Neue Tabelle für Paketdienst-Erkennung (gleiches Muster wie Vertragserkennung: DHL/UPS/Hermes-Mails erkennen, Tracking-Status zeigen).

```sql
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  carrier TEXT,
  tracking_number TEXT,
  status TEXT NOT NULL DEFAULT 'in_transit'
    CHECK (status IN ('in_transit', 'out_for_delivery', 'delivered', 'delayed', 'problem')),
  estimated_delivery DATE,
  extracted_confidence NUMERIC(3,2)
);
```

An ans Ende von `contracts/db-schema.sql` anhängen, analog zur `contracts`-Tabelle. Kein Blocker, kein Contract-Bruch fuer bestehende Tracks.

[2026-09-08] [erledigt: 004c3b6] [SYNC.md] — Qualitäts-Checkliste ergänzen, die jeder Track vor dem Status "fertig" selbst abhakt (Vorbild: Track E, siehe dessen README). Bitte als neuen Abschnitt "## Qualitäts-Checkliste" in SYNC.md einfügen (z.B. vor "## Blocker"):

```
## Qualitäts-Checkliste (vor Status "fertig" je Track)

- [ ] Grenzen explizit benannt: was ist Platzhalter, was ist echt umgesetzt
- [ ] Jede eigene Design-Entscheidung dokumentiert (Datum + Begründung), nicht stillschweigend getroffen
- [ ] Edge Cases behandelt, nicht nur der Erfolgsfall
- [ ] Tests vorhanden und grün, Typprüfung sauber
- [ ] Klare Übergabe: was der aufrufende Track (z.B. Backend/UI) noch selbst tun muss
```

Kein Blocker. Gilt ab sofort für alle Tracks, die noch nicht "fertig" gemeldet haben.

[2026-09-08] [beantwortet, siehe TERMINAL_INBOX.md] [SYNC.md] — Korrektur: die beiden Eintraege "db-schema.sql um sechs Sicherheits-Tabellen ergaenzt" und "WICHTIGE CONTRACT-AENDERUNG: Feste Ordner-Enum ersetzt" sind faelschlich mit [web] markiert. Beide Aenderungen kamen von Terminal/Claude Code (Commits von Massim1701, nicht von Web-Browser-Edits). Bitte in SYNC.md auf [terminal] korrigieren.

Inhaltlich: Beide Aenderungen sind mit Massimo abgestimmt und bleiben (freie Ordner-Erstellung + die 6 Security-Tabellen), das ist kein Rollback. Es geht nur um die korrekte Quellen-Markierung in der Historie.

Regel fuer kuenftige Eigeninitiative (bitte in SYNC.md-Kopfregeln ergaenzen): Contract-Aenderungen (contracts/*), die ueber eine reine Bugfix-Ergaenzung hinausgehen (z.B. neue Kernfunktionalitaet wie frei anlegbare Ordner), bitte VOR dem Commit als [offen] in WEB_INBOX.md oder als Frage in SYNC.md "Offene Fragen" ankuendigen, nicht erst danach dokumentieren. Kleinere Ergaenzungen (fehlende Felder, zusaetzliche Tabellen fuer bereits vereinbarte Features) koennen weiter direkt umgesetzt und im Nachhinein dokumentiert werden.

[2026-09-08] [erledigt: 37a22d3 (Contract), 881354a (Track A Backend, Auto-Delete-Pfad), Track B (Erkennung): erledigt, siehe SYNC.md Track-B-Eintrag auf Branch track-b-security] [contracts/db-schema.sql + Track B] — Neue Spam-Unterkategorie fuer aggressives Auto-Loeschen bei eindeutigem Erotik-/Gluecksspiel-Spam (kein Phishing-Risiko dort, daher andere Regel als bei Phishing/Quarantaene).

```sql
ALTER TABLE message_security ADD COLUMN spam_subcategory TEXT
  CHECK (spam_subcategory IN ('adult', 'gambling', 'generic', 'marketing'));
```

Handlungslogik (Track B / Klassifikations-Layer):
- classification = 'spam' UND spam_subcategory IN ('adult','gambling') -> sofort loeschen, KEINE Quarantaene, kein 30-Tage-Aufheben, kein Undo.
- spam_subcategory IN ('generic','marketing') -> Verhalten unveraendert (Spam-Ordner, normale Aufbewahrung).
- classification = 'phishing' -> von dieser Regel komplett unberuehrt, Vorsicht/Quarantaene bleibt Pflicht.

Erkennung laeuft im selben Klassifikations-Layer wie Spam/Phishing (Content-Scan + Keywords, ggf. Bilderkennung bei Anhaengen). Kein Blocker, betrifft primaer Track B; Track A muss ggf. den Auto-Delete-Pfad in der Message-Pipeline ergaenzen (analog zum Quarantaene-Pfad, nur ohne Aufbewahrung).

[2026-09-08] [terminal] [Track A] — Auto-Delete-Pfad in `backend/src/mail/sync.ts` umgesetzt (Commit `881354a` auf `track-a-backend`): `classification === 'spam'` + `spamSubcategory` in `['adult','gambling']` -> Nachricht wird gar nicht erst persistiert (kein `messages`-/`message_security`-/`quarantine`-Eintrag, kein 30-Tage-Aufheben, kein Undo); `generic`/`marketing` und `phishing` unveraendert. `spamSubcategory` bis zur Integration mit Track B weiterhin nur ueber simple Keyword-Heuristik im Mock-KI-Adapter (`ai/mockAdapter.ts`) befuellt. Details/Design-Entscheidung (nicht persistieren statt persistieren+loeschen, Audit-Log ohne Inhalt, Dedupe-Behelf ohne DB) in `backend/README.md` Abschnitt "Auto-Delete: adult/gambling-Spam" und `SYNC.md`-Aenderungsprotokoll. Offen: Integration der echten Track-B-Erkennung anstelle des Mocks.


[2026-09-08] [erledigt: e9c74dc (Contract), Track B fuer Erkennung folgt] [contracts/db-schema.sql + Track B] — Ergaenzung zum Spam-Subcategory-Eintrag von eben: Botnetz-Erkennungssignale, da Botnetz-Spam KEINEN stabilen Absender hat (IP/Domain wechseln staendig, Absender oft gefaelscht/gekaperte Accounts). Erkennung muss auf Infrastruktur-Verhalten zielen, nicht auf Absender-Blocklisten.

```sql
ALTER TABLE message_security ADD COLUMN ip_reputation_flag TEXT
  CHECK (ip_reputation_flag IN ('clean', 'known_botnet', 'unknown'));
ALTER TABLE message_security ADD COLUMN helo_mismatch BOOLEAN DEFAULT false;
ALTER TABLE message_security ADD COLUMN image_to_text_ratio NUMERIC(3,2);
```

Bedeutung der Felder:
- ip_reputation_flag: Abgleich der sendenden IP gegen Botnetz-spezifische Listen (z.B. Spamhaus XBL/CBL — anders als normale Spam-Listen, die zielen auf "IP gehoert zu kompromittiertem Geraet", nicht auf Domain-Reputation).
- helo_mismatch: HELO/EHLO-Hostname der sendenden Verbindung passt nicht zur Reverse-DNS der IP. Klassisches Botnetz-Merkmal, echte Mailserver sind darin konsistent.
- image_to_text_ratio: hoher Bildanteil bei wenig Fliesstext ist eine bekannte Umgehungstaktik gegen Text-Filter (Werbetext steckt im Bild).

Zusaetzlich pruefenswert (kein eigenes Feld noetig, kann in der Klassifikationslogik selbst laufen): zeitliche Haeufung strukturell aehnlicher Mails von wechselnden, vorher nie gesehenen Absendern/IPs in kurzer Zeit; algorithmisch wirkende Zufallsmuster im lokalen Teil der Absenderadresse.

Verknuepfung mit der Auto-Loesch-Regel von eben: kein einzelnes Signal reicht allein aus, aber ip_reputation_flag = 'known_botnet' UND helo_mismatch UND hoher image_to_text_ratio zusammen ist ein starkes Muster fuer classification = 'spam' + spam_subcategory IN ('adult','gambling') -> sofort loeschen. Kein Blocker.


[2026-09-08] [zur Kenntnis genommen, keine Aktion noetig -- Track A baut aktuell keinen eigenen Versand-Pfad] [Track A + Infra/DNS, nicht akut] — Ausgehende Mail-Authentifizierung ("erkennbar als echte Mail" fuer fremde Mailserver). Zwei getrennte Faelle, WICHTIG nicht verwechseln:

Fall 1 — Versand ueber Nutzer-eigenes Gmail/IMAP-Konto (aktueller Stand):
Braucht KEINE eigene Massnahme. Wenn driftmail ueber die offizielle Gmail API sendet, signiert Google selbst per DKIM — fremde Server sehen "kommt von Google, legitim". Wichtig ist nur: Versand MUSS ueber die offizielle Provider-API laufen (Gmail API / Provider-SMTP mit Auth), nicht ueber einen selbstgebauten SMTP-Client mit gefaelschtem From-Header.

Fall 2 — driftmail bekommt eine eigene Absender-Domain (spaeter, z.B. @driftware.online-Adressen oder System-Benachrichtigungen):
Das ist reine DNS-Konfiguration bei der Domain, KEIN UI-Feature im Compose-Fenster, User sieht davon nichts. Noetig sobald driftmail selbst Mails im eigenen Namen verschickt:
- SPF-Record bei driftware.online: legt fest, welche Server im Namen der Domain senden duerfen.
- DKIM-Signierung: jede ausgehende Mail bekommt eine kryptografische Signatur (Private Key im Backend, Public Key als DNS TXT-Record).
- DMARC-Policy (TXT-Record _dmarc.driftware.online): sagt fremden Servern, was bei SPF/DKIM-Fail passieren soll (reject/quarantine/none), plus Reporting-Adresse.

Kein Blocker jetzt, da Fall 2 noch nicht akut ist (kein eigener Versand-Server aktiv). Bitte trotzdem vormerken: sobald Track A einen eigenen Mail-Versand-Pfad baut (nicht nur Weiterleitung an Provider-APIs), hier nochmal anfragen bevor das live geht — DKIM-Key-Erzeugung und DNS-Eintraege muessen VOR dem ersten eigenen Versand stehen, sonst landet alles automatisch im Spam der Empfaenger.


[2026-09-08] [erledigt: Phishing-Check-Endpoint + echte Track-B-Integration Commit 613e27a (09.09.); send_abuse_flags-Erkennung (rate_burst/many_new_recipients/duplicate_content/no_read_before_reply) Commit 411678f (25.09.), eigene dokumentierte Schwellenwerte in backend/src/mail/sendAbuseDetection.ts, siehe backend/README.md "Versand-Missbrauchserkennung"] [contracts/api-spec.yaml + contracts/db-schema.sql + Track A/B] — Ausgehender Phishing-Check im Composer: erkennt der Composer, dass ein Mail-ENTWURF Phishing-Merkmale hat, darf er NICHT gesendet werden (harter Block, kein Warnen-und-trotzdem-erlauben wie bei den anderen Abuse-Flags aus dem vorherigen Eintrag). Schuetzt driftmail selbst davor, als Phishing-Versandweg missbraucht zu werden (z.B. durch kompromittiertes Geraet/Konto).

Erkennung nutzt dieselbe Logik wie beim Empfang (siehe SecurityResult/analyzeMail in ai-adapter-interface.ts), nur angewendet auf den eigenen Entwurf statt auf eingehende Mails: Link-Mismatch (Anzeigetext vs. Ziel-URL), Homoglyph-Domains in Links, Kombination aus Dringlichkeits-Sprache + Zugangsdaten-/Zahlungsdaten-Anfrage.

Vorschlag API-Spec-Ergaenzung (neuer Endpoint, wird VOR dem eigentlichen Sende-Call aufgerufen bzw. blockiert send-draft):
```yaml
  /messages/draft/phishing-check:
    post:
      summary: Prueft einen Mail-Entwurf auf Phishing-Merkmale vor dem Versand
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                bodyText: { type: string }
                links:
                  type: array
                  items:
                    type: object
                    properties:
                      displayText: { type: string }
                      actualUrl: { type: string }
      responses:
        "200":
          description: Ergebnis
          content:
            application/json:
              schema:
                type: object
                properties:
                  blocked: { type: boolean }
                  reason: { type: string, nullable: true }
```

send_abuse_flags.flag_reason (siehe vorheriger Eintrag) um 'phishing_content' erweitern:
```sql
ALTER TABLE send_abuse_flags DROP CONSTRAINT IF EXISTS send_abuse_flags_flag_reason_check;
ALTER TABLE send_abuse_flags ADD CONSTRAINT send_abuse_flags_flag_reason_check
  CHECK (flag_reason IN ('rate_burst', 'many_new_recipients', 'duplicate_content', 'no_read_before_reply', 'phishing_content'));
```

WICHTIG: bei flag_reason = 'phishing_content' ist action_taken immer zwingend 'send_blocked', NIE 'warned' oder 'rate_limited' — anders als bei den uebrigen Gruenden. UI/Backend muss das als Ausnahme von der sonstigen "erst warnen"-Logik behandeln. Kein Blocker, aber bitte vor Fertigstellung des Compose/Send-Flows (Track A + jeweiliger UI-Track) beruecksichtigen.


[2026-09-08] [erledigt: b6b3eb2 (Contract-Felder in api-spec.yaml), Track B Erkennung fertig (security-classification/src/draftPhishingCheck.ts inkl. creditCardDetection.ts/credentialRequestLanguage.ts fuer sensible Daten; recipientReputation bleibt dort bewusst immer "unknown", DB-Zugriff auf fraud_alerts noetig, den dieses Modul nicht hat), Track A Mock-Logik gebaut (backend/src/ai/draftPhishingCheckMock.ts: containsSensitiveData ueber simple IBAN/Kreditkarten-Regex ohne Pruefsumme, recipientReputation via eigenem Lookup-Adapter aus outgoing_send_log/messages "safe"/"flagged" statt fest "unknown", riskyLinks ueber simple Link-Mismatch-Heuristik -- Details/Grenzen siehe backend/README.md Abschnitt "Ausgehender Phishing-Check (Composer, Mock)"), echte Integration Mock->Track-B-Logik + UI-Logik folgen (Track A/C/F)] [Erweiterung des Phishing-Check-Eintrags von eben, contracts/api-spec.yaml + Track A/UI] — Drei zusaetzliche Signale fuer denselben "Check vor dem Senden"-Moment (POST /messages/draft/phishing-check), NICHT als harter Block wie Phishing, sondern als nicht-blockierender Warnhinweis (Sprechblase/Tooltip nahe der betroffenen Textstelle):

1. Eigene sensible Daten im Entwurf erkannt (Kontonummer/IBAN-Muster, Kreditkarten-Muster, evtl. Sozialversicherungsnummer-Muster). Ist NICHT per se falsch (z.B. eigene IBAN fuer eine Ueberweisung mitteilen) — deshalb Warnhinweis, kein Blockieren. Sprechblase z.B.: "Diese Mail enthaelt eine Kontonummer. Pruef kurz, ob der Empfaenger vertrauenswuerdig ist."

2. Empfaenger-Reputation: Ziel-Adresse gegen bekannte Betrugsmuster pruefen (Abgleich mit fraud_alerts/domain_reputation_score, die es fuer eingehende Mails schon gibt — hier auf die Empfaenger-Adresse angewendet). Ist die Kombination "sensible Daten im Text" + "Empfaenger mit schlechter Reputation" gegeben, wird der Hinweis deutlich schaerfer formuliert (nicht automatisch blockiert wie bei Phishing-Inhalt selbst, aber sehr auffaellig, z.B. rote statt gelbe Sprechblase).

3. Links im Entwurf/in der angezeigten Mail in Echtzeit pruefen und bei Verdacht SOFORT rot markieren (nicht erst nach Analyse-Verzoegerung) — nutzt dieselben Signale wie message_links (domain_matches_display, is_known_malicious). Gilt fuer Links in empfangenen Mails genauso wie im eigenen Entwurf.

Vorschlag: draft/phishing-check Response um folgende Felder erweitern:
```yaml
                  containsSensitiveData:
                    type: array
                    items: { type: string, enum: [iban, credit_card, other] }
                  recipientReputation:
                    type: string
                    enum: [safe, unknown, flagged]
                  riskyLinks:
                    type: array
                    items:
                      type: object
                      properties:
                        url: { type: string }
                        reason: { type: string }
```

design-tokens.json: Farbrolle fuer sofortige Link-Markierung ergaenzen (nutzt vorhandenes danger-Rot, kein neues Farbschema noetig) — bitte kurze Notiz in Track F/C aufnehmen, dass Link-Markierung CSS-seitig sofort beim Rendern passiert, nicht erst nach Server-Antwort (optimistische UI, Server-Check laeuft parallel nach).

Kein Blocker. Betrifft Track A (Recipient-Reputation-Logik, PII-Pattern-Erkennung) und alle Compose-/Anzeige-UI-Tracks (C/F).


[2026-09-08] [erledigt: alle 3 Schritte, siehe nachfolgende Eintraege (a5432e6 send_abuse_flags, Track B Sicherheits-Eintraege, Track A Backend)] [PRIORITAET - bitte zuerst] [an Track B, dann A] — Massimo moechte, dass die Warteschlange jetzt konkret abgearbeitet wird, nicht weiter wachsen. Bitte in dieser Reihenfolge:

1. ZUERST: main in alle 6 Track-Branches mergen (falls noch nicht geschehen — Branches waren zuletzt 11 Commits hinter main, u.a. wegen Ordner-Umbau folder_id statt folder-Enum, user_ai_preference, spam_subcategory, Botnetz-Signale). Ohne das bauen alle Tracks gegen veraltete Contracts.

2. Track B: die drei bisher offenen Sicherheits-Eintraege in dieser Datei umsetzen (spam_subcategory + Auto-Loeschregel, Botnetz-Erkennungssignale, Bot/Human-Missbrauchserkennung beim Versand, Phishing-Check-Endpoint inkl. sensible-Daten/Empfaenger-Reputation/Link-Markierung-Erweiterung). Jeweils nach der Qualitaets-Checkliste in SYNC.md fertigstellen (Grenzen benennen, Annahmen dokumentieren, Tests, klare Uebergabe).

3. Danach Track A wie zuvor besprochen: Backend nach aktueller api-spec.yaml (inkl. aller Erweiterungen aus dieser Datei).

Kein neuer Scope, nur Abarbeitung des bereits Vereinbarten. Bitte Status je erledigtem Punkt hier und in SYNC.md aktualisieren, damit der Fortschritt sichtbar ist.


[2026-09-08] [erledigt: a5432e6] [contracts/db-schema.sql] — Nachlieferung: vollstaendige CREATE TABLE send_abuse_flags Definition (wurde im Bot/Human-Missbrauchserkennungs-Eintrag nur per ALTER TABLE referenziert, aber die eigentliche CREATE TABLE fehlte — danke fuers Nachfragen statt Raten). Zusammen mit outgoing_send_log, wie urspruenglich gemeint:

```sql
CREATE TABLE outgoing_send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_address TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  time_since_draft_shown_ms INTEGER,
  was_new_recipient BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE send_abuse_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flag_reason TEXT NOT NULL CHECK (flag_reason IN
    ('rate_burst', 'many_new_recipients', 'duplicate_content', 'no_read_before_reply', 'phishing_content')),
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  action_taken TEXT NOT NULL DEFAULT 'warned' CHECK (action_taken IN ('warned', 'rate_limited', 'send_blocked')),
  resolved BOOLEAN NOT NULL DEFAULT false
);
```

Hinweis: 'phishing_content' ist hier direkt mit drin (nicht per separatem ALTER TABLE nachtraeglich), also keine weitere ALTER-TABLE-Migration noetig fuer den Phishing-Check-Eintrag von vorhin — die dortige "DROP CONSTRAINT / ADD CONSTRAINT"-Migration kann entfallen, wenn diese CREATE TABLE-Version direkt verwendet wird (z.B. falls die Migration noch nicht ausgefuehrt wurde). Falls send_abuse_flags bei euch schon ohne 'phishing_content' angelegt wurde, dann bitte die vorherige ALTER-TABLE-Migration wie spezifiziert nachziehen. Verhalten (warnen vs. blocken) wie in den beiden vorherigen Eintraegen beschrieben: bei flag_reason = 'phishing_content' immer action_taken = 'send_blocked', bei allen anderen Gruenden zunaechst 'warned'/'rate_limited'. Kein Blocker.


[2026-09-08] [erledigt: 156f0fd (Contract), Track A/C/F Umsetzung folgt] [contracts/api-spec.yaml + contracts/db-schema.sql + Track A/C/F] — Fehlende Basis-Funktion entdeckt: manuelles Loeschen einer Mail durch den User gibt es noch nicht im Contract (nur Quarantaene, Verschieben, automatische Loeschregeln fuer Spam/Phishing). Nachtrag, analog zu Gmail-Verhalten: Loeschen = in Papierkorb verschieben (soft delete), kein sofortiges Hard-Delete.

1. Neuer System-Ordner "Papierkorb" in design-tokens.json systemFolders.defaults ergaenzen (system_key = 'papierkorb', analog zu quarantaene/spam -- ebenfalls nicht umbenennbar/loeschbar wie die anderen System-Ordner).

2. Neuer Endpoint in api-spec.yaml:
```yaml
  /messages/{messageId}:
    delete:
      summary: Mail in den Papierkorb verschieben (soft delete)
      parameters:
        - name: messageId
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: In Papierkorb verschoben

  /messages/{messageId}/permanent:
    delete:
      summary: Mail endgueltig loeschen (nur aus dem Papierkorb heraus moeglich)
      parameters:
        - name: messageId
          in: path
          required: true
          schema: { type: string, format: uuid }
      responses:
        "200":
          description: Endgueltig geloescht
```

3. Verhalten (Track A): DELETE /messages/{messageId} setzt folder_id auf den Papierkorb-Ordner (wie POST /messages/{messageId}/move, kein neuer Mechanismus). Serverseitig zusaetzlich ueber die Provider-API spiegeln (Gmail API messages.trash bzw. IMAP \\Deleted-Flag), analog zur bereits beschlossenen Regel bei automatisch geloeschtem Spam -- lokales Verschieben ohne Server-Spiegelung waere inkonsistent mit dem, was der User in Gmail/seinem Mail-Client direkt sieht. DELETE /messages/{messageId}/permanent entfernt den DB-Eintrag endgueltig UND loest die endgueltige Loeschung beim Provider aus (Gmail API messages.delete bzw. IMAP Expunge).

4. Papierkorb-Ordner braucht KEINE eigene Retention-Tabelle wie quarantine -- Standard-Verhalten wie bei Gmail (User leert manuell oder es bleibt liegen) reicht fuer diesen Auftrag, keine automatische 30-Tage-Frist noetig (anders als bei message quarantine/phishing).

Kein Blocker, reine Ergaenzung fehlender Basis-Funktionalitaet, keine grosse Contract-Aenderung im Sinne der Ankuendigungsregel.

[2026-09-08] [erledigt: Track A Backend-Teil (Branch track-a-backend), Track C/F Umsetzung folgt] [backend/] — Track A hat den Backend-Teil umgesetzt: `ensureDemoUser()` legt jetzt 6 System-Ordner an (inkl. `papierkorb`), `DELETE /messages/{messageId}` (soft delete, gleiche Mechanik wie `/move`) und `DELETE /messages/{messageId}/permanent` sind implementiert. Design-Entscheidung (nicht explizit im Auftrag): `permanent` ist nur aus dem Papierkorb heraus erlaubt (sonst 400) -- Details/Begründung in `backend/README.md` Abschnitt "Papierkorb / Löschen" und `SYNC.md`-Änderungsprotokoll auf `track-a-backend`. Provider-Spiegelung (Gmail `messages.trash`/`messages.delete`, IMAP `\Deleted`/`EXPUNGE`) ist wie im Auftrag vorgesehen, aber mangels Schreibzugriff auf Gmail/IMAP in diesem Durchstich nur als markiertes TODO im Code, kein Blocker. Tests grün (`npm test`). Offen: Provider-Spiegelung, Track C/F müssen Löschen-Button/Papierkorb-Ansicht in der UI verdrahten.

[2026-09-08] [erledigt: ea6b802 (Branch track-f-web-ui)] [web/] — Track F hat den Web-Teil umgesetzt: `src/api.ts` bekommt `deleteMessage(id)` (soft delete, `DELETE /messages/{id}`) und `permanentlyDeleteMessage(id)` (`DELETE /messages/{id}/permanent`). Mock-Server (`mock-server/data.mjs`+`server.mjs`) bekommt den 6. System-Ordner "Papierkorb" (`system_key: "papierkorb"`, Icon `trash-2`, nicht umbenennbar/löschbar wie Quarantäne/Spam) mit zwei Beispielnachrichten, sowie beide neuen DELETE-Endpunkte (soft delete verschiebt `folderId`, permanent entfernt aus der Mock-Datenliste, beide mit 404 bei unbekannter ID). UI: "Löschen"-Button in der Detailansicht (analog zum bestehenden "In Quarantäne verschieben"); liegt die Nachricht bereits im Papierkorb, zeigt die Detailansicht stattdessen einen Hinweis-Banner und "Endgültig löschen" (mit Bestätigungsdialog, nicht rückgängig machbar). Zurückholen aus dem Papierkorb läuft über das vorhandene "In Ordner verschieben…"-Dropdown, kein eigener Restore-Mechanismus. `tsc -b`/`vite build` grün, beide Endpunkte per curl gegen die `api-spec.yaml`-Schemas verifiziert. Details/Design-Entscheidungen/Übergabe an Track A (Provider-Spiegelung ist Backend-Sache) in `SYNC.md`-Änderungsprotokoll auf `track-f-web-ui` und `web/README.md`. Damit ist der Papierkorb-Nachtrag aus diesem Eintrag für Contract + Track A + Track F vollständig; offen bleibt nur noch Track C (iOS).

[2026-09-08] [erledigt: 8341506 (Branch track-c-ios)] [ios/] — Track C hat den iOS-Teil umgesetzt: 6. System-Ordner "papierkorb" (Icon trash-2, weder umbenennbar noch löschbar wie quarantaene/spam), `APIClient` um `deleteMessage(id:)` (DELETE /messages/{id}, soft delete) und `permanentlyDeleteMessage(id:)` (DELETE /messages/{id}/permanent) erweitert, `MockAPIClient` implementiert beide, `RemoteAPIClient` als Skelett verdrahtet. UI: Swipe-Action "Löschen" in der Nachrichtenliste (im Papierkorb-Ordner selbst "Endgültig löschen" mit Bestätigungsdialog statt nochmal Verschieben), zusätzlicher destruktiver Button in der Detailansicht analog zum bestehenden "Verschieben nach…"-Menü. Build gegen iphonesimulator geprüft (BUILD SUCCEEDED), Papierkorb-Ordner im Simulator per Screenshot verifiziert (Icon, Name, Count korrekt); Tap-Interaktionen weiterhin nicht automatisierbar in dieser Umgebung (wie in den vorherigen iOS-Einträgen vermerkt). Details: ios/README.md, SYNC.md auf track-c-ios. Damit ist der Papierkorb-Nachtrag aus Contract + Track A + Track C + Track F vollständig umgesetzt.


[2026-09-08] [erledigt: 4920b19 (Branch track-e-mail-actions, 09.09.), Punkt 1 reine Bestaetigung ohne Code-Aenderung] [Track E + Track A + Compose-UI (C/F)] — Zwei Klarstellungen zum Compose-/Antwort-Flow:

1. Compose-Text bleibt vollstaendig user-editierbar, KI-Entwurf ist nur Vorschlag. Das ist bereits Contract-Prinzip (siehe ai-adapter-interface.ts Kommentar zu draftReply: "Ergebnis geht nie automatisch raus, immer Review/Edit/Send durch User") -- hier nochmal explizit bestaetigt, keine Aenderung, nur zur Sicherheit dokumentiert: der generierte draftText ist ein editierbares Textfeld in der UI, kein read-only Vorschlag, User kann alles frei umschreiben bevor gesendet wird.

2. Keine doppelte Signatur bei Antworten. Kontext bleibt wie in Track E umgesetzt (apply_to_new/apply_to_replies + is_default-Fallback, siehe SYNC.md-Antwort vom 08.09.) -- aber composeReplyDraft() darf die Signatur pro erzeugtem Antwort-Text nur EINMAL anhaengen, nicht mehrfach (z.B. falls die Funktion versehentlich zweimal aufgerufen wird oder der UI-Entwurf schon eine Signatur enthaelt und die Compose-UI selbst nochmal eine anhaengt). Bitte in composeReplyDraft() defensiv gegen doppeltes Anhaengen pruefen (z.B. Signatur-Text nicht anhaengen, wenn der uebergebene/bereits vorhandene Entwurfstext ihn am Ende bereits enthaelt), Testfall dafuer ergaenzen. Betrifft nur den EINEN neu erzeugten Antwort-Text selbst -- nicht die im Thread zitierten, bereits gesendeten fruehreren Nachrichten (deren eigene Signaturen im Zitat sind normal und kein Bug).

Kein Blocker, kleine Praezisierung/Absicherung des bestehenden Verhaltens.


[2026-09-08] [erledigt: 613e27a (Branch track-a-backend)] [PRIORITAET] [Track A + Track B Integration] — Massimo: Track A und Track B jetzt zusammenfuehren (echte Erkennung statt Mock). Konkret:

1. Branch-Strategie: track-b-security in track-a-backend mergen (oder umgekehrt, je nachdem wo weniger Konflikte entstehen -- Track A ist der "Konsument", daher vermutlich einfacher: track-b-security nach track-a-backend mergen, security-classification/ landet dann als Sub-Ordner/Package neben backend/).

2. Ersetzen, was bisher Mock war (alles bereits in SYNC.md/backend/README.md als "bewusst Mock" dokumentiert):
   - src/ai/mockAdapter.ts analyzeMail() -> echten Aufruf von security-classification's analyzeMail() ersetzen (Track B, Branch track-b-security, 79 Tests gruen).
   - src/ai/draftPhishingCheckMock.ts -> echten Aufruf von security-classification's checkDraftForPhishing() ersetzen (Track B hat das laut SYNC.md bereits fertig: security-classification/src/draftPhishingCheck.ts).
   - Die vier externen Lookups (src/lookups/*Mock.ts) bleiben vorerst Mock (das ist ein separates, noch nicht gestartetes Thema laut eurer eigenen Doku -- WHOIS/Spamhaus/fraud_alerts-Anbindung), NICHT Teil dieser Integration.

3. Package-Verdrahtung: da noch kein gemeinsames npm-Package existiert (Entscheidung Terminal 09.09., bestaetigt), bitte security-classification/ vorerst per relativem Pfad-Import oder lokalem npm-Link einbinden (kein Registry-Publish noetig fuer diesen Schritt) -- pragmatischste Loesung waehlen, die die bestehenden Tests beider Seiten nicht bricht.

4. Nach der Integration: Smoketest (src/smoketest.ts) muss weiterhin gruen sein, plus mindestens ein neuer Testfall, der zeigt, dass eine echte (nicht Mock-)Klassifikation durchlaeuft (z.B. eine Fixture-Mail, die Track B's echte Logik als Phishing erkennt, nicht nur die bisherige simple Mock-Heuristik).

5. Grenzen weiterhin klar dokumentieren: was ist jetzt echt (Track-B-Klassifikation), was bleibt Mock (die vier externen Lookups) -- README.md entsprechend aktualisieren, nicht stillschweigend lassen.

Kein Contract-Bruch zu erwarten (beide Seiten nutzen bereits dieselben Interfaces aus contracts/ai-adapter-interface.ts). Bei echten Konflikten/Unklarheiten waehrend der Integration bitte in SYNC.md (Branch nach dem Merge) oder TERMINAL_INBOX.md eintragen statt zu raten.

**Umgesetzt (Terminal, 09.09., Commit `613e27a` auf `track-a-backend`):** alle 5 Punkte wie beschrieben. Punkt 1: `track-b-security` in `track-a-backend` gemergt, `security-classification/` liegt jetzt als Sub-Ordner daneben. Punkt 2: `mockAdapter.ts`'s `analyzeMail()` und die Phishing-Check-Route rufen jetzt Track B's echte Funktionen; `draftPhishingCheckMock.ts` gelöscht; die vier externen Lookups unverändert Mock. Punkt 3: `@driftmail/security-classification` als `file:../security-classification`-Dependency (kein npm-Link, kein Workspace nötig) — Node 24 lädt das ESM-Package per `require()` direkt (stabiles ESM-in-CJS-Interop), siehe backend/README.md "Starten". Punkt 4: Smoketest grün, neue Fixture 6 (Homoglyph-Phishing) beweist echte Klassifikation. Punkt 5: backend/README.md aktualisiert.

**Fund während der Integration (Details in SYNC.md):** Track B's echte `classify()` erkannte reinen Werbe-/Glücksspiel-Inhalt ohne Auth-Fail/Homoglyph/Link-Mismatch/Dringlichkeitssprache zunächst NICHT als "spam" — anders als der alte Mock, der direkt auf Content-Keywords matchte. **Inzwischen behoben (siehe Eintrag "Track B: `adult`/`gambling` als eigenständigen Klassifikations-Trigger" weiter unten):** Web hat bestätigt, dass das kein akzeptabler Randfall ist, Track B hat einen eigenständigen Content-Trigger ergänzt (`security-classification/src/index.ts`, `CONTENT_TRIGGERED_SPAM_CONFIDENCE`), Track A hat die zwischenzeitlichen Fixture-Workarounds (SPF-Fail als Ersatzsignal, siehe SYNC.md) danach wieder vereinfacht.


[2026-09-09] [erledigt: siehe TERMINAL_INBOX.md "Re: date-time/date-Inkonsistenz"] [Track A - erneut eingetragen, war beim ersten Versuch durch eine Verbindungsstoerung verlorengegangen] — Von Track C (iOS) gefundene Inkonsistenz in api-spec.yaml: die Spec mischt format: date-time (z.B. Message.receivedAt) und format: date (z.B. Contract.contractEnd, MailSummary.deadline) im selben Dokument, ohne explizite Kennzeichnung als Absicht. Track C hat clientseitig defensiv beide Formate akzeptiert (ios/DriftmailApp/Networking/DateDecoding.swift), das ersetzt aber nicht die eigentliche Pruefung.

Guter Zeitpunkt, das jetzt mitzunehmen: bei der anstehenden Postgres-Umstellung (Persistenz-Prioritaet) ist ohnehin klar zu entscheiden, welches Format jede Spalte tatsaechlich ausgibt. Bitte verifizieren/festlegen: volles ISO-8601 mit Uhrzeit fuer *-At-Felder (receivedAt etc.), reines yyyy-MM-dd fuer reine Datumsfelder (contractEnd, deadline etc.). Falls das aktuelle In-Memory-Backend das schon uneinheitlich macht, gleich bei der Postgres-Migration mit sauberem Spaltentyp (TIMESTAMPTZ vs. DATE) und korrekter Serialisierung angehen, statt es spaeter nochmal anzufassen. Kein Blocker fuer den aktuellen Stand, aber bitte vor dem naechsten Schritt beruecksichtigen, in dem Track C/F von Mock auf den echten Server umstellen.


[2026-09-09] [erledigt: b739f35] [PRIORITAET - grosse Luecke] [contracts/api-spec.yaml + Track A + Track C/F] — Massimo hat im laufenden iOS-Simulator getestet: es gibt komplett keinen "Senden"-Button bei Antworten. Verifiziert: api-spec.yaml hat KEINEN einzigen Endpunkt zum tatsaechlichen Versenden einer Mail -- nur POST /messages/{id}/reply-draft (generiert den KI-Entwurfstext) existiert. Ueberraschend, weil bereits viel Infrastruktur um einen Sendevorgang herum gebaut wurde (Phishing-Check vor dem Senden, outgoing_send_log, send_abuse_flags, Bot/Human-Missbrauchserkennung), aber der eigentliche Endpunkt, der das alles auslöst, wurde nie definiert. Echte Contract-Luecke, kein UI-Versehen.

Neuer Endpoint noetig:
```yaml
  /messages/send:
    post:
      summary: >
        Sendet eine Mail (neu oder Antwort). Loest VOR dem eigentlichen Versand
        den Phishing-Check aus (POST /messages/draft/phishing-check-Logik,
        blocked=true verhindert das Senden) und schreibt einen
        outgoing_send_log-Eintrag fuer die Abuse-Erkennung.
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required: [to, bodyText]
              properties:
                accountId: { type: string, format: uuid }
                inReplyToMessageId: { type: string, format: uuid, nullable: true }
                to:
                  type: array
                  items: { type: string }
                cc:
                  type: array
                  items: { type: string }
                subject: { type: string }
                bodyText: { type: string }
      responses:
        "200":
          description: Gesendet
          content:
            application/json:
              schema:
                type: object
                properties:
                  sentMessageId: { type: string }
        "422":
          description: Blockiert (Phishing-Check hat blocked=true geliefert)
          content:
            application/json:
              schema:
                type: object
                properties:
                  blocked: { type: boolean }
                  reason: { type: string }
```

Verhalten (Track A): Versand laeuft ausschliesslich ueber die Provider-API des verbundenen Kontos (Gmail API messages.send bzw. IMAP/SMTP mit Auth des Nutzers -- siehe fruehere Regel "Ausgehende Mail-Authentifizierung", Fall 1, kein eigener Mailserver). Vor dem eigentlichen Provider-Send-Call: Phishing-Check ausfuehren, bei blocked=true mit 422 abbrechen, KEIN Versand. Nach erfolgreichem Versand: outgoing_send_log-Eintrag schreiben (fuer die bereits bestehende Empfaenger-Reputations-/Abuse-Logik).

Verhalten (Track C/F): Compose-/Antwort-Ansicht braucht einen sichtbaren "Senden"-Button, der POST /messages/send aufruft, NACHDEM der User den (ggf. KI-generierten und frei editierten) Text final bestaetigt hat. Bei 422-Antwort: Blockier-Hinweis anzeigen (wie beim Phishing-Check-Warnhinweis-Muster), Senden verhindern, kein stiller Fehlschlag.

Kein Contract-Bruch fuer Bestehendes (reply-draft bleibt wie es ist, liefert nur den Text-Vorschlag). Bitte als naechstes nach der aktuell laufenden Persistenz-Arbeit einplanen, da es sich um eine grundlegende Kernfunktion handelt (Mail-Client ohne Senden-Button ist nicht nutzbar) -- bei Ressourcenkonflikt bitte kurz mit Massimo/Web abstimmen, ob das vor oder parallel zur Persistenz laufen soll.

**Umgesetzt (Terminal, 10.09., Commit `b739f35`):** POST /messages/send wie spezifiziert. Details in backend/README.md "Versand" bzw. ios/README.md "[2026-09-10] Nachtrag: Versand". Kurzfassung:
- Konto wird bei einer Antwort (`inReplyToMessageId` gesetzt) aus der Ursprungsnachricht abgeleitet, sonst ist `accountId` erforderlich (400 sonst).
- Phishing-Check serverseitig vor dem Versand (dieselbe Logik wie `/messages/draft/phishing-check`) -- **Grenze:** der Request hat kein eigenes `links`-Feld, Links werden per Regex aus `bodyText` extrahiert mit `displayText === actualUrl`. Der Link-Mismatch-Erkennungspfad (Anzeigetext ≠ tatsaechliche URL) kann darueber deshalb NIE ausloesen, nur ueber den separaten Draft-Check mit echten HTML-Links moeglich. Homoglyph- und Dringlichkeit+Zugangsdaten-Erkennung funktionieren unveraendert.
- Gmail: `users.messages.send` mit roher RFC822-Mail. IMAP: SMTP via `nodemailer` (neue Dependency) -- **Grenze:** SMTP-Host/Port sind bei generischen IMAP-Providern nicht aus den IMAP-Zugangsdaten ableitbar, faellt mangels eigener Env-Vars auf IMAP-Host + Port 587 zurueck (ueberschreibbar per `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`).
- outgoing_send_log-Eintrag je Empfaenger (to+cc) nach erfolgreichem Versand -- die Tabelle/Store-Methode existierte bereits seit Commit `a5432e6`, wurde aber nie von einem echten Endpunkt aufgerufen.
- Web: Entwurfskarte ist jetzt editierbar mit echtem Senden-Button (vorher dauerhaft deaktiviert), inkl. Blockier-/Erfolgsmeldung. iOS: `TextEditor` + Senden-Button in `MessageDetailView`, `APIError.blocked(reason:)`.
- **Bewusst nicht Teil dieses Schritts** (naechste Punkte der priorisierten Liste): kein lokaler Eintrag im "Gesendet"-Ordner (Ordner existiert noch nicht, siehe Ordner-Umbau-Eintrag), keine Anhaenge (siehe Eintrag direkt unten), `send_abuse_flags`-Logik (rate_burst/many_new_recipients/duplicate_content/no_read_before_reply/phishing_content) bleibt offen -- nur die schon vorhandene `outgoing_send_log`-Infrastruktur wird jetzt tatsaechlich befuellt.

Tests: backend `npm run typecheck`/`npm test` (neue Smoketest-Faelle: Erfolg + outgoing_send_log-Eintrag, fehlendes accountId, unbekannte inReplyToMessageId, Phishing-Block) gruen. web `npm run build` gruen, End-to-End im Browser verifiziert (Antwortentwurf -> Senden -> Bestaetigung "Antwort an … wurde gesendet."). ios `xcodebuild ... -destination 'platform=iOS Simulator,name=iPhone 17' build` **BUILD SUCCEEDED** (kein interaktiver Klick-Test moeglich, da kein UI-Automation-Werkzeug fuer den iOS-Simulator in dieser Umgebung verfuegbar ist -- nur Code-Review + Build-Verifikation, ehrlich so in ios/README.md dokumentiert statt als vollstaendig getestet behauptet).


[2026-09-09] [erledigt: 6b7daec] [Erweiterung des Send-Endpunkt-Eintrags von eben, contracts/db-schema.sql + contracts/api-spec.yaml + Track A/C/F] — Massimo: Dateianhaenge beim Senden erlauben, aber nur nachdem sie geprueft (gescannt) wurden. Bestehende message_attachments-Tabelle (Anhang-Scan) hat scan_status ('pending'/'clean'/'malicious'/'blocked_type'/'scan_failed') und is_dangerous_type, ist aber ueber message_id an eine bereits existierende (empfangene) Nachricht gebunden -- fuer ausgehende Anhaenge (hochgeladen, BEVOR die gesendete Mail als messages-Zeile existiert) passt das nicht direkt. Vorschlag: message_id in message_attachments nullable machen plus neue Spalte fuer den Fall "Anhang gehoert zu einer noch nicht gesendeten Mail":

```sql
ALTER TABLE message_attachments ALTER COLUMN message_id DROP NOT NULL;
ALTER TABLE message_attachments ADD COLUMN uploaded_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE message_attachments ADD CONSTRAINT message_attachments_owner_check
  CHECK (message_id IS NOT NULL OR uploaded_by_user_id IS NOT NULL);
```

Ablauf: Anhang wird ueber einen neuen Endpoint hochgeladen und SOFORT gescannt (message_id ist hier noch null, uploaded_by_user_id gesetzt), erst nach Bestaetigung scan_status = 'clean' darf die Anhang-ID beim eigentlichen Senden mitgegeben werden. Beim erfolgreichen Versand wird message_id nachtraeglich auf die neu entstandene gesendete Nachricht gesetzt (uploaded_by_user_id kann bleiben oder genullt werden, Track A entscheidet).

Neuer Endpoint:
```yaml
  /attachments:
    post:
      summary: >
        Datei hochladen und sofort scannen (vor dem eigentlichen Senden).
        Muss scan_status='clean' liefern, bevor die attachmentId beim
        Senden verwendet werden darf.
      requestBody:
        content:
          multipart/form-data:
            schema:
              type: object
              properties:
                file:
                  type: string
                  format: binary
      responses:
        "200":
          description: Hochgeladen, Scan-Ergebnis
          content:
            application/json:
              schema:
                type: object
                properties:
                  attachmentId: { type: string, format: uuid }
                  scanStatus:
                    type: string
                    enum: [pending, clean, malicious, blocked_type, scan_failed]
```

/messages/send (aus dem Eintrag von eben) bekommt ein neues optionales Feld:
```yaml
                attachmentIds:
                  type: array
                  items: { type: string, format: uuid }
```

Verhalten (Track A): POST /messages/send lehnt ab (422, gleiche Fehlerform wie beim Phishing-Block), wenn IRGENDEINE mitgegebene attachmentId nicht scan_status='clean' hat -- kein Versand mit ungeprueften oder als gefaehrlich erkannten Anhaengen, keine Ausnahme. Scan-Logik selbst (was genau "malicious"/"blocked_type" ausloest, z.B. gefaehrliche Dateiendungen wie .exe, Makro-Dokumente, echter Virenscan-Dienst) ist bewusst noch offen/spaeter zu spezifizieren -- fuer den ersten Durchstich reicht eine einfache Dateityp-/Endungspruefung (analog zu den bereits bestehenden Mock-Pattern-Ansaetzen an anderer Stelle), kein Blocker, echte Scan-Anbindung ist ein spaeterer Schritt wie bei den externen Lookups.

Verhalten (Track C/F): Compose-UI braucht eine Anhang-Auswahl (Dateipicker), zeigt den Scan-Status waehrend/nach dem Hochladen (z.B. Spinner -> Haekchen oder Warn-Icon), Senden-Button bleibt deaktiviert/blockiert solange ein Anhang noch 'pending' oder nicht 'clean' ist.

Kein Blocker, aber bitte zusammen mit dem Senden-Endpunkt von eben umsetzen, nicht getrennt -- beide haengen inhaltlich zusammen.

**Umgesetzt (Terminal, 10.09., Commit `6b7daec`):** POST /attachments + Anhang-Gate in POST /messages/send wie spezifiziert. Details in backend/README.md "Anhänge" bzw. ios/README.md "[2026-09-10] Nachtrag: Anhänge". Kurzfassung:
- `message_attachments.message_id` nullable + neue Spalte `uploaded_by_user_id` + Check-Constraint -- direkt am `CREATE TABLE` geändert statt per `ALTER TABLE` (Repo-Konvention, siehe z.B. `messages.provider_message_id`; die Tabelle wurde bisher von keinem Code beschrieben, kein Bestand, der eine echte Migration bräuchte).
- Scan-Logik (`attachmentScanMock.ts`): einfache Dateiendungs-Prüfung (ausführbare/makrofähige Typen -> `blocked_type`) + ein deterministischer `virus`/`malware`-Namens-Trigger für `malicious` (analog zur Botnetz-Beispiel-IP-Liste), sonst `clean`. Kein echter Virenscan, wie spezifiziert bewusst offen für später.
- `POST /messages/send` prüft jede mitgegebene `attachmentId`: unbekannt -> 400, nicht `clean` -> 422 (gleiche Fehlerform wie der Phishing-Block).
- Track C/F: Dateipicker mit Live-Status pro Anhang (Web: HTML-`<input type="file">`, iOS: `.fileImporter`), Senden bleibt deaktiviert bis alle Anhänge `clean` sind.
- **Grenze (bewusst, beide Plattformen):** der Dateiinhalt wird nicht gespeichert (`message_attachments` hat laut Contract keine `content`-Spalte, eine echte Implementierung würde Objektspeicher wie S3 nutzen) -- ein geprüft-`clean`-er Anhang wird deshalb noch nicht tatsächlich in die ausgehende Mail eingebettet, nur der Scan-Gate-Mechanismus selbst ist fertig. `store.linkAttachmentsToMessage()` (Store-Methode existiert bereits) wird noch nicht aufgerufen, weil es dafür erst eine lokale `messages`-Zeile für die gesendete Mail braucht (Teil des noch offenen Ordner-Umbaus, siehe nächster Eintrag).

Tests: backend `npm run typecheck`/`npm test` (7 neue Smoketest-Fälle: clean/blocked_type/malicious-Upload, fehlendes Datei-Feld, Versand mit clean/nicht-clean/unbekanntem Anhang) grün. web `npm run build` grün, End-to-End im Browser verifiziert (Upload zweier Dateien, eine `clean` eine `blocked_type`, Senden korrekt blockiert bis die blockierte Datei entfernt wurde, dann erfolgreicher Versand mit Anhang). ios `xcodebuild` gegen zwei Simulator-Ziele **BUILD SUCCEEDED** (kein interaktiver Klick-Test des Anhang-Flows möglich, kein UI-Automation-Werkzeug für den iOS-Simulator in dieser Umgebung).


[2026-09-09] [erledigt: siehe naechster Eintrag (Version ueberholt)] [GROSSE CONTRACT-AENDERUNG - vorher angekuendigt] [contracts/db-schema.sql + contracts/api-spec.yaml + contracts/design-tokens.json + Track A/C/F] — Massimo: Standard-Ordnerstruktur wird umgebaut. Zwei getrennte Aenderungen, beide klar spezifiziert:

**1) Standard-System-Ordner neu (final abgestimmt mit Massimo):**
Neue Liste: eingang, sonstiges, quarantaene, spam, papierkorb (5 Ordner). ENTFERNT als System-Ordner: wichtig, rechnungen (User kann beides als eigenen Ordner selbst anlegen, dafuer gibt es ja jetzt die frei anlegbaren Ordner).

- "eingang" ist ein ECHTER Ordner (kein virtueller Sammel-View), ersetzt die bisherige automatische Landezone: neue, normale (nicht spam/phishing) Mail landet jetzt automatisch in "eingang" statt wie bisher in "sonstiges". "sonstiges" bleibt als Ordner bestehen, aber OHNE automatische Zuordnung (rein manuell nutzbar durch den User, gleiches Prinzip wie das bisherige "wichtig").
- renamable: eingang und sonstiges bleiben umbenennbar (wie bisher wichtig/sonstiges), quarantaene/spam/papierkorb weiterhin nicht umbenennbar/loeschbar (unveraendert).
- Icon-Vorschlag fuer eingang: "inbox" (wie zuvor bei sonstiges/wichtig-artigen Ordnern ueblich) -- Track A/C/F koennen ein passendes Icon waehlen, kein hartes Muss.

Aenderungen konkret:
- design-tokens.json systemFolders.defaults: Eintraege fuer wichtig und rechnungen ENTFERNEN, neuen Eintrag "eingang" (system_key='eingang', renamable=true) HINZUFUEGEN. sonstiges/quarantaene/spam/papierkorb-Eintraege bleiben wie sie sind.
- db-schema.sql: ueberall wo system_key als Enum/CHECK gegen die bisherigen 6 Werte (wichtig, sonstiges, rechnungen, quarantaene, spam, papierkorb) geprueft wird, auf die neuen 5 Werte (eingang, sonstiges, quarantaene, spam, papierkorb) aendern.
- api-spec.yaml: Folder.systemKey enum entsprechend auf die neuen 5 Werte aendern.
- Track A (mail/sync.ts bzw. Nachfolgemodul nach der Persistenz-Umstellung): resolveFolderId-Logik aendern -- bisher "spam/phishing -> spam-Systemordner, sonst -> sonstiges", jetzt "spam/phishing -> spam-Systemordner, sonst -> eingang-Systemordner". ensureDemoUser()/Postgres-Migration-Seed muss die neuen 5 Standard-Ordner anlegen statt der alten 6.
- Bestandsdaten/Demo-Fixtures: falls aktuell Nachrichten in wichtig/rechnungen liegen (z.B. Demo-Daten), diese beim Umbau nach "eingang" verschieben (gleiches Prinzip wie beim Loeschen eines eigenen Ordners: Nachrichten wandern in einen sinnvollen Standard-Ordner statt verloren zu gehen).
- Track C (iOS)/Track F (Web): SystemFolderKey-Enum bzw. aequivalente Konstanten (Models/Folder.swift, folderMeta.ts/types.ts) auf die neuen 5 Werte aktualisieren, Sidebar/FolderList entsprechend anpassen. Onboarding-Screens, die bisher "wichtig" als ersten/Standard-Ordner zeigen, muessen auf "eingang" umgestellt werden.

**2) Feld-/Label-Umbenennung "Was wollen die von mir?" -> "Inhalt":**
Reine UI-Textaenderung, KEINE Contract-Aenderung noetig -- das technische Feld heisst weiterhin summaryText (MailSummary-Schema), nur der sichtbare Button-/Label-Text in der UI (Track C/F) wird von "Was wollen die von mir?" auf "Inhalt" geaendert. Kein Backend-Bezug.

Kein Contract-Bruch im Sinne von Datenverlust, aber definitiv eine groessere strukturelle Aenderung (Standard-Ordner-Set aendert sich) -- deshalb hier vorher vollstaendig spezifiziert statt einfach committet, wie in der eigenen Regel vereinbart. Bitte NACH der aktuell laufenden Persistenz-Arbeit einplanen (betrifft ohnehin denselben Seed-/Migrations-Code), es sei denn es liegt zeitlich guenstiger direkt zusammen mit der Migration.


[2026-09-09] [erledigt: 9290051] [KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags von eben, noch nicht umgesetzt -- bitte diese Version verwenden statt der vorherigen] [contracts/db-schema.sql + contracts/api-spec.yaml + contracts/design-tokens.json + Track A/C/F] — Massimo: zwei Standard-Ordner fehlten noch, die jeder Mail-Client hat: Entwuerfe (Drafts) und Gesendet. Beide gehoeren in die Standard-Liste.

**Finale Standard-Ordner-Liste (ersetzt die Liste aus dem vorherigen Eintrag):**
eingang, entwuerfe, gesendet, sonstiges, quarantaene, spam, papierkorb (7 Ordner). Alles wie im vorherigen Eintrag beschrieben (eingang ersetzt wichtig als Auto-Landezone, sonstiges bleibt ohne Auto-Zuordnung, wichtig/rechnungen entfallen als System-Ordner) PLUS:

- **entwuerfe**: nicht umbenennbar, nicht loeschbar (wie quarantaene/spam/papierkorb). Zeigt vom User begonnene, aber noch nicht gesendete Mails (neue Mail oder Antwort). Braucht eine eigene Persistenz fuer unfertige Entwuerfe -- Vorschlag: neue Tabelle `drafts` (id, user_id, mail_account_id, in_reply_to_message_id nullable, to_addresses, cc_addresses, subject, body_text, updated_at), GETRENNT von `messages` (Entwuerfe haben keine echte message_id_header eines Providers, messages ist auf empfangene/gesendete echte Mails ausgelegt). Endpunkte: GET /drafts, POST /drafts (anlegen beim Start des Compose-Vorgangs), PATCH /drafts/{id} (laufendes Speichern waehrend des Tippens oder beim Verlassen des Compose-Screens), DELETE /drafts/{id} (verwerfen). Der "entwuerfe"-Ordner in der UI zeigt den Inhalt dieser Tabelle, nicht `messages`.
- **gesendet**: nicht umbenennbar, nicht loeschbar. Nach erfolgreichem POST /messages/send (siehe vorherige Eintraege) wird eine lokale messages-Zeile mit folder_id = gesendet-Systemordner angelegt (fuer sofortige UI-Sichtbarkeit), zusaetzlich zum Versand ueber die Provider-API. Falls der zugehoerige Entwurf aus einer drafts-Zeile stammte, wird diese beim erfolgreichen Senden geloescht (DELETE /drafts/{id} intern).

Reihenfolge der Standard-Ordner in der Sidebar (Vorschlag, kein hartes Muss): eingang, entwuerfe, gesendet, sonstiges, quarantaene, spam, papierkorb.

**Allgemeines Design-Prinzip, das nochmal explizit gilt (war teils schon einzeln umgesetzt, hier als durchgaengige Regel bestaetigt):** Der Kern von driftmail ist Vor-Sortierung + farbliche Dringlichkeits-/Gefahren-Anzeige, damit der User sofort sieht "wo es brennt". Bereits vorhanden: quarantaene-Ordner in Warnfarbe (danger, siehe design-tokens.json), rote Sprechblase bei sensiblen Daten + schlechter Empfaenger-Reputation, sofortige rote Link-Markierung. Bitte bei allen kommenden UI-Arbeiten (Track C/F) konsequent beibehalten: je gefaehrlicher/dringender, desto auffaelliger die Farbe (danger-Rot fuer Phishing/Quarantaene, neutral fuer normale Vorgaenge wie Papierkorb/Entwuerfe/Gesendet) -- kein neues Farbschema noetig, nur konsequente Anwendung der bestehenden Farbrollen aus design-tokens.json.

Bitte diesen Eintrag als massgeblich fuer den Ordner-Umbau behandeln (der vorherige Eintrag ohne entwuerfe/gesendet ist damit ueberholt, gleiche restliche Spezifikation gilt unveraendert weiter: eingang-Auto-Routing, wichtig/rechnungen-Entfernung, Label-Umbenennung "Was wollen die von mir?" -> "Inhalt").

**Umgesetzt (Terminal, 10.09., Commit `9290051`):** finale 7er-Ordner-Liste + Entwuerfe + Label-Umbenennung wie spezifiziert. Details in backend/README.md "Ordner (benutzerdefiniert)"/"Entwürfe", web/README.md "Ordner-Umbau"/"Versand & Anhänge", ios/README.md "[2026-09-10] Nachtrag: Ordner-Umbau + Entwürfe". Kurzfassung:
- `eingang`/`entwuerfe`/`gesendet`/`sonstiges`/`quarantaene`/`spam`/`papierkorb` (7 System-Ordner). `wichtig`/`rechnungen` sind keine System-Ordner mehr, bleiben aber als normale benutzerdefinierte Ordner erhalten (User kann sowas selbst anlegen, wie spezifiziert).
- Bestandsuser (die schon die alten 6 System-Ordner hatten) werden bei jedem `ensureDemoUser()`-Aufruf automatisch migriert (`migrateLegacySystemFolders()`): fehlende neue Ordner werden nachgerüstet, Nachrichten aus `wichtig`/`rechnungen` wandern nach `eingang`, die beiden alten Ordner-Zeilen werden entfernt. Kein SQL-Migrationstool nötig (Anwendungslogik, gleiches Prinzip wie beim Löschen eines eigenen Ordners).
- `entwuerfe` zeigt eine neue `drafts`-Tabelle + `GET`/`POST /drafts`, `PATCH`/`DELETE /drafts/{id}` — bewusst getrennt von `messages`. **Grenze (bewusst, beide Client-Plattformen):** kein "Neue Mail verfassen"-Compose-Screen, der diese Endpunkte tatsächlich aufruft — Web/iOS zeigen den Ordner nur lesend + mit Löschen. Die Endpunkte selbst sind Contract-vollständig und getestet.
- `gesendet` bekommt nach jedem erfolgreichen `POST /messages/send` eine echte lokale `messages`-Zeile (macht auch die seit Schritt 2 ungenutzte `store.linkAttachmentsToMessage()` endlich nutzbar). Neues optionales `draftId`-Feld auf `/messages/send`: verwirft den referenzierten Entwurf automatisch bei Erfolg.
- **Ein echter Bug beim Testen gefunden + behoben (Web):** der "Gesendet"-Zähler in der Sidebar aktualisierte sich nach einem Versand nicht automatisch (fehlender Reload-Trigger). **Gleicher Bug in iOS bewusst NICHT behoben** (bräuchte geteilten State statt lokalem View-State, größerer Umbau als für diesen Schritt angemessen) — dokumentiert in ios/README.md, Pull-to-refresh ist der bestehende Workaround.

Tests: backend `npm run typecheck`/`npm test` (4 neue Smoketest-Blöcke: gesendet-Ordner-Nachweis, Entwürfe-CRUD inkl. Versand-mit-draftId, Migrations-Test mit bewusst simulierten Altdaten) grün. web `npm run build` grün, End-to-End im Browser verifiziert (neue Ordnerstruktur, Versand → gesendet-Ordner sichtbar, Entwurf anlegen/anzeigen/löschen). ios `xcodebuild` gegen zwei Simulator-Ziele **BUILD SUCCEEDED** + Screenshot (alle 9 Ordner korrekt inkl. Entwürfe-Zähler).


[2026-09-09] [erledigt: siehe naechster Eintrag (Bedingung war falsch angesetzt, dort korrigiert)] [Track C/F, kleine Regel] — Massimo hat die Produktphilosophie nochmal zusammengefasst (zur Einordnung, keine neue Architektur): driftmail soll sich anfuehlen wie jeder normale Mail-Client (Eingang/Entwuerfe/Gesendet/etc., siehe vorherige Eintraege), nur intelligenter -- Muell soll idealerweise gar nicht erst ankommen (siehe Provider-Spam-Ordner-Skip, Auto-Delete adult/gambling), und wenn doch etwas Verdaechtiges durchkommt, warnt die KI aktiv statt es dem User zu ueberlassen (siehe Phishing-Warnbanner, Warnsprechblasen). Das ist grossteils schon spezifiziert/umgesetzt.

Eine konkrete, bisher nicht spezifizierte Kleinigkeit daraus: Nachrichten mit classification = 'spam' bekommen KEINEN "Antworten"-Button/keine Antwortentwurf-Option in der UI (Compose-Route fuer eine Antwort auf Spam macht schlicht keinen Sinn -- niemand muss auf Spam antworten). Betrifft nur classification='spam' (alle Subcategories), NICHT 'phishing' (bei Phishing kann es sinnvoll sein, dass der User die Mail trotzdem sieht/meldet, nur eben mit Warnbanner wie bereits umgesetzt) und nicht 'safe'/'unclear'.

Umsetzung: Track C/F blenden den "Antworten"-Button in der Detailansicht aus, wenn message.security.classification === 'spam' (bzw. message.classification, je nach UI-Datenmodell). Kein Backend-Contract-Change noetig (Feld existiert bereits), reine UI-Bedingung. Kein Blocker.


[2026-09-09] [erledigt: Punkt 1 = Commit cc56438, Punkt 2 = Commit 82aa28c (siehe Umsetzt-Vermerk unten im selben Eintrag), echter Netzwerk-Aufruf statt nur Header-Parsing nachgezogen in 63c1c0b (21.09.)] [KORREKTUR der letzten Regel + neue Ergaenzung] [Track A/B + Track C/F] — Massimo: zwei zusammenhaengende Punkte, beide durchdacht statt isoliert umzusetzen:

**1) Korrektur zur "kein Antworten-Button bei Spam"-Regel von eben:** Die Bedingung war falsch angesetzt -- an classification (das urspruengliche, statische KI-Urteil) statt am AKTUELLEN Ordner. Richtig: der Antworten-Button wird ausgeblendet, wenn die Nachricht sich aktuell im spam-Systemordner befindet (folderId === spam-Ordner-ID), NICHT wenn irgendwann classification='spam' war. Verschiebt der User eine faelschlich einsortierte Mail manuell nach eingang (oder sonstwohin), ist der Antworten-Button sofort wieder da -- ganz ohne neues Feld/neue Sonderlogik, einfach weil die Bedingung jetzt am Ordner haengt statt am eingefrorenen KI-Urteil. Bitte den Eintrag von eben so lesen (folderId-Check statt classification-Check), gleiche UI-Stelle (Track C/F).

**Umgesetzt (Terminal, 10.09., Commit `cc56438`):** Punkt 1 wie spezifiziert -- war zuvor gar nicht implementiert (nur die WEB_INBOX.md-Eintraege selbst existierten, siehe SYNC.md-Verweis). Web: `App.tsx` berechnet `spamFolder`, reicht `spamFolderId` an `MessageDetailPane` durch, die den "Antwortentwurf erstellen"-Button entsprechend ausblendet -- End-to-End im Browser verifiziert (Button fehlt im Spam-Ordner, erscheint sofort wieder nach manuellem Verschieben nach Eingang, obwohl das eingefrorene `classification`-Badge weiterhin "Spam" zeigt). iOS: `MessageDetailView.actions(for:)` nutzt denselben `currentFolder?.systemKey == .spam`-Check wie bereits bei Quarantaene/Papierkorb in derselben View. Kein Backend-/Contract-Change (folderId existierte bereits). Nachzuegler gleich miterledigt: Label "Was wollen die von mir?" -> "Inhalt" war in Schritt 3 nur fuer Web umgesetzt worden, jetzt auch fuer iOS nachgezogen. Details in web/README.md "Antworten-Button bei Spam" und ios/README.md "[2026-09-10] Nachtrag: Antworten-Button bei Spam".

Punkt 2 (automatische Abmeldung) bleibt offen, siehe unten.

**2) Automatisches Abmelden bei Spam (statt nur manuell mit Rueckfrage):** Bisherige Regel (RFC-8058-Abmeldung nur mit User-Bestaetigung, pending_confirmation) bleibt der Standardweg fuer vom User selbst angestossene Abmeldungen (z.B. aus der Newsletter-Erstkontakt-Idee in IDEEN_BACKLOG.md). ERGAENZUNG: wenn eine Mail bereits zuverlaessig als classification='spam' eingestuft wurde (alle spam_subcategory-Werte: adult, gambling, generic, marketing) UND einen gueltigen RFC-8058 List-Unsubscribe-Header hat, wird die Abmeldung AUTOMATISCH ausgeloest, OHNE Rueckfrage -- die Spam-Klassifikation selbst ist in diesem Fall schon die Bestaetigung, eine zusaetzliche Nachfrage waere unnoetige Reibung. unsubscribe_actions-Eintrag wird direkt mit status='confirmed' angelegt statt 'pending_confirmation' (weiterhin NIE Klick auf Links im Mail-Body, nur der sichere Header-Mechanismus -- das bleibt unveraendert).

WICHTIG, Ausnahme: gilt NUR fuer classification='spam', NIEMALS fuer 'phishing'. Bei Phishing wird nichts automatisch abgemeldet -- ein Phishing-Versender hat ohnehin meist keinen echten List-Unsubscribe-Header, und selbst wenn, waere ein automatisches Vertrauen in dessen Header-Angaben ein Risiko (der Header selbst koennte Teil eines Trick-Musters sein). Phishing bleibt bei der bestehenden, vorsichtigen Quarantaene-Logik unveraendert.

Verhalten bei adult/gambling: diese Mails werden ohnehin nicht persistiert (Auto-Delete-Regel von vorhin) -- die automatische Abmeldung sollte trotzdem VOR dem Verwerfen ausgefuehrt werden (Header steht ja schon beim Klassifikations-Durchlauf zur Verfuegung), damit kuenftige Mails von diesem Absender idealerweise gar nicht erst kommen. Kein Blocker, aber bitte in der gleichen Pipeline-Stelle wie die Klassifikation selbst einbauen (Track A, mail/sync.ts bzw. Nachfolgemodul nach der Persistenz-Umstellung).

Kein Contract-Bruch (unsubscribe_actions.status erlaubt bereits 'confirmed' als Wert). Reine Verhaltens-/Ablauf-Aenderung, kein neues Feld noetig.


[2026-09-09] [erledigt: alle 6 Punkte, siehe unten] [PRIORITAET - naechster Schritt] [an alle betroffenen Tracks] — Persistenz ist fertig und verifiziert (danke, sehr gruendlich). Bitte jetzt mit dem naechsten Block weitermachen, es sind noch 6 zusammenhaengende Auftraege offen in dieser Datei, in dieser empfohlenen Reihenfolge (haengen z.T. voneinander ab):

1. Senden-Endpunkt (POST /messages/send) -- groesste fehlende Kernfunktion, alles andere in diesem Block baut z.T. darauf auf
2. Anhang-Upload/Scan (Erweiterung von 1)
3. Ordner-Umbau final (eingang/entwuerfe/gesendet/sonstiges/quarantaene/spam/papierkorb) -- gesendet-Ordner braucht Punkt 1
4. Antworten-Button-Korrektur (Ordner-Check statt Classification-Check)
5. Automatische Abmeldung bei Spam
6. Label-Umbenennung "Was wollen die von mir?" -> "Inhalt" (kleinste Aenderung, kann zwischendurch erledigt werden)

Wie immer: eigene technische Reihenfolge/Aufteilung auf Tracks selbst entscheiden, wo sinnvoll abweichen, Begruendung wie gewohnt in SYNC.md dokumentieren.

**Umgesetzt (Terminal):** alle 6 Punkte fertig. 1 = Commit `b739f35`/`0d6632a`, 2 = `6b7daec`/`7acdaf3`, 3 = `9290051`/`91617d5` (inkl. Merge `dd94c8b` mit Web), 4 = `cc56438`/`9e7d07d`, 6 = bereits in 3 (Web)/4 (iOS-Nachzuegler) miterledigt. **5 (Automatische Abmeldung bei Spam), Commit `82aa28c`:** `POST /messages/{messageId}/unsubscribe` war seit Track 0 im Contract definiert, aber von keinem Code umgesetzt -- jetzt vollstaendig gebaut. List-Unsubscribe-Header-Parser (`backend/src/mail/listUnsubscribe.ts`, rein syntaktisch, kein Netzwerk-Call), automatischer Trigger in der Sync-Pipeline bei `classification='spam'` (NIE bei `phishing`, siehe Begruendung im Eintrag von eben), inkl. Sonderfall adult/gambling (Abmeldung VOR dem Auto-Delete, `message_id=null`). Contract-Ergaenzung (kleine, additive Aenderung wie ueblich dokumentiert): `unsubscribe_actions.message_id` musste nullable werden + `user_id`-Spalte dazu (gleiches Muster wie `security_audit_log`), sonst waere der adult/gambling-Fall nicht abbildbar gewesen. Neues `MessageDetail.canUnsubscribe`-Feld steuert den "Von Absender abmelden"-Button in Web + iOS (unabhaengig von der Klassifikation -- auch eine phishing-Mail mit Header laesst sich manuell abmelden, nur eben nicht automatisch). Details in `backend/README.md` "Automatische Abmeldung bei Spam". Tests: backend `npm run typecheck`/`npm test` gruen (7 neue Smoketest-Assertions: automatischer Trigger fuer Marketing- und adult/gambling-Spam, kein Trigger bei Phishing trotz gefaelschtem Header, `canUnsubscribe`-Feld, manueller Endpunkt 200/400/404). web `npm run build` gruen + End-to-End im Browser verifiziert (Button erscheint/verschwindet je nach Header, Klick zeigt "Abmeldung angestossen"). ios `xcodebuild` **BUILD SUCCEEDED**.


[2026-09-10] [erledigt: a138b9d] [PRIORITAET - naechster Schritt] [Track A] — Alle 6 Punkte des letzten Blocks sind fertig (Senden, Anhaenge, Ordner-Umbau, Antworten-Fix, Auto-Abmeldung, Label). Sehr gute Arbeit, inkl. eigenstaendig gefundener Luecken (Unsubscribe-Endpunkt war im Contract aber nie implementiert).

Naechster Schritt laut der urspruenglich vereinbarten Reihenfolge (Persistenz -> Auth -> externe Lookups -> echte KI-Funktionen): jetzt ECHTE AUTH umsetzen. Bisher (siehe TERMINAL_INBOX.md 08.09.) laeuft das Backend nur mit einem festen Demo-User (ensureDemoUser()), api-spec.yaml hat zwar schon das bearerAuth-Schema + POST /auth/session definiert, aber ohne echten Login-Flow dahinter.

Vorschlag fuer den Umfang (Track A entscheidet Details selbst, wie gewohnt):
- Login ueber OAuth-Verknuepfung des ersten Mail-Kontos (Gmail-OAuth-Flow, den es fuer den Mail-Sync ohnehin schon geben muss) erzeugt implizit einen driftmail-User + Session-Token, kein separates Passwort-System noetig fuer v1.
- Session-Token (JWT oder opaque, Backend-Entscheidung) wird bei jedem Request per Authorization: Bearer geprueft, userId server-seitig aus dem Token aufgeloest -- NIE aus Request-Body/Query/Pfad vertraut (Sicherheitsprinzip aus der urspruenglichen Contract-Antwort).
- POST /auth/session erneuert ein bestehendes Token.
- Alle bisherigen Endpunkte (die bisher implizit den Demo-User genutzt haben) auf echte User-Aufloesung aus dem Token umstellen.

Kein Blocker, aber bitte wie gewohnt: Grenzen dokumentieren (was ist v1-Umfang, was kommt spaeter -- z.B. Logout, Multi-Device-Session-Verwaltung, Passwort-Reset sind vermutlich noch nicht Teil von v1), Tests, SYNC.md-Eintrag mit Begruendung.

**Umgesetzt (Terminal, 10.09., Commit `a138b9d`):** alle 4 Punkte des Vorschlags wie spezifiziert. Login ueber `POST /accounts` (find-or-create nach E-Mail beim Verbinden eines Mail-Kontos, wie vorgeschlagen), opaque Session-Token (kein JWT -- einfacher DB-Lookup reicht fuer diesen Umfang, siehe `backend/README.md` "Auth" fuer die Abwaegung), `userId` wird ausschliesslich serverseitig aus dem validierten Token aufgeloest (nie aus Body/Query/Pfad). `POST /auth/session` erneuert ein bestehendes Token (mit Rotation: alter Token wird sofort ungueltig). Alle Routen von `ensureDemoUser()` auf `req.userId` (aus der `requireAuth`-Middleware) umgestellt.

**Zusaetzlich, ueber den Vorschlag hinaus:** echte Autorisierung, nicht nur Authentifizierung -- jede `:id`-Route prueft jetzt auch Besitz (403 bei fremder Ressource), Listen-Endpunkte filtern nach dem angemeldeten User. Mit einem echten zweiten User verifiziert (Smoketest + manuell gegen echtes Postgres): kann nachweislich nicht auf die Daten des ersten zugreifen.

**Grenzen wie gewuenscht dokumentiert** (`backend/README.md` "Auth"): kein echter Gmail-OAuth-Code-Austausch/keine echte IMAP-Pruefung (POST /accounts nimmt provider+emailAddress entgegen, wertet oauthCode/imapPassword noch nicht aus -- analog zum bestehenden Fixture-Adapter-Muster), keine sichtbare Login-UI (Web meldet sich implizit mit fester Demo-Adresse an), kein Logout-Endpoint, kein Multi-Device-Session-Management, kein Passwort-Reset (kein Passwort-System in v1, wie vorgeschlagen). Kein Blocker.

**Zwei Funde nebenbei** (Details in TERMINAL_INBOX.md): Mock-Server-CORS-Luecke (Authorization-Header wurde blockiert, behoben) und ein vorbestehender, unabhaengiger Bug im Migrations-Smoketest gegen echtes Postgres (nicht behoben, geflaggt).

**Offene Rueckfrage an Web/Massimo** (siehe TERMINAL_INBOX.md fuer den vollen Kontext): passt "Login implizit ueber Mail-Konto-Verbindung, jede E-Mail-Adresse kann sich selbst anlegen" als v1-Zugriffskontrolle, oder sollte es eine Allowlist/Einladung geben? Aktuell ist das eher Session-Isolation zwischen Usern als echte Zugriffsbeschraenkung, wer sich ueberhaupt anmelden darf.

Tests: backend `npm run typecheck`/`npm test` gruen (neuer Auth-Block: 401-Faelle, Login-Idempotenz, Token-Rotation, Zwei-User-Isolation). Manuell gegen echtes Postgres per curl verifiziert. web `npm run build` gruen + End-to-End im Browser (impliziter Login beim Laden). iOS: kein Code-Change noetig (MockAPIClient spricht nie das Netzwerk an).


[2026-09-10] [erledigt: siehe SYNC.md "Echter Google-Login + Allowlist"] [Antwort auf die zwei Fragen zu Auth] [Track A] — Beide Entscheidungen von Massimo:

1) Echter Gmail-OAuth-Flow: JA, Massimo richtet gerade ein Google-Cloud-Projekt mit OAuth-Consent-Screen ein (User Type "External", Status "Testing"). Client ID/Secret kommen als lokale Umgebungsvariablen (nicht im Repo, nicht im Klartext committen). Sobald Massimo die Redirect-URI braucht, bitte klar mitteilen (z.B. http://localhost:PORT/auth/callback), damit er sie im Google-Cloud-Projekt eintragen kann. Bitte auch klar sagen, welche Gmail-Scopes noetig sind (vermutlich gmail.readonly, gmail.send, gmail.modify je nach Sync-/Senden-Bedarf), damit er sie beim Consent-Screen eintraegt.

2) Zugriffskontrolle fuer v1: ALLOWLIST/EINLADUNG, nicht freie Registrierung. Massimo + ausgewaehlte Tester, sonst niemand. Da der Consent-Screen im Google-Cloud-Projekt ohnehin im "Testing"-Status mit eingetragenen Test-Usern laeuft (nur diese koennen sich per Google-OAuth ueberhaupt einloggen), deckt das die Allowlist-Anforderung bereits auf Google-Seite ab -- zusaetzlich bitte serverseitig eine einfache Allowlist-Pruefung (z.B. Tabelle/Config mit erlaubten E-Mail-Adressen) ergaenzen, falls der Consent-Screen spaeter auf "In Production" wechselt oder als zweite Absicherung, POST /accounts (bzw. der Callback nach OAuth) lehnt nicht-gelistete Adressen ab mit klarer Fehlermeldung statt stillem Fehlschlag.

Kein Blocker fuer den simulierten/gemockten Teil der Auth-Arbeit -- kann parallel weiterlaufen, waehrend Massimo das Google-Cloud-Projekt einrichtet.


[2026-09-10] [erledigt: 6886882 — Web + iOS, siehe SYNC.md "Antworten ohne KI-Zwang"] [Track C/F, UX-Fund von Massimo im echten Geraete-Test] — "Antworten" oeffnet aktuell (vermutlich) nur den Weg ueber einen KI-generierten Entwurf. Das ist zu eng: der User muss direkt selbst frei schreiben koennen, ohne vorher einen KI-Entwurf anzufordern/abwarten/zu loeschen.

Gewuenschter Flow: Klick auf "Antworten" oeffnet SOFORT ein leeres (oder nur mit Zitat des Original-Threads vorausgefuelltes) Compose-Feld, in das der User direkt selbst tippen kann. Der KI-Entwurf (POST /messages/{id}/reply-draft) ist ein SEPARATER, optionaler Button/Icon INNERHALB des Compose-Screens (z.B. "KI-Vorschlag einfuegen"), nicht die einzige oder erste Moeglichkeit zu antworten. Deckt sich mit dem bereits bestehenden Prinzip "Compose-Text bleibt vollstaendig user-editierbar, KI-Entwurf ist nur Vorschlag" (SYNC.md 08.09.) -- das war schon als Grundsatz festgehalten, aber offenbar in der UI noch nicht so umgesetzt/wahrgenommen.

Kein Contract-Bruch (beide Endpunkte /messages/send und /messages/{id}/reply-draft existieren unabhaengig voneinander bereits, reine UI-Frage: reply-draft darf nicht die Vorbedingung fuer den Zugriff aufs Compose-Feld sein). Kein Blocker, aber bitte zeitnah, ist eine spuerbare Einschraenkung im taeglichen Gebrauch.


[2026-09-10] [erledigt: iOS-Placeholder bereits 15.09. (siehe ios/README.md "Ordnername-Vorschlag 'Dokumente'"), bestehender Mock-Ordner 25.09. Commit 7cf3454 umbenannt] [Track C/F, kleine UX-Ergaenzung] — Massimo: "Rechnungen" ist als Ordnername negativ behaftet (klingt nach Kosten/Schulden), deckt ausserdem nicht ab, dass darin auch Vertraege und andere wichtige Unterlagen landen koennen. Kein System-Ordner-Comeback (wichtig/rechnungen bleiben bewusst entfernt, siehe fruehere Entscheidung) -- stattdessen ein besserer NAMENSVORSCHLAG, wenn der User selbst einen eigenen Ordner fuer sowas anlegt.

Vorschlag: "Dokumente" als neutraler Sammelbegriff (deckt Rechnungen, Vertraege, sonstige wichtige Unterlagen ab, ohne negative Konnotation).

Konkret in der UI: beim Anlegen eines neuen eigenen Ordners (POST /folders) koennte die UI 1-2 sinnvolle Namensvorschlaege als Chips/Quick-Picks anbieten statt eines leeren Textfelds, z.B. "Dokumente" als einer davon. Kein Contract-Change noetig (Ordnername ist ohnehin freier Text), reine Onboarding-/Leerzustand-UX-Verbesserung. Kein Blocker, kleine Sache fuer spaeter im Compose-/Ordner-Polish.


[2026-09-10] [erledigt: iOS 15.09. (siehe ios/README.md "Header zeigt Konto-Adresse statt 'driftmail'"), Praezisierung fuer mehrere Konten siehe Eintrag 24.09. "PRAEZISIERUNG - Titel oben bei mehreren Konten" weiter unten] [Track C/F, UX-Fund von Massimo im echten Geraete-Test] — Wo aktuell oben "Driftmail" als App-Titel/Branding steht, soll stattdessen die E-Mail-Adresse des verbundenen Kontos stehen, damit der User immer sofort sieht, in welchem Postfach er sich befindet (besonders wichtig sobald mehrere Mail-Konten unterstuetzt werden, siehe mail_accounts-Tabelle, die das schon vorsieht).

Vorschlag: Header/Navigationsleiste zeigt die emailAddress des aktuell aktiven MailAccount (aus GET /accounts) statt oder zusaetzlich zum App-Namen. Bei mehreren verbundenen Konten koennte das zugleich als Account-Switcher fungieren (Tap/Klick auf die Adresse oeffnet Kontenwahl) -- das waere ein natuerlicher Ort dafuer, aber kein Muss fuer diesen Auftrag, reicht erstmal nur die Anzeige.

Passt zur bereits bestehenden Regel "kein driftmail-Branding in ausgehenden Mails" (WEB_INBOX.md 09.09.) -- gleiches Prinzip jetzt auch fuer die App-UI selbst: der User und sein Konto stehen im Vordergrund, nicht das Produkt.

Kein Contract-Change noetig (emailAddress existiert bereits in MailAccount-Schema), reine UI-Aenderung. Kein Blocker.


[2026-09-10] [teilweise erledigt: App-Icon (Track C) fertig, Header-Logo mit Text (Track F/Splash) offen -- Begruendung siehe SYNC.md 25.09.] [Track C/F, App-Icon/Logo-Design] — Massimo moechte ein neues App-Icon/Logo: ein GESCHLOSSENER Briefumschlag (klare Rand-/Umriss-Linie, nicht die klassische "offene Klappe"-Mail-Icon-Optik), mit dem Schriftzug "driftmail" halbtransparent (ca. 50% Deckkraft) im Hintergrund/auf dem Umschlag platziert. Farbe: Hellblau. Schrift: elegant, nicht die Standard-Systemschrift (in unseren Mockup-Versuchen kam Serif kursiv der Vorstellung am naechsten, aber final nicht bestaetigt).

Wichtig: Die exakte Form/Randstaerke/Proportion konnten wir per Text-Hin-und-Her nicht zuverlaessig treffen (mehrere Iterationen, siehe Chat-Verlauf) -- bitte NICHT versuchen, das 1:1 aus dieser Beschreibung zu bauen, sondern als Ausgangspunkt nehmen und in einem echten Design-Tool (Figma, SF Symbols, o.ae.) 2-3 Varianten bauen und Massimo direkt zeigen (Screenshot/Export), damit er live reagieren kann statt ueber Textbeschreibung zu raten.

Referenz-SVG als grober Ausgangspunkt (NICHT final, nur Idee):
```svg
<svg viewBox="0 0 680 320">
  <path d="M120 110 L340 50 L560 110 L560 270 L120 270 Z" fill="#4A90D9" opacity="0.10" stroke="#4A90D9" stroke-width="6" stroke-linejoin="round"/>
  <text x="340" y="242" text-anchor="middle" font-family="serif" font-style="italic" font-size="50" fill="#4A90D9" opacity="0.5">driftmail</text>
</svg>
```

Zielverwendung: App-Icon (iOS AppIcon-Asset, Track C) und/oder Header-Logo im Web (Track F) -- bitte klaeren, ob beide dasselbe Icon nutzen oder getrennte Varianten noetig sind (App-Icon braucht meist ein Vollbild-Quadrat ohne Transparenz-Spielerei, das beschriebene Konzept mit Text im Hintergrund passt eher zu einem Header-Logo/Splash-Screen als zum App-Icon selbst -- bitte diese Unterscheidung selbst treffen und kurz in SYNC.md begruenden).

**Umgesetzt (Terminal, 25.09., Commit `7cf3454`, siehe SYNC.md 25.09. fuer die Begruendung):** die Unterscheidung wurde getroffen -- das App-Icon (`Assets.xcassets/AppIcon.appiconset`) ist bewusst OHNE den halbtransparenten "driftmail"-Schriftzug gebaut: bei den Groessen, in denen ein App-Icon tatsaechlich vorkommt (Homescreen, Einstellungen, App-Store-Listing, teils nur wenige Millimeter gross), waere kursiver Serif-Text nicht lesbar und wuerde nur wie Bildrauschen wirken -- ein App-Icon muss auf den ersten Blick als Symbol funktionieren, nicht als gelesener Schriftzug. Stattdessen ein klarer, eindeutig geschlossener Briefumschlag in der App-Akzentfarbe (aktuell `#0078D4`, folgt automatisch der Design-Richtung), volles Quadrat ohne Transparenz. Das im Auftrag selbst als moeglich genannte GETRENNTE Header-Logo-Konzept MIT Text (passend fuer eine Web-Kopfzeile oder einen App-Splash-Screen, wo mehr Platz UND Kontext vorhanden ist) wurde damit NICHT gebaut -- das bleibt fuer Track F offen, falls fuer die Web-Seite/den Web-Client gewuenscht.

Kein Blocker, kein Contract-Change. Reine Design-/Asset-Aufgabe.


[2026-09-10] [teilweise erledigt: Punkte 1+2, siehe SYNC.md] [PRIORITAET - Reihenfolge] [alle Tracks] — Massimo: erst Funktion, dann Optik. Bitte die 6 aktuell offenen Punkte in dieser Reihenfolge abarbeiten:

FUNKTIONAL ZUERST:
1. ~~Auth (Track A) — Entscheidungen sind beantwortet (OAuth-Flow + Allowlist), Umsetzung hat Prioritaet.~~ **Erledigt (Terminal, 10.09., Commit `b6e374d`):** echter Google-OAuth-Redirect-Flow + serverseitige Allowlist, siehe SYNC.md "Echter Google-Login + Allowlist".
2. ~~"Antworten" ohne KI-Zwang (Track C/F) — echte funktionale Luecke, kein Design-Detail.~~ **Erledigt (Terminal, 10.09., Commit `6886882`):** Web + iOS, siehe SYNC.md "Antworten ohne KI-Zwang".

OPTIK/POLISH DANACH, NICHT VORHER:
3. Ordnername-Vorschlag "Dokumente" statt "Rechnungen"
4. Header zeigt E-Mail-Adresse statt "Driftmail"
5. App-Icon/Logo-Design (geschlossener Umschlag, Hellblau)

Bitte diese Reihenfolge einhalten, auch wenn die Optik-Punkte evtl. schneller zu erledigen waeren -- Funktion geht vor Politur. Kein Blocker, nur Priorisierung.


[2026-09-10] [aufgehoben: 2026-09-22, Terminal, auf Rueckfrage bestaetigt] [WICHTIG - sofort beachten] [Track C, alle iOS-Tests] — Massimo: der letzte Test-Durchlauf auf dem echten iPhone hat die Geraete-Einstellungen durcheinandergebracht/beschaedigt. Bitte bis auf Weiteres NICHT mehr gegen das echte iPhone testen/deployen (kein xcodebuild -destination mit dem physischen Geraet, keine Play-Anweisung Richtung echtem Handy).

Update 22.09.: Massimo hat auf ausdrueckliche Rueckfrage bestaetigt, dass Echtgeraet-Tests fuer driftmail jetzt wieder erlaubt sind. Sperre aufgehoben.

Bitte NUR NOCH GEGEN DEN SIMULATOR testen (xcodebuild -destination 'platform=iOS Simulator,name=iPhone 17 Pro' o.ae., wie bisher ueberwiegend gemacht). Das reicht fuer Build-Verifikation und Funktionstests voellig aus. Massimo meldet sich, wenn das echte Geraet wieder freigegeben ist.

Kein Blocker fuer die Weiterarbeit an sich (Simulator-Tests reichen), nur eine Einschraenkung bei der Test-Zieleinstellung.


[2026-09-14] [offen] [FREIGABE - durchlaufen ohne weitere Rueckfrage] [alle Tracks] — Massimo: alles Offene ist entschieden, bitte am Stueck durcharbeiten, ohne auf weiteres Feedback zu warten. Zusammenfassung aller aktiven Entscheidungen zum Nachschlagen:

1. Auth: implizit ueber Mail-Konto-Verbindung (kein separater Login-Endpunkt), Allowlist statt freier Registrierung, echter Gmail-OAuth kommt sobald Massimo das Google-Cloud-Projekt fertig hat (laeuft).
2. Vorbestehender Migrations-Smoketest-Bug (system_key='wichtig'): bitte fixen.
3. "Antworten ohne KI-Zwang": Compose-Feld sofort leer nutzbar, KI-Entwurf nur optionaler Zusatz-Button. NAECHSTER FUNKTIONALER SCHRITT, hoechste Prioritaet nach Auth.
4. Danach Optik/Polish in beliebiger Reihenfolge: Ordnername-Vorschlag "Dokumente", Header zeigt E-Mail-Adresse statt "Driftmail", App-Icon/Logo (geschlossener Umschlag, Hellblau, siehe Referenz-SVG im aelteren Eintrag).
5. WICHTIG weiterhin gueltig: nur Simulator-Tests fuer iOS, kein echtes Geraet, bis Massimo explizit gruenes Licht gibt.

Kein Blocker, keine offene Frage mehr an Web/Massimo aus diesem Block. Bitte einfach der Reihe nach abarbeiten und wie gewohnt in SYNC.md/TERMINAL_INBOX.md dokumentieren -- Web prueft regelmaessig eigenstaendig nach.


[2026-09-15] [erledigt: 596d333 (Punkt 1, bereits vorher fertig) + b1a2173 (Punkt 2)] [Reihenfolge nach Wichtigkeit] [Track C/F] — Nur noch zwei echte offene Punkte, bitte in dieser Reihenfolge:

1. ZUERST (klein, schnell): Ordnername-Vorschlag "Dokumente" beim Anlegen eines eigenen Ordners (Chip/Quick-Pick statt leeres Textfeld). Reine UI-Kleinigkeit, sollte in Minuten erledigt sein.
2. DANACH (aufwendiger): App-Icon/Logo-Design -- 2-3 PNG-Varianten in einem echten Design-Tool bauen, ins Repo committen (siehe SYNC.md "Antwort: wie Massimo die Icon-Varianten sehen will", 15.09.), Massimo entscheidet dann direkt anhand der Bilder.

**Umgesetzt:** Punkt 1 war zu diesem Zeitpunkt bereits fertig (Commit `596d333`, siehe SYNC.md-Klarstellung 15.09.). Punkt 2: 3 PNG-Varianten in `ios/DriftmailApp/Resources/AppIcon-Vorschlaege/` committet (Commit `b1a2173`), Details/Trade-offs/offene Massimo-Entscheidung in SYNC.md. Damit ist die aktuelle Liste komplett abgearbeitet, kein Blocker.


[2026-09-15] [erledigt: siehe SYNC.md "STABILITÄTS-CHECK"] [STABILITAETS-CHECK vor Simulator-Test] [alle Tracks] — Massimo: bevor er sich das Ergebnis im Simulator anschaut, soll das Fundament nachweislich stabil stehen, nicht nur einzeln berichtet. Bitte einmal komplett und am Stueck durchlaufen lassen:

1. Backend: npm run typecheck und npm test (mit UND ohne DATABASE_URL, also In-Memory- und echter Postgres-Pfad).
2. Web: npm run build.
3. iOS: xcodebuild -scheme DriftmailApp -destination 'platform=iOS Simulator,name=iPhone 17 Pro' build (voller Build, nicht nur Teil-Checks).
4. Kurzer End-to-End-Rundgang, falls moeglich: Login/Auth-Flow, Ordner anzeigen (neue Struktur eingang/entwuerfe/gesendet/sonstiges/quarantaene/spam/papierkorb), eine Mail oeffnen, Antworten-Button testen (Compose-Feld direkt nutzbar), Senden-Flow bis vor dem tatsaechlichen Versand.

Bitte ALLE vier Ergebnisse (nicht nur "war schon mal gruen") in SYNC.md als ein zusammenhaengender Status-Eintrag festhalten, mit Datum von heute. Falls irgendwo etwas bricht: bitte beheben, bevor Massimo in den Simulator schaut -- kein "kommt schon hin", echte gruene Bestaetigung gewuenscht.

Kein Blocker im Sinne einer neuen Funktionalitaet, nur eine Absicherung vor dem naechsten sichtbaren Schritt.


[2026-09-15] [erledigt: siehe SYNC.md "Sensible-Dokument-Erkennung"] [Track A/B — Track C/F Teil bewusst nicht gebaut, siehe dort] [nach dem Stabilitaets-Check] — Massimo: Erweiterung der bestehenden Sensible-Daten-Erkennung (IBAN/Kreditkartennummer im Text, bereits fertig, siehe SYNC.md 30 neue Tests) um FOTOS von Ausweisen und Kreditkarten als Anhang.

**Technischer Ansatz -- OCR statt neues Bildmodell:**
Kein trainiertes Bilderkennungsmodell noetig. Stattdessen: Text per OCR aus dem Bild extrahieren, dann die BEREITS VORHANDENE Text-Pattern-Erkennung (creditCardDetection.ts, Luhn-Validierung) auf den OCR-Text anwenden -- Wiederverwendung statt Neubau. Zusaetzlich ein zweites, gut etabliertes Muster fuer Ausweise/Reisepaesse: die MRZ (Machine Readable Zone, die zwei/drei Zeilen mit "<"-Fuellzeichen unten auf jedem Ausweisdokument/Reisepass) -- feste, laenderuebergreifend genormte Struktur, zuverlaessig per Regex auf OCR-Text erkennbar, kein ML-Training noetig.

**Wo einhaengen:** in die bestehende Anhang-Scan-Pipeline (message_attachments, siehe fruehere Auftraege zu Anhang-Upload/Scan). Nach dem Malware-/Dateityp-Scan zusaetzlich: wenn Anhang ein Bildformat ist (jpg/png/heic), OCR-Durchlauf, dann Pattern-Check (Kreditkarte via bestehende Luhn-Logik, Ausweis via MRZ-Regex).

**OCR-Quelle, passend zur bestehenden On-Device/Cloud-Fallback-Philosophie (siehe ai-adapter-interface.ts):**
- iOS: Apples eigenes Vision-Framework (VNRecognizeTextRequest) -- laeuft on-device, kein externer Dienst noetig, keine zusaetzlichen Kosten.
- Web/Backend: Cloud-Fallback-OCR-Dienst (Anbieter offen, Track A/B entscheidet -- z.B. Tesseract.js on-device im Browser als erste Stufe, echter Cloud-OCR nur falls Qualitaet nicht reicht).

**Contract-Vorschlag:** message_attachments um Spalte contains_sensitive_document TEXT CHECK (IN 'none','credit_card','id_document') erweitern, analog zu scan_status. Response von POST /attachments (siehe frueherer Anhang-Upload-Auftrag) um dieses Feld ergaenzen.

**Verhalten:** wie bei Text-IBAN/Kreditkarte -- NICHT blockierend, nur Warnhinweis (Sprechblase/Banner), User kann trotzdem senden wenn er wirklich will (z.B. legitimer Fall: eigenen Ausweis an eine Behoerde schicken). Gleiche Begruendung wie beim Text-Pendant: Warnung statt Verbot, da es legitime Anwendungsfaelle gibt.

Kein Blocker, aber bitte NACH dem gerade angeforderten Stabilitaets-Check einordnen -- neue Funktionalitaet, nicht Teil der Stabilitaetspruefung selbst.


[2026-09-15] [erledigt: 4b08b35 (Contract + Track A/B), Track C/F bewusst nicht gebaut, siehe SYNC.md 19.09.] [NEUER AUFTRAG] [contracts/db-schema.sql + contracts/api-spec.yaml + Track A/B + Track C/F] [nach Stabilitaets-Check + OCR-Auftrag] — Massimo: zwei getrennte Ergaenzungen zur Absender-Behandlung.

**1) Whitelist fuer vertrauenswuerdige Absender (User-Entscheidung, nicht automatisch):**
Der User soll einen Absender nach eigener Pruefung explizit als vertrauenswuerdig markieren koennen -- das ist eine bewusste User-Entscheidung, KEINE automatische Klassifikation.

Neue Tabelle:
```sql
CREATE TABLE IF NOT EXISTS trusted_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_address TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, sender_address)
);
```

Endpunkte: POST /trusted-senders (Adresse hinzufuegen, z.B. Button "Absender als vertrauenswuerdig markieren" in der Detailansicht einer Mail), GET /trusted-senders (Liste), DELETE /trusted-senders/{id} (entfernen). Wirkung: Mail von einer gelisteten Adresse wird beim naechsten Klassifikations-Durchlauf NICHT mehr als spam/phishing eingestuft (landet direkt in eingang), unabhaengig vom sonstigen Auth-/Link-Signal -- Whitelist hat Vorrang vor der automatischen Erkennung. Kein Ruecktausch bereits vorhandener alter Nachrichten noetig, wirkt nur fuer kuenftige Mail ab dem Zeitpunkt des Hinzufuegens.

**2) Neue Auto-Loesch-Kategorie: klassischer Vorschussbetrug ("Prinz aus Nigeria"-Muster):**
Bisher werden nur adult/gambling automatisch geloescht (nicht persistiert). Massimo moechte den klassischen Vorschussbetrug/Erbschafts-/Lotteriegewinn-Betrug (grosse Geldsumme, "lieber Freund", dringende Bitte um Bankdaten um Geld zu empfangen -- das bekannte Muster) genauso sofort loeschen wie adult/gambling, nicht nur in Quarantaene mit Warnhinweis.

Vorschlag: neuer spam_subcategory-Wert 'advance_fee_scam' (Enum in message_security erweitern: adult|gambling|generic|marketing|advance_fee_scam), Keyword-/Muster-Heuristik in Track B's detectSpamSubcategory() ergaenzen (aehnliches Verfahren wie adult/gambling: mehrere typische Signalworte/-phrasen, nicht ein einzelnes Wort). Wenn 'advance_fee_scam' erkannt wird: gleiche Auto-Delete-Behandlung wie adult/gambling (nicht persistieren, Audit-Log ohne Inhalt).

WICHTIG, Abgrenzung: das bleibt eine UNTERKATEGORIE von spam, NICHT von phishing. Klassische Phishing-Mails (Credential-Diebstahl, gefaelschte Login-Seiten) bleiben unveraendert bei der vorsichtigeren Quarantaene-mit-Warnhinweis-Behandlung -- dort ist das Risiko eines Fehlalarms teurer (koennte eine echte, wichtige Sicherheitswarnung sein), waehrend der Vorschussbetrug ein eindeutiges, seit Jahrzehnten bekanntes Muster ohne legitimen Graubereich ist.

Kein Blocker, bitte nach dem Stabilitaets-Check und dem OCR-Auftrag einordnen. Beide Punkte unabhaengig voneinander umsetzbar, koennen parallel laufen.


[2026-09-15] [erledigt: 1/2/3/4 + 5 gebaut, 6 geprueft und bewusst nicht gebaut (Begruendung + offene Frage an Massimo/Web), siehe SYNC.md 19.09.; Track C/F fuer 1/2/3/4 bewusst nicht gebaut] [NEUE AUFTRAEGE - 6 Sicherheits-Ergaenzungen] [Track A/B + Track C/F + contracts] [nach Stabilitaets-Check + OCR + Whitelist/Vorschussbetrug] — Massimo hat sechs weitere Sicherheitsluecken bestaetigt, alle sechs sollen umgesetzt werden. Getrennte, unabhaengige Punkte:

**1) Anzeigename-Spoofing-Erkennung (Track B):**
Absender-Anzeigename (z.B. "PayPal Support") stimmt inhaltlich nicht mit der Domain der echten Absenderadresse ueberein (z.B. Anzeigename nennt eine bekannte Marke/Firma, tatsaechliche Adresse hat eine komplett andere/verdaechtige Domain). Neues Signal in security-classification, aehnliches Muster wie die bestehende Homoglyph-Erkennung: bekannte Markennamen-Liste (PayPal, Amazon, Bank-Namen etc. -- Startliste ausreichend, muss nicht vollstaendig sein) im Anzeigenamen gegen die tatsaechliche Absender-Domain abgleichen. Erhoeht bei Treffer classification-Konfidenz Richtung phishing.

**2) Reply-To-Mismatch (Track B):**
Falls die Mail einen Reply-To-Header hat, der von der sichtbaren From-Adresse abweicht (klassischer BEC-Trick), ist das ein zusaetzliches Phishing-Signal. Reply-To-Header muss beim Mail-Sync mit eingelesen werden (Track A, falls noch nicht vorhanden), dann Vergleich in security-classification.

**3) IBAN-Wechsel im selben Thread (Track A + B):**
Baut auf der bestehenden IBAN-Erkennung (containsNewIban) auf. Wenn innerhalb desselben Threads (gleicher in_reply_to_message_id-Verlauf) eine ANDERE IBAN auftaucht als in einer frueheren Nachricht desselben Threads, ist das ein starkes Betrugssignal (Rechnungsbetrug/"IBAN-Wechsel-Trick"). Braucht Zugriff auf vorherige Nachrichten desselben Threads waehrend der Klassifikation -- das ist ein Zustandsbezug, den das bisher zustandslose security-classification/ nicht selbst hat (siehe fruehere Architektur-Entscheidung: externe/zustandsbehaftete Pruefungen laufen als Nachbearbeitung in Track A). Bitte als weiteren Nachbearbeitungsschritt in Track A einbauen, analog zu den vier bestehenden externen Lookups.

**4) "Erster Kontakt"-Kennzeichnung (Track A + C/F):**
Mail von einer Adresse, von der der User noch nie zuvor eine Mail bekommen hat, bekommt ein dezentes UI-Kennzeichen ("Neuer Absender"). Pruefung: existiert bereits eine fruehere Nachricht mit derselben From-Adresse fuer diesen User? Kein neues Feld noetig, kann zur Laufzeit aus messages abgeleitet werden (oder als Cache-Feld, Track A entscheidet). Ergaenzt sich gut mit der gerade gebauten Whitelist (trusted_senders) -- ein Absender, der noch NICHT auf der Whitelist steht UND zum ersten Mal schreibt, ist der Fall, der das Kennzeichen bekommt.

**5) App-Sperre per Face ID/Touch ID (Track C, evtl. Track F wo technisch moeglich):**
Zusaetzlich zum Mail-Konto-Login: App selbst mit biometrischer Sperre schuetzen (iOS: LocalAuthentication-Framework), damit der lokale Mail-Cache geschuetzt ist, falls das Geraet verloren geht/gestohlen wird, waehrend die App noch eingeloggt ist. Optional in den Einstellungen aktivierbar (nicht erzwungen, User-Entscheidung), aber deutlich empfohlen beim Onboarding.

**6) Verschluesselung der lokalen Mail-Datenbank (Track A/C/F, je nach Speicherort):**
Die lokal zwischengespeicherten Mails (siehe fruehere Diskussion zu lokalem IMAP-Cache) sollen at-rest verschluesselt sein, nicht nur durch die generelle Geraeteverschluesselung. iOS: Core-Data-Verschluesselung oder Keychain-gestuetzter Schluessel, macOS-Web-Client: je nach tatsaechlichem Speicherort (IndexedDB o.ae.) pruefen, was realistisch umsetzbar ist. Bitte Grenzen ehrlich dokumentieren, falls eine Plattform das nicht vollstaendig abbilden kann.

Kein Contract-Bruch bei 1/2/4 (neue Felder/Signale, additiv). Bei 3 und 6 bitte Umfang/Grenzen klar in SYNC.md dokumentieren, da beides etwas aufwendiger ist. Alle sechs unabhaengig voneinander umsetzbar, Reihenfolge nach eigenem Ermessen -- Vorschlag: 1/2/4 zuerst (klein, additiv), dann 3, dann 5/6 (groesserer Aufwand).


[2026-09-15] [teilweise erledigt: Track A (Gmail-OAuth-Fertigstellung + IMAP-Passwort-Weg + GET /mail-providers) siehe SYNC.md 19.09.; Track C/F (Provider-Auswahl-UI) + Outlook/Yahoo-OAuth weiterhin offen] [ECHTE LUECKE ENTDECKT - vor Massimo/Web uebersehen] [contracts/api-spec.yaml + Track A + Track C/F] — Massimo hat nachgefragt, ob der Einrichtungsassistent bereits gaengige Mail-Provider unterstuetzt. Verifiziert (Volltextsuche ueber SYNC.md/WEB_INBOX.md): NEIN, bisher wurde ausschliesslich Gmail-OAuth geplant/umgesetzt. Kein einziger Treffer fuer Outlook, GMX, web.de, iCloud, Yahoo in der gesamten Historie. Das war von Anfang an als Ziel gesetzt ("gaengige Mailprogramme"), aber nie explizit als Auftrag nachgezogen -- eigenes Versaeumnis, nicht Track-A/C/F-Verschulden.

**Was fehlt konkret:**

1) **Provider-Auswahl im Onboarding:** Screen mit Buttons/Logos fuer die haeufigsten Anbieter, nicht nur ein Gmail-Button. Mindestens: Gmail, Outlook/Microsoft 365, iCloud Mail, GMX, web.de, Yahoo, plus "Anderer Anbieter (IMAP)" als Auffangoption.

2) **Zwei unterschiedliche Anmeldewege, je nach Anbieter:**
   - OAuth-faehige Anbieter (Gmail, Outlook, Yahoo): eigener OAuth-Consent-Flow pro Anbieter. Gmail-OAuth ist in Arbeit (Massimo richtet Google-Cloud-Projekt ein). Outlook braucht ein eigenes Microsoft-Entra/Azure-AD-App-Setup (separates Projekt bei Microsoft, aehnlich wie bei Google), Yahoo ebenso bei Yahoo Developer.
   - IMAP-Passwort-Anbieter (GMX, web.de, iCloud, generisches IMAP): kein OAuth verfuegbar. User gibt E-Mail-Adresse + APP-SPEZIFISCHES Passwort ein (nicht das normale Account-Passwort -- viele Anbieter verlangen bei aktivierter 2FA ein separates App-Passwort, das im Onboarding kurz erklaert werden sollte, mit Link zur jeweiligen Anleitung des Anbieters). IMAP/SMTP-Server-Einstellungen (Host, Port, TLS) automatisch anhand des gewaehlten Providers vorbefuellen (z.B. GMX: imap.gmx.net:993, web.de: imap.web.de:993, iCloud: imap.mail.me.com:993), damit der User keine Server-Adressen selbst nachschlagen muss. Passt zum bereits bestehenden IMAP-Host-Fallback-Mechanismus (SYNC.md, bitte dort um eine Provider-Preset-Tabelle erweitern statt nur den generischen Fallback).

3) **WICHTIGER NEBENEFFEKT -- Allowlist-Luecke:** Die bisherige v1-Allowlist-Entscheidung (WEB_INBOX.md 10.09.) verlaesst sich mit darauf, dass Googles eigener OAuth-Consent-Screen im "Testing"-Status bereits eine Zugriffsschranke bildet (nur eingetragene Google-Test-User koennen sich ueberhaupt per Gmail-OAuth einloggen). Bei IMAP-Passwort-Anbietern (GMX, web.de, iCloud) gibt es DIESES Google-seitige Gatter nicht -- jeder mit E-Mail+App-Passwort koennte sich sonst anmelden. Deshalb: die bereits im Auth-Auftrag erwaehnte SERVERSEITIGE Allowlist-Pruefung (Tabelle/Config mit erlaubten Adressen, POST /accounts lehnt nicht-gelistete Adressen ab) ist fuer IMAP-Wege nicht mehr optional/zusaetzliche Absicherung, sondern die EINZIGE Absicherung -- bitte sicherstellen, dass sie bereits eingebaut ist bzw. vor dem IMAP-Onboarding-Weg fertig ist, sonst hebelt der IMAP-Pfad die ganze Allowlist-Idee aus.

**Vorschlag zur Reihenfolge:** Gmail-OAuth zuerst fertigstellen (laeuft bereits). Danach IMAP-Passwort-Weg mit Provider-Presets (GMX/web.de/iCloud/generisch) -- technisch einfacher als weitere OAuth-Integrationen, deckt aber schon viele deutsche Nutzer ab. Outlook/Yahoo-OAuth koennen warten, bis Massimo bei Bedarf weitere Provider-Projekte einrichtet (aehnlicher Aufwand wie das Google-Cloud-Projekt).

Kein Blocker fuer die aktuell laufenden Auftraege (Stabilitaets-Check, OCR, Whitelist, die 6 Sicherheits-Ergaenzungen), aber bitte zeitnah einordnen -- ohne das ist der Client fuer alle Nicht-Gmail-Nutzer aktuell gar nicht nutzbar.


[2026-09-19] [erledigt: 8a45c52 (Web), 7980913 (iOS, Punkt 1+2 + echte Session-Verdrahtung, Gmail-OAuth auf iOS bewusst nicht funktional -- siehe SYNC.md Offene Frage)] [PRIORITAET - naechster Schritt] [Track C/F] — Backend-Seite von drei grossen Themen ist fertig (Whitelist/Vorschussbetrug, 5 von 6 Sicherheitsergaenzungen, IMAP-Provider-Support inkl. zweier kritischer Sicherheitsfixes, siehe SYNC.md 19.09.). Bitte jetzt die UI-Seite nachziehen:

1. Onboarding: Provider-Auswahlbildschirm (Gmail, Outlook/Yahoo als "demnaechst", iCloud, GMX, web.de, generisches IMAP) + IMAP-Verbindungsformular mit Preset-Vorbefuellung (GET /mail-providers nutzen) + kurze App-Passwort-Erklaerung mit Link zur jeweiligen Anbieter-Anleitung.
2. Sichtbare Kennzeichen/Badges fuer die neuen Sicherheitssignale: Anzeigename-Spoofing, Reply-To-Mismatch, IBAN-Wechsel im Thread, "Neuer Absender" (isNewSender). Bitte am bestehenden Farbrollen-/Warnhinweis-System orientieren (design-tokens.json colorRole, gleiche Sprechblasen-/Banner-Optik wie bei den bereits bestehenden Warnungen), keine neue visuelle Sprache erfinden.
3. Face-ID/Touch-ID-App-Sperre ist auf iOS laut Bericht schon "echt gebaut" -- bitte auf Web pruefen, ob/wie ein Aequivalent sinnvoll ist (z.B. WebAuthn/Passkey-Sperre beim Aufwachen aus Inaktivitaet), oder dokumentieren falls technisch nicht sinnvoll uebertragbar.

Kein Blocker, alle drei Punkte unabhaengig. IMAP-Login-Weg bitte einmal von Massimo selbst mit echtem GMX-/web.de-/iCloud-Konto gegengetestet werden, sobald Zeit ist (siehe SYNC.md 19.09.) -- das kann parallel zur UI-Arbeit laufen, ist kein Abhaengigkeits-Blocker dafuer.


[2026-09-21] [erledigt: Backend f189450 (Punkt 1 Einstellungs-Schalter, Punkt 2 braucht keine Backend-Aenderung, Punkt 3 Mock-Anbindung, Punkt 4, Punkt 5); Track C (iOS) UI fuer alle 5 Punkte fertig (a8ff66f, siehe ios/README.md); Track F (Web) UI fuer alle 5 Punkte fertig (5d9bbe0, siehe web/README.md "Nachtrag: Neun neue Features")] [NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken] [contracts + Track A/B + Track C/F] [nach der aktuell laufenden UI-Arbeit] — Massimo hat driftmail gegen Proton Mail, Hey und Superhuman/Canary Mail verglichen (Web-Recherche). Fuenf Punkte bestaetigt, alle sollen in die Queue:

**1) Tracking-Pixel-Blockierung (Track A + C/F):**
Eingehende Mails enthalten oft unsichtbare 1x1-Bilder ("Tracking-Pixel"), die dem Absender melden, wann/ob/wie oft die Mail geoeffnet wurde. Proton und Hey blockieren das standardmaessig per Bild-Proxy (Bilder werden ueber einen eigenen Server geladen statt direkt vom Absender, IP/Oeffnungszeitpunkt bleibt verborgen). Vorschlag: Bilder in HTML-Mails standardmaessig NICHT automatisch laden (aehnlich wie viele Mail-Clients das schon bei "externe Bilder blockieren" machen), User kann pro Mail oder generell "Bilder immer laden" waehlen. Reine Client-seitige Aenderung, kein neuer Server-Proxy noetig fuer die einfache Variante (nur Bild-Autoload deaktivieren) -- ein echter Proxy (der auch die Absender-IP-Sicht verbirgt) waere die staerkere, aber aufwendigere Variante, Track A entscheidet Umfang.

**2) Undo Send (Track A + C/F):**
Kurzes Zeitfenster (z.B. 5-10 Sekunden, konfigurierbar) nach Klick auf "Senden", in dem der Versand noch zurueckgeholt werden kann, bevor er tatsaechlich beim Provider rausgeht. Passt technisch gut zum bestehenden POST /messages/send-Flow: Client zeigt sofort eine "Rueckgaengig"-Leiste, der tatsaechliche Provider-Send-Call wird verzoegert ausgefuehrt (z.B. per Timer, der bei Klick auf "Rueckgaengig" abgebrochen wird). Kein Contract-Bruch, eher eine Ablauf-/UI-Aenderung um den bestehenden Endpunkt herum.

**3) Darkweb-/Datenleck-Ueberwachung (Track A):**
Warnt den User, falls seine verbundene Mail-Adresse in einem bekannten oeffentlichen Datenleck auftaucht (aehnliches Prinzip wie Proton). Braucht Anbindung an einen externen Leak-Datenbank-Dienst (z.B. haveibeenpwned-artige API) -- passt vom Muster her zu den bereits bestehenden vier externen Lookups (WHOIS/Spamhaus/IBAN-Historie/fraud_alerts), gleiche Architektur-Entscheidung gilt (Nachbearbeitungsschritt, nicht in security-classification/ selbst). Neue Tabelle fuer gemeldete Leck-Treffer + Benachrichtigung, Details/Contract Track A ueberlassen.

**4) Schedule Send / Spaeter senden (Track A + C/F):**
Standard-Feature: User waehlt beim Senden einen spaeteren Zeitpunkt statt sofort. Erweiterung von POST /messages/send um ein optionales scheduledFor-Feld, oder als eigener Entwurfs-Status in der bereits bestehenden drafts-Tabelle (Track A entscheidet, welcher Ansatz sich besser in die bestehende Architektur einfuegt).

**5) Snooze / "Spaeter erinnern" (Track A + C/F):**
Mail voruebergehend aus dem Eingang ausblenden, taucht zum gewaehlten Zeitpunkt automatisch wieder oben auf. Ergaenzt sich gut mit dem bereits bestehenden reminders-Feature (aehnliches Prinzip, aber auf die Nachricht selbst bezogen statt auf einen erkannten Termin/Vertrag) -- pruefen, ob reminders wiederverwendet werden kann oder ein eigenes, einfacheres Feld an messages (z.B. snoozed_until) sinnvoller ist.

**Bewusst NICHT uebernommen, zur Kenntnis:** Lesebestaetigungen/Sender-seitiges Oeffnungs-Tracking (wie bei Superhuman) passt nicht zur Philosophie von driftmail -- das ist genau das Gegenteil von Punkt 1 (wir blockieren Tracking, bauen keins fuer den eigenen Versand ein). Keine Aktion noetig, nur zur Abgrenzung dokumentiert.

Kein Blocker, bitte nach der aktuell laufenden UI-Arbeit (Onboarding-Provider-Auswahl, Sicherheits-Badges) einordnen. Alle fuenf Punkte unabhaengig voneinander umsetzbar.


[2026-09-21] [erledigt: f570a7b] [WICHTIGE LUECKE ENTDECKT - echter Malware-Scan] [contracts + Track A/B] [hohe Prioritaet, nach der aktuell laufenden UI-Arbeit] — Massimo hat nachgefragt, wie mit potenziell schadhaften Mail-Anhaengen/Fotos umgegangen wird. Geprueft (SYNC.md-Volltextsuche): Anhang-Scan existiert BISHER NUR beim SENDEN (POST /attachments), und selbst dort ist es laut eigener Dokumentation nur ein MOCK (attachmentScanMock.ts: Dateiendungs-Blockliste + ein deterministischer Test-Ausloeser, kein echter Virenscan). Fuer EINGEHENDE Mail-Anhaenge gibt es aktuell UEBERHAUPT KEINEN Scan -- eine Mail mit bösartigem Anhang landet ungeprueft im Postfach.

**Bestaetigter Ansatz von Massimo:**

1) **Echter Scan-Motor: ClamAV** (kostenlos, quelloffen, selbst hostbar) statt eines bezahlten Drittanbieter-Dienstes -- passt zur bisherigen Linie, keine unnoetigen externen Abhaengigkeiten. Ersetzt den bestehenden attachmentScanMock.ts durch eine echte ClamAV-Anbindung (z.B. per clamd-Daemon + clamscan/clamdscan-Client-Bibliothek, oder ueber einen kleinen eigenen Sidecar-Service, falls das Hosting-Setup das erfordert -- Track A entscheidet die konkrete Infrastruktur).

2) **Scan in BEIDEN Richtungen:**
   - Bestehend (Senden): attachmentScanMock.ts durch echten ClamAV-Aufruf ersetzen, scan_status-Logik (pending/clean/malicious/blocked_type/scan_failed) bleibt wie ist, nur die tatsaechliche Pruefung dahinter wird real.
   - NEU (Empfangen): eingehende Mail-Anhaenge (inkl. Fotos/Bilder) werden beim Mail-Sync ebenfalls durch denselben ClamAV-Scan geschickt, BEVOR sie im Client anzeigbar/herunterladbar sind. message_attachments wird ja laut frueherer Notiz ("urspruenglich fuer Anhang-Scan bei eingehenden Mails gedacht") bereits fuer diesen Zweck vorgesehen -- message_id ist dafuer nicht mehr NULL (im Gegensatz zum Ausgehend-Fall mit uploaded_by_user_id). Falls ein Anhang als malicious erkannt wird: nicht automatisch loeschen (anders als bei den Spam-Auto-Delete-Faellen), sondern mit deutlicher Warnung anzeigen/blockieren -- der User soll die Mail selbst noch sehen koennen (koennte z.B. ein legitimer Absender mit einem versehentlich infizierten Anhang sein), nur der Anhang selbst bleibt gesperrt/nicht oeffenbar.

3) **Magic-Bytes-Pruefung statt nur Dateiendung:** echten Dateityp anhand der ersten Bytes der Datei bestimmen (Signatur-Erkennung), nicht nur anhand der Dateiendung/des angegebenen MIME-Types -- verhindert den klassischen Trick, eine ausfuehrbare Datei durch Umbenennen als .jpg/.pdf/etc. zu tarnen. Kombiniert mit ClamAV als zweite Ebene.

**Fotos brauchen keinen separaten Sonderweg** -- ein echter Scan-Motor plus Magic-Bytes-Pruefung deckt auch manipulierte/getarnte Bilddateien ab, kein zusaetzliches Bild-spezifisches Verfahren noetig fuer diesen Auftrag.

Kein Contract-Bruch bei der Logik selbst (scan_status-Enum bleibt), aber die bisher dokumentierte Grenze "kein echter Virenscan" wird damit aufgehoben -- bitte SYNC.md entsprechend aktualisieren, sobald umgesetzt, nicht nur den Code-Kommentar. Hohe Prioritaet, da dies eine der zentralen Sicherheitsversprechen von driftmail direkt betrifft -- bitte zeitnah nach der aktuell laufenden UI-Arbeit einordnen, eher frueher als die 5 Wettbewerbs-Feature-Luecken von eben.


[2026-09-21] [erledigt: 3032b0d] [BUG - Massimo beim manuellen Test gefunden] [Track A oder F] [hohe Prioritaet - blockiert den laufenden IMAP-Verifikationstest] — Massimo hat den lokalen Test (Backend localhost:3000 + Web localhost:5173) gestartet, um den IMAP-Login-Weg mit einem echten web.de-Konto zu pruefen (letzter offener Punkt aus dem 19.09.-Auftrag).

**Fehlerbild:** Im Onboarding erscheint nur "Gmail" als Option, mit Hinweistext "Anbieterliste konnte nicht geladen werden — Gmail ist trotzdem nutzbar". Web.de, GMX, iCloud etc. fehlen komplett aus der Auswahl.

**Root Cause bereits eingegrenzt:** GET /mail-providers direkt im Browser aufgerufen (http://localhost:3000/v1/mail-providers) -- Endpunkt antwortet korrekt mit allen Providern (gmail, outlook, yahoo, icloud, gmx, web_de, other_imap), valides JSON. Das Web-Frontend (laeuft auf Port 5173) kann diese Antwort aber offenbar nicht abrufen, obwohl der direkte Browser-Aufruf funktioniert -- klassisches Muster fuer ein CORS-Problem (unterschiedliche Ports = unterschiedliche Origin aus Browser-Sicht, Backend setzt vermutlich keine oder eine zu enge Access-Control-Allow-Origin-Kopfzeile fuer lokale Dev-Ports).

**Bitte pruefen:** CORS-Konfiguration im Backend (backend/src/index.ts oder wo der Server aufgesetzt wird) -- lokaler Dev-Port des Web-Frontends (5173) muss als erlaubte Origin zugelassen sein, damit GET /mail-providers (und vermutlich auch andere Endpunkte) im lokalen Zwei-Server-Testbetrieb erreichbar sind. Falls CORS in Produktion anders/enger gehandhabt werden soll als im Dev-Betrieb: bitte per Umgebungsvariable unterscheiden (z.B. CORS_ALLOWED_ORIGINS), nicht hart pauschal oeffnen.

Das ist ein echter Blocker fuer den laufenden manuellen IMAP-Verifikationstest -- bitte zeitnah beheben, danach kann Massimo den web.de-Test fortsetzen.


[2026-09-21] [erledigt: Track F (18f36eb) + Track C (bfb7bcf)] [BUG - Massimo beim echten Live-Test entdeckt] [Track F, vermutlich auch Track C] [hohe Prioritaet] — Erster erfolgreicher End-to-End-Test mit echtem web.de-Konto (nach IMAP-Aktivierung + CORS-Fix): Login, Ordnerliste, Header-Anzeige (E-Mail-Adresse statt "Driftmail" -- funktioniert korrekt), "Neuer Ordner"-Feld -- alles bestaetigt funktionsfaehig.

**Aber:** Es gibt AN KEINER STELLE der Web-Oberflaeche einen sichtbaren "Neue Nachricht"/"Verfassen"-Button oder Aehnliches, um eine komplett NEUE Mail zu schreiben (nicht als Antwort auf eine bestehende). Screenshot des leeren Eingangs zeigt nur die Ordnerliste + "Neuer Ordner"-Feld, keinen Compose-Einstieg.

Wichtig, Abgrenzung zum frueheren Auftrag "Antworten ohne KI-Zwang" (WEB_INBOX.md 10.09., laut SYNC.md erledigt): das betraf nur den Antworten-Flow auf eine bestehende Mail. Der GRUNDSAETZLICHE Weg, ueberhaupt eine neue, eigenstaendige Mail zu verfassen (kein Bezug zu einer existierenden Nachricht), scheint komplett zu fehlen -- das ist eine andere, grundlegendere Luecke.

Bitte pruefen: existiert ein POST /messages/send-faehiger Compose-Screen fuer NEUE Mails (mit leerem To-Feld, nicht vorausgefuellt aus einer Antwort) ueberhaupt im Code, nur ohne sichtbaren Einstiegspunkt in der UI (dann reicht ein UI-Fix: z.B. Button oben in der Sidebar oder Ordneransicht)? Oder fehlt der ganze Neu-Verfassen-Flow strukturell? Bitte auch Track C (iOS) auf dieselbe Luecke pruefen.

Hohe Prioritaet -- ohne diesen Einstiegspunkt ist driftmail aktuell nur zum Lesen/Antworten nutzbar, nicht um selbst aktiv eine neue Konversation zu beginnen. Bitte vor den 5 Wettbewerbs-Features und dem Malware-Scan-Auftrag einordnen, da dies eine Kernfunktion betrifft, nicht eine Erweiterung.

**Track F (Web) erledigt (18f36eb):** "Neue Nachricht"-Button oben in der Sidebar, oeffnet einen echten Compose-Dialog (`ComposeModal.tsx`, siehe web/README.md) mit leerem To-Feld -- der zugrundeliegende `POST /messages/send`-Weg existierte im Code bereits (`accountId`+`to`+`bodyText` ohne `inReplyToMessageId`), es fehlte nur der UI-Einstiegspunkt, wie hier vermutet. Track C (iOS) weiterhin offen.


[2026-09-21] [erledigt: Punkt 1 (b2ac424+c6dea5f), Punkt 2 Backend (b6add62) + Web-UI (987ab9c) + iOS-UI (74e75d4)] [SEHR WICHTIGE LUECKE - HOECHSTE PRIORITAET] [contracts + Track A + Track C/F] — Massimo hat eine Testmail an sein web.de-Testkonto geschickt und erwartet, dass sie automatisch ankommt. Geprueft: es gibt AKTUELL NUR EINEN EINMALIGEN SYNC beim ersten Verbinden eines Kontos ("Initialer Sync"), danach passiert nichts mehr automatisch -- keine Polling-Schleife, kein Cron, kein IMAP IDLE (Volltextsuche in SYNC.md: keine Treffer fuer Polling/Sync-Intervall/Cron/periodisch). Ausserdem bestaetigt: es gibt bisher KEINEN Account-Switcher in der UI (bewusst zurueckgestellt bei einem frueheren Auftrag), obwohl mail_accounts schon mehrere Konten pro User im Schema erlaubt.

Massimo braucht BEIDES, mit hoechster Prioritaet vor allen anderen offenen Punkten (noch vor dem fehlenden Compose-Button von eben):

**1) Automatischer UND manueller Mail-Abruf:**
- Automatisch: Backend soll pro verbundenem Konto periodisch (z.B. alle 2-5 Minuten, Track A entscheidet sinnvollen Standardwert, gerne konfigurierbar) per IMAP nach neuen Nachrichten schauen und diese importieren -- gleiche Klassifikations-/Sicherheitspipeline wie beim initialen Sync durchlaufen lassen (Track-B-Analyse, Ordner-Zuordnung etc.), nicht nur roh speichern.
- Manuell: zusaetzlich ein "Jetzt aktualisieren"-Button/Pull-to-Refresh in der UI (Web + iOS), der einen sofortigen Sync fuer das/die aktuell verbundene(n) Konto(en) ausloest, ohne auf das naechste automatische Intervall zu warten.
- Technischer Ansatz offen fuer Track A: klassisches Polling ist der pragmatischere erste Schritt (IMAP-Verbindung in Intervallen neu aufbauen und pruefen), IMAP IDLE (Server haelt Verbindung offen, meldet neue Mail sofort) waere die bessere, aber aufwendigere Loesung fuer spaeter -- fuer jetzt reicht Polling, Architektur aber bitte so anlegen, dass IDLE spaeter nachgezogen werden kann ohne alles umzubauen.

**2) Echte Mehrfach-Konten-Unterstuetzung in der UI:**
Viele User haben mehrere Mail-Konten (privat, geschaeftlich, verschiedene Anbieter). mail_accounts erlaubt das laut Schema schon, aber es fehlt der tatsaechliche Weg in der UI:
- Moeglichkeit, ein WEITERES Konto hinzuzufuegen, nachdem man schon eines verbunden hat (nicht nur beim allerersten Onboarding) -- z.B. "Konto hinzufuegen" in den Einstellungen.
- Account-Switcher, um zwischen den verbundenen Konten zu wechseln (siehe fruehere Notiz "Header zeigt E-Mail-Adresse", dort war das schon als natuerlicher Ort dafuer vorgeschlagen, aber bewusst nicht Teil dieses Auftrags -- JETZT nachholen).
- Jedes Konto braucht seinen eigenen automatischen Sync-Zyklus (siehe Punkt 1) -- unabhaengig voneinander, ein langsames/fehlerhaftes Konto darf die anderen nicht blockieren.
- Offene Frage an Track A/C/F: getrennte Ordneransichten pro Konto, oder ein vereinheitlichter Eingang ueber alle Konten hinweg (mit Kennzeichnung, von welchem Konto eine Mail kommt)? Bitte kurz in SYNC.md Vorschlag machen, bevor gebaut wird -- das ist eine groessere UX-Entscheidung, die Massimo/Web idealerweise noch bestaetigt.

Kein Contract-Bruch bei mail_accounts selbst (existiert schon fuer genau diesen Zweck), aber POST /accounts/GET /accounts und der Sync-Mechanismus muessen fuer "mehrere aktive Konten gleichzeitig" statt "genau ein Konto" gedacht werden, falls das bisher implizit nur fuer eins ausgelegt war -- bitte pruefen und in SYNC.md dokumentieren.

HOECHSTE PRIORITAET -- bitte vor allen anderen aktuell offenen Punkten (fehlender Compose-Button, 5 Wettbewerbs-Features, Malware-Scan) einordnen, da dies die Kernfunktion "wird ueberhaupt neue Mail angezeigt, von wie vielen Konten" direkt betrifft.


[2026-09-21] [erledigt: Track F (18f36eb) + Track C (bfb7bcf)] [ERGAENZUNG - verbindet die zwei Auftraege von eben] [Track C/F] — Massimo: wenn mehrere Konten empfangen koennen, muss das Verfassen-Fenster (der fehlende Compose-Button, siehe Eintrag "BUG - Massimo beim echten Live-Test entdeckt" von eben) auch eine ABSENDER-AUSWAHL haben, sobald mehr als ein Konto verbunden ist -- nicht einfach implizit vom ersten/aktuell aktiven Konto senden.

Konkret: Compose-Screen bekommt ein "Von"-Feld/Dropdown mit allen verbundenen Konten (nur sichtbar/relevant, wenn mehr als eins existiert -- bei genau einem Konto kein unnoetiges UI-Element). Server-seitig muss POST /messages/send dann wissen, ueber WELCHES Konto/welchen Provider tatsaechlich versendet wird (relevant fuer OAuth-Token-Auswahl bei Gmail vs. IMAP-SMTP-Zugangsdaten bei anderen Kontenarten) -- pruefen, ob der Endpunkt das schon unterstuetzt oder ob ein accountId-Feld noch ergaenzt werden muss.

**Track F (Web) erledigt (18f36eb):** `POST /messages/send` unterstuetzte `accountId` bereits (kein Backend-Change noetig). `ComposeModal.tsx` zeigt ein "Von"-Dropdown, nur sichtbar bei mehr als einem verbundenen Konto. Track C (iOS) weiterhin offen.

Bitte beide Auftraege (fehlender Compose-Button + Mehrfach-Konten-Unterstuetzung) zusammen einplanen, nicht den Compose-Screen zuerst ohne Absender-Auswahl bauen und spaeter nochmal anfassen muessen.


[2026-09-21] [erledigt: Track F alle drei Punkte (18f36eb), Track C (iOS) alle drei Punkte (bfb7bcf)] [DREI WEITERE GRUNDFUNKTIONEN - systematisch gegengeprueft] [contracts + Track A + Track C/F] [gleiche hohe Prioritaet wie Sync/Mehrfach-Konten/Compose von eben] — Nach den drei vorherigen Funden wurde die komplette Grundfunktions-Liste eines Mail-Clients gegen SYNC.md geprueft. Drei weitere echte Luecken bestaetigt (Volltextsuche, keine Fehltreffer):

**1) Weiterleiten (Forward):** [Track F erledigt: 18f36eb, Track C erledigt: bfb7bcf]
Bestehender Treffer fuer "Weiterleitung" war ein Fehltreffer (bezog sich auf OAuth-Redirect, nicht auf E-Mail-Weiterleiten). Es gibt aktuell KEINE Moeglichkeit, eine empfangene Mail an eine andere Adresse weiterzuleiten. Vorschlag: neuer Endpunkt oder Erweiterung von POST /messages/send um einen forwardOf-Bezug (analog zu inReplyToMessageId bei Antworten), Compose-Screen vorausgefuellt mit Betreff "Fwd: ..." und zitiertem Originaltext, inkl. Original-Anhaenge optional mit weiterleitbar.
Kein forwardOf-Bezug noetig: Weiterleiten ist technisch eine normale neue Mail ueber POST /messages/send (accountId statt inReplyToMessageId) mit vorausgefuelltem "Fwd:"-Betreff + zitiertem Originaltext -- kein Contract-Change. "Weiterleiten"-Button in MessageDetailPane.tsx, oeffnet denselben ComposeModal wie "Antworten"/"Neue Nachricht". Original-Anhaenge bewusst NICHT automatisch mitgenommen (im Auftrag als "optional" markiert) -- User kann aber neue Anhaenge ganz normal hinzufuegen.

**2) Suche ueber Mails:** [Backend erledigt: 9c3a3ec, Track F UI erledigt: 18f36eb, Track C erledigt: bfb7bcf]
Kein einziger Treffer fuer eine Suchfunktion. User muss aktuell jede Mail einzeln durchklicken, keine Moeglichkeit nach Absender/Betreff/Inhalt zu suchen. Vorschlag: GET /messages/search?q=... (oder Query-Parameter am bestehenden Nachrichten-Listen-Endpunkt), mindestens Betreff+Absender durchsuchbar, Volltextsuche im Nachrichtentext als Ausbaustufe falls einfach machbar.
GET /messages akzeptiert jetzt q (Substring-Suche ueber subject/from_address/from_display_name/body_text). Suchfeld ueber der Nachrichtenliste (kontoweit, ersetzt bei nicht-leerem Suchbegriff die Ordneransicht). iOS: `.searchable()` auf der Ordnerliste (`FolderListView.swift`, kontoweit, 250ms entprellt), gleiches Prinzip.

**3) CC/BCC beim Verfassen:** [Backend erledigt: 9c3a3ec, Track F UI erledigt: 18f36eb, Track C erledigt: bfb7bcf]
Kein einziger Treffer fuer cc/bcc im gesamten Code/Contract. Aktuell vermutlich nur ein einzelnes "An"-Feld beim Senden moeglich. Vorschlag: POST /messages/send und der Compose-Screen (der ja laut Auftrag von eben ohnehin neu/erweitert gebaut wird) um cc- und bcc-Empfaengerlisten ergaenzen -- bietet sich an, direkt zusammen mit dem Compose-Screen und der Absender-Auswahl bei Mehrfach-Konten zu bauen, nicht als getrennter Schritt.
POST /messages/send akzeptiert jetzt bcc (analog zu cc, bereits vorhanden). ComposeModal.tsx zeigt CC/BCC hinter einem "CC/BCC hinzufuegen"-Link eingeklappt (Superhuman-Prinzip: nur zeigen, was gebraucht wird). iOS: dieselben zwei eingeklappten Felder in `ComposeView.swift`.

**Uebergabe an Track C (iOS): erledigt (bfb7bcf).** Neuer gemeinsamer `ComposeView.swift` fuer neue Mail/Antworten/Weiterleiten (ersetzt das bisherige inline-Antwortfeld in `MessageDetailView.swift`), Sender-Auswahl bei mehreren Konten, CC/BCC eingeklappt, Suche kontoweit. `APIClient.sendMessage()` musste dafuer erst um `accountId`/`cc`/`bcc` erweitert werden (der iOS-Client unterstuetzte vorher GAR KEINE neue, nicht-antwortende Mail). Details, inkl. einer ehrlich benannten Verifikations-Grenze (authentifizierte Screens liessen sich mangels echter Test-Mailbox nicht interaktiv durchklicken, siehe dort), in `ios/README.md` Abschnitt "Compose-Screen (neue Mail, Antworten, Weiterleiten, Suche, CC/BCC)".

**Kontext, ehrlich benannt:** diese sechs Luecken zusammen (automatischer Abruf, Mehrfach-Konten, Compose-Button, Weiterleiten, Suche, CC/BCC) haetten von Anfang an als explizite Grundfunktions-Checkliste behandelt werden muessen, nicht erst durch Massimos eigenes Live-Testen auffallen. Bitte alle sechs als zusammenhaengenden Block VOR den 5 Wettbewerbs-Features und dem Malware-Scan-Auftrag einordnen -- das sind keine "nice-to-haves", sondern fehlende Grundfunktionen eines Mail-Clients.


[2026-09-21] [erledigt: Track C (b32eedf) + Track F (8184b4f)] [DESIGN-RICHTUNG - von Massimo bestaetigt] [Track C/F, Design/Polish-Ebene] — Massimo hat nach Recherche zu den bestbewerteten Mail-Clients (Superhuman durchgehend als Testsieger in mehreren unabhaengigen Rankings 2026) eine Design-Richtung bestaetigt, per Mockup gezeigt und freigegeben ("so ist schon gut, Farben koennen wir aendern" -- Struktur bestaetigt, Farbwerte bleiben flexibel/Detailarbeit fuer spaeter).

**Bestaetigte Struktur-Prinzipien (Referenz: Superhuman-Stil):**
1. Sehr schmale, reduzierte Sidebar -- nur Ordnernamen mit kleinem Icon, kein visuelles Uebergewicht.
2. Kompakte Listenzeilen: Absender (fett wenn ungelesen), einzeiliger Vorschautext, Zeitstempel rechtsbuendig, dezenter Ungelesen-Punkt links -- keine ueberladenen Karten/Schatten pro Zeile, duenne Trennlinien reichen.
3. Genau EIN Akzent pro Ansicht -- die bestehenden Sicherheits-Badges/Warnhinweise (Neuer Absender, Anzeigename-Spoofing, IBAN-Wechsel etc., siehe fruehere Auftraege) sind die einzigen farbig hervorgehobenen Elemente, alles andere bleibt neutral/grau, damit Warnungen wirklich auffallen statt in einer bunten Oberflaeche unterzugehen.
4. "Neue Nachricht"-Button klar sichtbar oben in der Listenansicht (behebt gleichzeitig den fruehren Compose-Button-Fund).
5. Tastenkuerzel/Befehlspalette (z.B. Cmd/Ctrl+K) als Ergaenzung zu Buttons, nicht als Ersatz -- Hinweis dezent in der Sidebar, kein Muss fuer den ersten Entwurf, aber als Zielrichtung im Hinterkopf behalten.

**Kein Contract-Change**, reine visuelle/Layout-Richtlinie fuer design-tokens.json-Anwendung und Komponenten-Struktur in Web/iOS. Bitte NACH den aktuell hoechst-priorisierten Grundfunktions-Luecken (Sync/Mehrfach-Konten/Compose/Weiterleiten/Suche/CC-BCC) und vor den 5 Wettbewerbs-Features einordnen -- das ist die "wenn wir eh am UI arbeiten, gleich in dieser Optik" Ebene, kein eigener grosser Sprint noetig.


[2026-09-21] [erledigt: Backend 3454bc1, design-tokens.json accentThemes, Web-UI 23a6ce5, iOS-UI siehe SYNC.md -- war schon Teil des "Einstellungsbereich"-Auftrags umgesetzt, hier nur nachtraeglich als erledigt markiert] [ERGAENZUNG zur Design-Richtung - User waehlt Akzentfarbe] [contracts/design-tokens.json + Track A + Track C/F] — Massimo will sich nicht um Farben kuemmern, hat mich gebeten, kreativ fuenf Optionen selbst festzulegen, die der Endnutzer dann auswaehlen kann. Funktionen/Bedienbarkeit/Sicherheit bleiben wichtiger als Optik -- das ist eine kleine Ergaenzung, kein neuer grosser Auftrag.

**WICHTIGE EINSCHRAENKUNG, nicht verhandelbar:** Die Sicherheits-Farbrollen (danger/warning fuer Quarantaene, Phishing-Warnungen, die neuen Sicherheits-Badges etc.) bleiben FEST und sind NICHT Teil der Nutzer-Auswahl -- nur die neutrale Akzentfarbe (Buttons, Links, ausgewaehlte Zeile, aktiver Ordner) ist waehlbar. Sonst verliert das bestehende Warnsystem seine Eindeutigkeit.

**Fuenf vordefinierte Akzent-Themes (von Web/Massimo festgelegt, keine weitere Rueckfrage noetig):**
1. "Teal" -- #1D9E75 (bereits im bestehenden Design-System als c-teal 400 vorhanden, siehe fruehere Logo-Arbeit)
2. "Ocean Blue" -- #378ADD (c-blue 400)
3. "Violett" -- #7F77DD (c-purple 400)
4. "Koralle" -- #D85A30 (c-coral 400) -- bewusst gewaehlt, klar unterscheidbar von den Warnfarben Rot/Gelb/Orange, um Verwechslung mit Sicherheitshinweisen zu vermeiden
5. "Ocean-Verlauf" -- sanfter Gradient von Teal (#1D9E75) zu Blau (#378ADD), 135 Grad, fuer Nutzer die einen Farbverlauf statt Vollton wollen

**Umsetzung:**
- Neues Feld user_theme_preference (oder aehnlich) pro User, Auswahl aus den obigen 5 Werten, Default "Teal".
- Einstellungsbildschirm (Web + iOS): einfache Farbkachel-Auswahl (5 Kacheln, aktuelle Auswahl markiert), kein Farbwaehler/Custom-Hex-Eingabe -- bewusst nur die 5 Optionen, keine unbegrenzte Auswahl.
- design-tokens.json um die 5 Presets ergaenzen, CSS-Variable fuer Akzentfarbe (z.B. --accent-user) wird je nach Auswahl gesetzt, alle bestehenden Akzent-Verwendungen (Buttons, aktiver Ordner, Links) darauf umstellen statt fest verdrahteter Farbe.

Kein Contract-Bruch (additive Erweiterung von design-tokens.json + ein neues User-Praeferenz-Feld). Bitte zusammen mit der Design-Richtung von eben einordnen (nach den Grundfunktions-Luecken, vor den 5 Wettbewerbs-Features) -- kleine Ergaenzung, kein Blocker.


[2026-09-21] [offen] [JETZT LOSBAUEN - alles entschieden, kein Warten mehr] [alle Tracks] — Massimo: bitte JETZT direkt anfangen, ohne weitere Rueckfrage. Alles Noetige ist entschieden und dokumentiert. Feste Reihenfolge:

1. Grundfunktionen (hoechste Prioritaet, siehe Eintraege von heute): automatischer+manueller Mail-Abruf, echte Mehrfach-Konten-Unterstuetzung, Compose-Button mit Absender-Auswahl, Weiterleiten, Suche, CC/BCC.
2. Waehrend/danach die UI dieser Funktionen direkt im neuen Design bauen (Superhuman-Referenz, siehe "DESIGN-RICHTUNG" Eintrag): schmale Sidebar, kompakte Listenzeilen, EIN Akzent fuer Sicherheits-Badges, sichtbarer Neue-Nachricht-Button, plus die 5 waehlbaren Akzentfarben-Themes.
3. Danach die 5 Wettbewerbs-Features (Tracking-Pixel, Undo-Send, Darkweb-Monitoring, Schedule-Send, Snooze) und der Malware-Scan-Auftrag (ClamAV, beide Richtungen).

Keine weitere Design- oder Prioritaets-Rueckfrage mehr noetig -- alle offenen Entscheidungen sind getroffen. Bitte durcharbeiten und wie gewohnt in SYNC.md/TERMINAL_INBOX.md dokumentieren.


[2026-09-21] [UEBERHOLT, siehe korrigierte Version + Backend-Umsetzung in TERMINAL_INBOX.md 21.09. "KORREKTUR" (erledigt: efca792), Massimo hat direkt an Claude Code korrigiert: kein driftmail-finanzierter Cloud-Key, Geraete-eigene KI ist primaer] [ECHTE KI-ANBINDUNG - letzter Punkt der urspruenglichen Prioritaetenliste] [contracts/ai-adapter-interface.ts + Track A/D/E] [nach den aktuell laufenden Grundfunktionen] — Massimo: jetzt einreihen. Aktuell laufen extractContract/summarize/draftReply nur regelbasiert (Mustererkennung, Konfidenz bis max. 0.95, Code markiert mit "AI EXTRACTION HOOK"-Kommentaren) -- keine echte KI-Anbindung, kein API-Key konfiguriert.

**Anbieter-Entscheidung:** Anthropic-API (Claude) als Cloud-Fallback -- passt organisch, da driftmail ueber Claude entwickelt wird, keine weitere Anbieter-Recherche noetig. API-Key server-seitig per Umgebungsvariable (ANTHROPIC_API_KEY, .env.example ergaenzen), NICHT pro User -- User bringt keinen eigenen Key mit, driftmail traegt die Kosten.

**On-Device-Anteil:** Die bestehende On-Device/Cloud-Fallback-Philosophie (ai-adapter-interface.ts, LOW_CONFIDENCE_THRESHOLD=0.6) bleibt bestehen. Fuer iOS pruefen, ob Apples On-Device-Modell-Framework (Apple Intelligence / Foundation Models, je nach iOS-Version verfuegbar) fuer einfache Faelle nutzbar ist -- falls das zu aufwendig/neu ist fuer diesen Schritt, ist ein dokumentierter Verzicht darauf in Ordnung (dann laeuft vorerst alles ueber den Cloud-Fallback, echte On-Device-Integration als spaetere Ausbaustufe). Web hat ohnehin keine On-Device-Option, laeuft immer ueber Cloud-Fallback.

**Wichtig -- Consent nicht vergessen:** Es existiert laut frueherer Notiz schon ein Onboarding-Mockup mit einem "KI-Capability-Check/Zustimmung"-Schritt (Willkommen -> Mail-Konto verbinden -> KI-Zustimmung -> Signatur -> Fertig). Bitte sicherstellen, dass dieser Zustimmungsschritt tatsaechlich VOR dem ersten echten Versand von Mail-Inhalten an die Cloud-API greift -- kein Mail-Inhalt geht an Anthropic, ohne dass der User dem im Onboarding zugestimmt hat. Falls dieser Schritt in der Web/iOS-UI noch nicht real verdrahtet ist (nur Mockup), bitte das im gleichen Zug nachziehen.

**Umfang der drei Funktionen:**
1. extractContract: Mail-Text an Claude, Extraktion von Vertragsdetails/Terminen als strukturierte Antwort (JSON-Schema vorgeben), ersetzt die regelbasierte Erkennung fuer Faelle unterhalb der 0.95-Konfidenzschwelle.
2. summarize: kurze Zusammenfassung des Mail-Inhalts fuer die "Inhalt"-Anzeige (siehe fruehere Label-Umbenennung).
3. draftReply: KI-Entwurf fuer Antworten, bleibt bewusst NUR Vorschlag (bestehendes Prinzip: Compose-Text vollstaendig editierbar, kein Auto-Send).

Kein Contract-Bruch (ai-adapter-interface.ts sieht genau diese Funktionen bereits vor, nur die Implementierung dahinter wird jetzt real statt Mock). Bitte nach den aktuell laufenden Grundfunktionen (Sync/Mehrfach-Konten/iOS-Nachzug) einordnen, Details/Grenzen wie gewohnt in SYNC.md dokumentieren.


[2026-09-21] [erledigt: 96d9472] [KLEINE LABEL-AENDERUNG] [Track C/F] — Massimo: das Label "Inhalt" (KI-generierte Zusammenfassung des Mail-Inhalts, siehe fruehere Umbenennung von "Was wollen die von mir?" -> "Inhalt", WEB_INBOX.md 09.09.) soll umbenannt werden zu "Check Mail". Ausdruecklich von Massimo so entschieden (Alternative "Zusammenfassung" wurde vorgeschlagen und von ihm bewusst abgelehnt). Bitte ueberall dort aendern, wo "Inhalt" fuer dieses Feature in der UI angezeigt wird (Web + iOS, beide hatten die frueher Umbenennung uebernommen). Reine Text-Aenderung, kein Contract-Bruch, kein Blocker.


[2026-09-21] [teilweise erledigt: Backend-Grundlage (3454bc1); Punkt 1 iOS-UI (siehe SYNC.md) fertig; Punkt 1 Web-UI fertig (23a6ce5); Punkt 2 (Info-Seite) laut Massimo bereits bei Web-Claude in Arbeit] [NEUER AUFTRAG - Einstellungsbereich + Info-Seite] [Track C/F] [gehoert zum driftmail-Repo] — Massimo: es fehlt ein richtiger, gebuendelter Einstellungsbereich. Bisher sind mehrere Einstellungs-Bausteine einzeln entstanden (AiSettingsView/KI-Einstellungen, Akzentfarben-Theme, App-Sperre-Toggle), aber nie an einem Ort zusammengefuehrt. Ausserdem soll es eine oeffentliche Info-Seite/Kachel auf driftware.online geben (Teil desselben Repos).

**1) In-App-Einstellungsbereich (Web + iOS), buendelt was schon existiert PLUS Neues:**
- Konten-Verwaltung: Liste der verbundenen Konten, "Weiteres Konto hinzufuegen" (siehe Mehrfach-Konten-Auftrag von heute), einzelnes Konto entfernen.
- Ansicht: die bereits gebaute Akzentfarben-Auswahl (5 Themes) hier einhaengen, falls noch nicht geschehen.
- Sicherheit: App-Sperre-Toggle (existiert schon), KI-Einstellungen/BYOK (existiert schon als AiSettingsView), PLUS neu: kurze, verstaendliche Uebersicht der aktiven Sicherheits-Features (Whitelist, Vorschussbetrug-Filter, die 6 neuen Erkennungssignale, Malware-Scan sobald fertig) -- keine technischen Details, sondern in einfachen Worten, was driftmail fuer den User im Hintergrund tut. Baut auf dem frueher zurueckgestellten "Darkweb-Monitoring o.ae." Gedanken auf, aber als einfache Text-Uebersicht, kein neues Feature.
- Ein Link zu einer Anleitung, wie man driftmail installiert/einrichtet (zeigt auf die Info-Seite von Punkt 2 oder eine eigene Kurzanleitung).

**2) Oeffentliche Info-Seite/Kachel auf driftware.online (Teil des driftmail-Repos, vermutlich im web/-Ordner als separate oeffentliche Route/Seite, nicht hinter Login):**
- Kurze Vorstellung von driftmail (was es ist, fuer wen).
- Installationsanleitung (wie verbindet man ein Mail-Konto, welche Anbieter werden unterstuetzt).
- Sicherheitshinweise/Vertrauensbildung (welche Sicherheitsfunktionen driftmail bietet, in einfachen Worten -- Whitelist, Betrugserkennung, Malware-Scan, On-Device-KI statt Cloud-Standard, etc.).
- Bitte grobe Struktur/Umfang selbst vorschlagen und in SYNC.md kurz skizzieren, bevor viel Zeit reingesteckt wird -- Massimo will das noch nicht bis ins Detail vorgeben ("alles das was die anderen auch haben" als grobe Richtung), aber grobe Gliederung vorher kurz zeigen.

Kein Contract-Bruch, reine UI-/Content-Arbeit. Bitte NACH dem laufenden Testen (Web/iOS mit dem echten Konto) einordnen, kein Blocker fuer das aktuelle Testen selbst.


[2026-09-21] [erledigt: 96d9472] [KLEINE VERKNUEPFUNG - Neuer-Absender-Badge mit Whitelist verbinden] [Track C/F] — Massimo: wenn eine Mail das "Neuer Absender"-Kennzeichen zeigt (isNewSender, siehe fruehere Sicherheits-Ergaenzung), soll der User direkt an dieser Stelle die Moeglichkeit haben, den Absender zur Whitelist (trusted_senders, POST /trusted-senders existiert bereits) hinzuzufuegen -- z.B. ein kleiner Button/Link direkt neben oder unter dem Badge ("Absender vertrauen"), nicht erst ueber die Einstellungen suchen muessen. Nach Klick verschwindet das Neuer-Absender-Kennzeichen fuer kuenftige Mails von dieser Adresse (Whitelist greift wie bereits spezifiziert). Kein Contract-Bruch (Endpunkt existiert), reine UI-Verknuepfung zweier bereits bestehender Features. Kein Blocker, kleine Ergaenzung.


[2026-09-21] [erledigt: Backend-Grundlage (571ee2c); Punkt 3 + 5 brauchten keine Aenderung (5 bereits vollstaendig fertig, siehe backend/README.md); iOS-UI fuer 1/2/3/4 fertig (cbfbeec, siehe ios/README.md); Web-UI fuer 1/2/3/4 fertig (1ff9c5e, siehe web/README.md)] [FUENF NEUE KOMFORT-FEATURES] [contracts + Track A + Track C/F] — Massimo hat fuenf weitere Vorschlaege bestaetigt, alle sollen umgesetzt werden. Vorab geklaert: dauerhafte Anmeldung ist bereits geloest (iOS Keychain, Web localStorage), kein Bug.

**1) Unbekannte Absender standardmaessig kritisch behandeln, per Einstellung aenderbar (Track A + C/F):**
Mails von Absendern, die NICHT auf der Whitelist stehen (isNewSender=true), sollen visuell staerker als "kritisch zu pruefen" markiert werden (z.B. deutlicheres Badge/Rahmen, nicht nur der bestehende dezente "Neuer Absender"-Hinweis), bis der User ueber den neuen "Absender vertrauen"-Button (siehe frueherer Auftrag) bestaetigt. Verhalten soll in den Einstellungen (siehe neuer Einstellungsbereich-Auftrag) umschaltbar sein -- z.B. "Unbekannte Absender streng behandeln" an/aus, Default AN.

**2) Kontakt-Autovervollstaendigung beim Verfassen (Track A + C/F):**
Im An/CC/BCC-Feld des Compose-Screens: waehrend der User tippt, Vorschlaege aus bereits bekannten Absendern/Empfaengern (aus messages-Historie ableitbar, kein neues Kontakte-Feature noetig fuer v1 -- einfache Ableitung aus bisherigen From/To-Adressen des Users reicht).

**3) Entwuerfe automatisch speichern waehrend des Tippens (Track A + C/F):**
Compose-Screen speichert periodisch (z.B. alle paar Sekunden oder bei Fokus-Verlust) automatisch als Entwurf in die bestehende drafts-Tabelle, ohne dass der User explizit "Speichern" klicken muss -- nichts geht bei Absturz/versehentlichem Schliessen verloren.

**4) Threaded Ansicht (Track A + C/F):**
Mails, die zum selben Gespraech gehoeren (ueber in_reply_to_message_id-Kette, wird ja bereits fuer den IBAN-Wechsel-Check verwendet), sollen in der Listenansicht gruppiert/zusammengefasst dargestellt werden statt als voellig getrennte Eintraege -- z.B. nur die neueste Nachricht sichtbar mit Anzahl "+3 aeltere", aufklappbar.

**5) Manueller Abmelden-Button auf einzelnen Mails (Track A + C/F):**
Zusaetzlich zur bestehenden automatischen Spam-Abmeldung: ein sichtbarer "Abmelden"-Button auf JEDER Mail, die einen List-Unsubscribe-Header hat (RFC-8058), unabhaengig von der Spam-Klassifikation -- z.B. auch fuer legitime Newsletter, die der User einfach nicht mehr will. Nutzt denselben bestehenden Unsubscribe-Mechanismus, nur als manuell auffindbare UI-Aktion statt nur automatisch bei erkanntem Spam.

Kein Contract-Bruch bei 1/2/5 (additive UI/Ableitung aus bestehenden Daten). Bei 3/4 bitte kurz Umfang/Grenzen in SYNC.md dokumentieren. Bitte nach dem aktuell laufenden Testen und dem Einstellungsbereich-Auftrag einordnen, kein Blocker.


[2026-09-21] [erledigt: Backend fc4e287; iOS cf20a24; Web 9a9714b -- alle drei Tracks fertig] [NEUER AUFTRAG - Abwesenheitsassistent] [contracts + Track A + Track C/F] — Massimo: Abwesenheitsmelder einbauen, Vorbild Gmail/Outlook, aber mit einem echten Sicherheitsvorteil, den andere Clients nicht haben.

**Standard-Umfang (wie Gmail "Vacation Responder"/Outlook "Automatische Antworten"):**
- Zeitraum: Start-Datum Pflicht, End-Datum optional (automatisches Abschalten).
- Betreff + Nachrichtentext, freier Text.
- Bestehende User-Signatur (signatures-Tabelle) automatisch anhaengen.
- Pro Absender maximal eine Antwort alle X Tage (Default 4, wie Gmail) -- verhindert Antwort-Schleifen bei wiederholten Mails derselben Person.
- Keine Antwort an Mailinglisten (List-Unsubscribe-Header vorhanden = vermutlich Newsletter/Liste, nicht persoenliche Mail).
- Banner/Hinweis in der UI waehrend aktiv, mit direktem "Jetzt beenden"-Schnellzugriff.

**Sicherheits-Verbesserung ueber den Standard hinaus (Massimos Vorschlag):**
KEINE automatische Antwort an Absender, die als spam/phishing/advance_fee_scam klassifiziert wurden ODER bereits in Quarantaene liegen -- verhindert, dass Betrueger per automatischer Abwesenheitsantwort erfahren, dass der User gerade nicht erreichbar ist (bekanntes Einfallstor fuer Social-Engineering-Trickbetrug waehrend der Abwesenheit). Andere Mail-Clients haben diese Einschraenkung nicht.

**Technischer Ansatz:**
- Neue Tabelle oder Erweiterung der bestehenden user_ai_preference/Settings-Struktur: absence_responder (user_id, active, start_date, end_date, subject, body, last_sent_at pro Absender -- z.B. eigene kleine Tabelle absence_responder_log fuer die Pro-Absender-Rate-Begrenzung).
- Bestehende Scheduler-Infrastruktur (contracts-logic/src/scheduler.ts, aktuell fuer Reminder) als Vorbild/evtl. wiederverwendbar fuer die Start/End-Datum-Aktivierung.
- Beim Mail-Sync: wenn absence_responder aktiv UND Mail nicht spam/phishing/scam/quarantaene UND kein Mailinglisten-Header UND letzte Antwort an diesen Absender laenger als X Tage her -> automatische Antwort ueber den bestehenden Sende-Mechanismus ausloesen.
- Einstellungsbildschirm (Track C/F, gehoert in den neuen Einstellungsbereich-Auftrag von eben): Ein/Aus-Schalter, Datumsfelder, Betreff/Text-Eingabe.

Kein Contract-Bruch (additive neue Tabelle/Erweiterung). Bitte nach dem aktuellen Testen und den bereits laufenden Auftraegen (Einstellungsbereich, 5 Komfort-Features) einordnen, kein Blocker.


[2026-09-21] [erledigt: 63c1c0b] [LUECKE SCHLIESSEN - echter Abmelde-Aufruf] [backend/src/mail/listUnsubscribe.ts + Track A] [hohe Prioritaet, echte Funktionslücke] — Massimo hat nachgefragt, ob die automatische Spam-Abmeldung wirklich funktioniert. Geprueft: NEIN, nicht vollstaendig -- bisher wird der List-Unsubscribe-Header nur SYNTAKTISCH geparst und status='confirmed' gesetzt, es findet aber KEIN echter Netzwerk-Aufruf/Mail-Versand an die im Header angegebene Adresse statt (bewusst dokumentierte Grenze, jetzt nachzuziehen).

**Bitte den echten Aufruf ergaenzen:**
- Bei mailto:-URI im Header: eine leere (oder mit "unsubscribe" als Betreff) Mail an die angegebene Adresse ueber den bestehenden Sende-Mechanismus (POST /messages/send-Pfad intern nutzen, nicht ueber die UI) verschicken.
- Bei https:-URI im Header: falls der zusaetzliche List-Unsubscribe-Post-Header vorhanden ist (RFC 8058, "One-Click"), einen echten HTTP-POST an die URL schicken (List-Unsubscribe=One-Click als Body, wie im RFC vorgesehen). Falls kein Post-Header vorhanden: einfacher HTTP-GET-Aufruf als Fallback.
- status in unsubscribe_actions erst NACH tatsaechlicher Bestaetigung/erfolgreicher Anfrage auf 'confirmed' setzen, bei Fehler (Netzwerk-Timeout, 4xx/5xx-Antwort) auf einen Fehlerstatus (z.B. 'failed'), nicht blind auf 'confirmed' wie bisher.
- Fehler beim Abmelde-Aufruf duerfen den restlichen Mail-Sync NICHT blockieren/abbrechen (try/catch, weiterlaufen).

**Sicherheitsueberlegung, bitte kurz mitdenken:** der Aufruf geht an eine vom Absender selbst vorgegebene Adresse/URL -- das ist beim Unsubscribe-Mechanismus grundsaetzlich so gewollt (RFC-Standard), aber bitte trotzdem: kein Folgen von Redirects auf komplett andere Domains ohne Pruefung, sinnvolles Timeout (z.B. 5-10 Sekunden) damit ein hängender Server nicht den Sync blockiert.

Kein Contract-Bruch (unsubscribe_actions-Struktur bleibt, nur echte Ausfuehrung statt Attrappe). Bitte zeitnah einordnen, da das eine bereits als "fertig" kommunizierte Funktion tatsaechlich lueckenhaft macht.


[2026-09-21] [erledigt: Backend 1a82351 (Punkt 2 Nudge + Punkt 3 Vertraulicher Modus; Punkt 1 braucht keine Backend-Aenderung); Track C (iOS) UI fuer alle drei Punkte fertig (a8ff66f, siehe ios/README.md -- Punkt 3s automatischer Vorschlag bewusst NICHT gebaut, siehe dort); Track F (Web) UI fuer alle drei Punkte fertig, INKLUSIVE Punkt 3s automatischem Vorschlag ueber POST /messages/draft/phishing-check (5d9bbe0, siehe web/README.md "Nachtrag: Neun neue Features")] [DREI WEITERE FEATURES - Gmail-Recherche] [contracts + Track A + Track C/F] — Massimo hat nach Recherche zu Gmail-spezifischen Funktionen drei Uebernahmen bestaetigt.

**1) Vergessener-Anhang-Erkennung (Track A + C/F):**
Beim Klick auf "Senden": Compose-Text nach typischen Phrasen durchsuchen ("im Anhang", "siehe Anhang", "anbei", "attached", "see attachment" -- deutsch+englisch, einfache Keyword-Liste reicht, kein ML noetig). Falls ein Treffer vorliegt UND kein Anhang tatsaechlich beigefuegt wurde: kurzer Warnhinweis vor dem eigentlichen Versand ("Du hast 'im Anhang' geschrieben, aber keinen Anhang hinzugefuegt -- trotzdem senden?"), User kann bestaetigen und trotzdem senden. Reine Client-seitige Pruefung im Compose-Screen, kein Contract-Aenderung noetig.

**2) Nudge -- Erinnerung an unbeantwortete Mails (Track A + C/F):**
Erkennt Mails, die seit einigen Tagen (Default 3, wie Gmail) unbeantwortet im Eingang liegen (keine Antwort des Users im selben Thread), UND eigene gesendete Mails, auf die seit einigen Tagen keine Antwort kam. Zeigt dezenten Hinweis in der Liste ("Vor 3 Tagen erhalten, antworten?"). Aufbauend auf der bestehenden reminders-Infrastruktur (contracts-logic/src/scheduler.ts) -- pruefen ob direkt wiederverwendbar oder eigene kleine Ableitung noetig (aehnlich wie beim Abwesenheitsassistenten-Auftrag von eben, Scheduler als Vorbild). Ein/Aus-Schalter in den Einstellungen (Gmail macht das genauso, manche Nutzer empfinden es als aufdringlich).

**3) Vertraulicher Modus (Track A + B + C/F) -- besonders wichtig, passt zur Sicherheits-Identitaet von driftmail:**
Beim Verfassen: Option "Vertraulich senden" -- Ablaufdatum fuer die Nachricht setzbar, nach Ablauf nicht mehr lesbar/kein Inhalt mehr abrufbar. Zusaetzlich, ueber Gmail hinausgehend (Massimos Idee direkt aufgegriffen): AUTOMATISCHER VORSCHLAG "Vertraulich senden?" wenn beim Verfassen sensible Daten erkannt werden (bestehende IBAN-/Kreditkarten-Erkennung im Text, spaeter auch die OCR-Ausweis-Erkennung aus dem fruehen Auftrag) -- driftmail schlaegt den vertraulichen Modus proaktiv vor, statt dass der User selbst dran denken muss. Technisch: neue Spalte an messages (z.B. confidential_until TIMESTAMPTZ NULL), Nachrichtentext wird nach Ablauf serverseitig geloescht/durch Platzhalter ersetzt, kein Kopieren/Weiterleiten/Drucken-Schutz clientseitig erzwingbar (das ist bei JEDEM Anbieter, auch Gmail, nur eine Einschraenkung im eigenen Client, kein technischer Schutz gegen Screenshots o.ae. -- bitte das im Onboarding/Hinweistext ehrlich so kommunizieren, keine falschen Sicherheitsversprechen).

Bei 1/2 kein Contract-Bruch. Bei 3 kleine additive Spalten-Ergaenzung. Bitte nach den aktuell laufenden Auftraegen (Einstellungsbereich, Abwesenheitsassistent, echter Unsubscribe-Aufruf) einordnen.


[2026-09-21] [erledigt: Punkt 1 (Quishing/QR-Code-Scan) Commit 3f54fec; Punkt 2 (Klick-Zeit-Link-Pruefung) vollstaendig ueber "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies" geloest (Commit 6236f36 + Web/iOS-Pendants) -- der separate Client-Auto-Linkify-Schritt entfiel dadurch komplett, siehe dortiger Eintrag "entfaellt der vorher als separat noetig dokumentierte Auto-Linkify-Schritt"] [ZWEI ENTERPRISE-SICHERHEITS-FEATURES - echtes Alleinstellungsmerkmal] [contracts + Track A/B + Track C/F] [hohe Prioritaet, echtes Differenzierungsmerkmal] — Massimo hat nach Recherche zu Enterprise-Email-Security (Proofpoint, Mimecast, Microsoft Defender, Sophos) zwei Funktionen bestaetigt, die KEIN normaler Consumer-Mail-Client hat -- echtes Alleinstellungsmerkmal fuer driftmail.

**1) "Quishing"-Schutz -- Phishing-Links in QR-Codes/Bildern erkennen (Track A/B):**
Angreifer verstecken zunehmend bösartige Links in QR-Codes oder als Bild statt als klickbaren Text, um klassische Link-Erkennung zu umgehen (von Sophos 2026 explizit als wachsender Trend benannt). Baut auf der bereits geplanten OCR-Infrastruktur auf (siehe frueherer Auftrag zu Ausweis-/Kreditkarten-Fotos): OCR/QR-Code-Decoder auf eingebettete Bilder in Mails anwenden, gefundene URLs (aus decodiertem QR-Code-Inhalt ODER aus im Bild erkanntem Text) durch dieselbe bestehende Link-Sicherheitspruefung schicken wie normale Text-Links (Homoglyph-Erkennung, Anzeigename-Spoofing-Logik etc.). Technisch: QR-Code-Decoder-Bibliothek ergaenzen (Backend: z.B. jsQR oder aehnliches fuer Node, iOS: natives AVFoundation/Vision-Framework kann QR-Codes bereits decodieren -- pruefen ob wiederverwendbar mit dem bereits geplanten Vision-Framework-Einsatz fuer OCR).

**2) Klick-Zeit-Link-Pruefung statt nur einmaliger Pruefung bei Zustellung (Track A + C/F):**
Bisherige Link-Sicherheitspruefung (Homoglyph-Erkennung, Anzeigename-Spoofing) laeuft nur EINMAL beim Empfang der Mail. Enterprise-Loesungen pruefen zusaetzlich im Moment des tatsaechlichen Klicks erneut, da Angreifer eine zunaechst harmlose Zielseite registrieren, die erste Pruefung bestehen, und die Seite danach gegen eine bösartige tauschen ("verzoegerte Bewaffnung"/"time-of-click"-Angriff). Technisch: Links in Mails werden beim Anzeigen durch einen eigenen Redirect/Zwischenschritt umgeschrieben (aehnlich URL-Rewriting bei Proofpoint/Mimecast) -- beim Klick geht die Anfrage zuerst an einen eigenen Endpunkt (z.B. GET /link-check?url=...), der die Ziel-URL im Moment des Klicks nochmal prueft (Homoglyph/bekannte Phishing-Domain-Liste/etc.), und leitet erst danach zur echten Zielseite weiter. Bitte Umfang/Aufwand realistisch einschaetzen und in SYNC.md dokumentieren -- das ist die aufwendigere der beiden Ergaenzungen (neue Umleitungs-Infrastruktur), Punkt 1 ist einfacher (baut direkt auf Bestehendem auf).

Kein Contract-Bruch bei 1 (nutzt bestehende Mechanismen). Bei 2 ggf. neue kleine Route/Contract-Ergaenzung, bitte dokumentieren. Bitte nach den aktuell laufenden Auftraegen einordnen, aber mit hoher Prioritaet -- das ist ein echtes Alleinstellungsmerkmal gegenueber jedem anderen Consumer-Mail-Client.


[2026-09-21] [erledigt: driftware-Repo Commit 7e09291, live auf driftware.online/driftmail/] [INHALTS-PAKET fuer driftware.online-Kachel] [Track C/F, gehoert zum driftmail-Repo] [WICHTIG: Rechtstexte sind Entwuerfe, MUESSEN vor Live-Schaltung von einem Anwalt geprueft werden -- Massimo hat das bestaetigt zur Kenntnis genommen] — Vollstaendiger Inhalt fuer die oeffentliche driftware.online-Seite/Kachel (siehe frueherer Auftrag "Einstellungsbereich + Info-Seite"). Bitte 1:1 als Grundlage fuer die Seiten-Komponenten verwenden, sprachlich/laenge bei Bedarf anpassen.

---
## SEITE 1: Was driftmail kann (Produktvorstellung)

**Titel:** driftmail -- der Mail-Client, der mitdenkt

**Kurzbeschreibung:** driftmail ist ein sicherheitsfokussierter E-Mail-Client. Er sortiert, warnt und schuetzt automatisch im Hintergrund -- ohne dass Mail-Inhalte an fremde Cloud-Dienste geschickt werden muessen.

**Funktionsuebersicht (Stichpunkte, aus dem tatsaechlichen Funktionsumfang):**
- Automatische Erkennung von Spam, Phishing und klassischem Vorschussbetrug ("Prinz aus Nigeria"-Muster) -- eindeutiger Muell wird automatisch aussortiert, Grenzfaelle landen mit Warnhinweis in Quarantaene statt geloescht zu werden.
- Whitelist: du entscheidest selbst, welchen Absendern du vertraust.
- Warnung vor dem Versand sensibler Daten (IBAN, Kreditkartennummern, bald auch Fotos von Ausweisen/Kreditkarten).
- Erkennung von Anzeigename-Faelschung, abweichenden Antwort-Adressen und ploetzlichen IBAN-Wechseln in laufenden Gespraechen (klassischer Rechnungsbetrug).
- Kennzeichnung neuer, unbekannter Absender.
- Echter Virenscan fuer Anhaenge in beide Richtungen (Senden und Empfangen).
- Schutz vor Phishing-Links in QR-Codes und Bildern -- ein Schutz, den sonst nur teure Unternehmenssoftware bietet.
- KI-Funktionen (Zusammenfassung, Antwortvorschlaege, Vertragserkennung) laufen wo moeglich direkt auf deinem Geraet -- keine Kosten, keine Cloud-Uebertragung deiner Mail-Inhalte, es sei denn du bringst ausdruecklich einen eigenen KI-Zugang mit.
- Unterstuetzt Gmail, iCloud Mail, GMX, web.de und jeden anderen IMAP-Anbieter.
- Mehrere Mail-Konten gleichzeitig.
- App-Sperre per Face ID/Touch ID.

---
## SEITE 2: Bedienungsanleitung

**1. Konto verbinden:** Bei driftmail anmelden, Mail-Anbieter auswaehlen (Gmail, iCloud, GMX, web.de oder ein anderer IMAP-Anbieter). Bei Gmail: einmaliger Google-Anmelde-Bildschirm. Bei anderen Anbietern: E-Mail-Adresse plus ein App-spezifisches Passwort (nicht dein normales Passwort) -- eine kurze Anleitung dazu verlinken wir je nach Anbieter direkt im Formular.
**2. Erster Blick ins Postfach:** Deine Mails werden automatisch geladen und in die passenden Ordner sortiert (Eingang, Sonstiges, Quarantaene, Spam).
**3. Neue Mail schreiben:** Ueber den "Neue Nachricht"-Button. Bei mehreren Konten waehlst du den Absender aus.
**4. Auf eine Warnung reagieren:** Sieht eine Mail verdaechtig aus (z.B. "Neuer Absender" oder ein Sicherheits-Hinweis), lies die Erklaerung dazu -- du kannst den Absender jederzeit mit einem Klick als vertrauenswuerdig markieren.
**5. Einstellungen:** Weitere Konten hinzufuegen, Darstellung anpassen, Sicherheits-Features einsehen, App-Sperre aktivieren.

---
## SEITE 3: Haftungsausschluss (ENTWURF -- vor Verwendung anwaltlich pruefen)

driftmail ist ein in Entwicklung befindliches Produkt. Trotz sorgfaeltiger technischer Umsetzung der Sicherheitsfunktionen (Spam-/Phishing-Erkennung, Virenscan, Betrugserkennung) kann keine Garantie fuer die vollstaendige Erkennung aller Bedrohungen uebernommen werden. Die Nutzung erfolgt auf eigene Verantwortung. Fuer Schaeden, die durch nicht erkannte Schadsoftware, Phishing-Versuche oder Betrugsmails entstehen, wird -- soweit gesetzlich zulaessig -- keine Haftung uebernommen, ausser bei Vorsatz oder grober Fahrlaessigkeit. Fuer die Inhalte verlinkter externer Webseiten (z.B. in empfangenen E-Mails) wird keine Verantwortung uebernommen.

---
## SEITE 4: AGB (ENTWURF -- vor Verwendung anwaltlich pruefen)

**1. Geltungsbereich:** Diese Bedingungen gelten fuer die Nutzung von driftmail durch registrierte Nutzer.
**2. Leistungsbeschreibung:** driftmail stellt eine Software zur Verwaltung bestehender E-Mail-Konten (Gmail, IMAP-Anbieter) bereit, inklusive automatisierter Sicherheitsfunktionen. driftmail betreibt keinen eigenen Mailserver und versendet/empfaengt Mails ausschliesslich ueber die Infrastruktur des jeweiligen Anbieters (Gmail, GMX, web.de, etc.).
**3. Registrierung und Konto:** Der Nutzer ist fuer die Richtigkeit seiner Zugangsdaten sowie die Geheimhaltung seines driftmail-Zugangs verantwortlich.
**4. Verfuegbarkeit:** Eine bestimmte Verfuegbarkeit der Software wird nicht zugesichert, insbesondere nicht bei Ausfaellen der genutzten Drittanbieter (Mail-Provider).
**5. Nutzungsbeschraenkungen:** Die missbraeuchliche Nutzung von driftmail, insbesondere zum Versand von Spam, Schadsoftware oder betruegerischen Inhalten, ist untersagt.
**6. Kuendigung:** Der Nutzer kann sein Konto jederzeit loeschen. driftmail behaelt sich vor, Konten bei Missbrauch zu sperren.
**7. Aenderungen:** Diese AGB koennen bei wesentlichen Produktaenderungen angepasst werden, Nutzer werden hierueber informiert.

---
## SEITE 5: Datenschutzerklaerung (ENTWURF, DSGVO -- vor Verwendung anwaltlich pruefen)

**Verantwortlicher:** [Name/Anschrift/Kontakt von Massimo einfuegen -- siehe Impressum]

**Welche Daten werden verarbeitet:**
- Zugangsdaten zu verbundenen Mail-Konten (OAuth-Token bzw. IMAP-Zugangsdaten) -- verschluesselt gespeichert (AES-256-GCM), niemals im Klartext.
- Mail-Metadaten und -Inhalte, soweit fuer die Anzeige und die Sicherheitsfunktionen (Spam-/Phishing-Erkennung) notwendig -- Verarbeitung primaer auf dem Server des Nutzers/in der eigenen Datenbank, nicht an Dritte weitergegeben.
- KI-Funktionen: laufen standardmaessig auf dem Geraet des Nutzers (kein Datenabfluss). Nur falls der Nutzer FREIWILLIG einen eigenen Zugang zu einem externen KI-Anbieter (z.B. Anthropic, OpenAI) hinterlegt, werden Mail-Inhalte zur Verarbeitung an diesen Anbieter uebermittelt -- ausschliesslich nach ausdruecklicher Zustimmung im Onboarding.
- Sicherheits-Protokolldaten (z.B. erkannte Phishing-Versuche) fuer den Betrieb der Schutzfunktionen.

**Rechtsgrundlage:** Vertragserfuellung (Art. 6 Abs. 1 lit. b DSGVO) fuer den Kernbetrieb, Einwilligung (Art. 6 Abs. 1 lit. a DSGVO) fuer optionale KI-Cloud-Nutzung.

**Speicherdauer:** Daten werden geloescht, sobald das Nutzerkonto geloescht wird, soweit keine gesetzlichen Aufbewahrungspflichten entgegenstehen.

**Rechte der Nutzer:** Auskunft, Berichtigung, Loeschung, Einschraenkung der Verarbeitung, Datenuebertragbarkeit, Widerspruch (Art. 15-21 DSGVO), Beschwerderecht bei einer Aufsichtsbehoerde.

**Empfaenger/Drittlaender:** Bei optionaler Cloud-KI-Nutzung (nur nach Zustimmung) koennen Daten an Anbieter mit Sitz ausserhalb der EU (z.B. USA) uebermittelt werden -- hierfuer sind, je nach Anbieter, Standardvertragsklauseln oder ein Angemessenheitsbeschluss massgeblich. Bitte beim jeweiligen Anbieter (Anthropic/OpenAI) die aktuellen Datenschutzbedingungen ergaenzend verlinken.

---
## SEITE 6: Impressum -- KANN NICHT VON MIR AUSGEFUELLT WERDEN

Ein Impressum nach § 5 TMG braucht echten Namen, Anschrift und Kontaktdaten des Betreibers -- das kann/darf ich nicht fuer Massimo erfinden. Platzhalter-Struktur:

Angaben gemaess § 5 TMG:
[Vor- und Nachname bzw. Firmenname]
[Strasse, Hausnummer]
[PLZ, Ort]

Kontakt:
E-Mail: [echte Kontakt-Adresse]
[Telefon, falls gewuenscht -- optional]

[Falls Gewerbe angemeldet: Handelsregister-Nummer/USt-IdNr., falls vorhanden]

Massimo muss diese Angaben selbst final ausfuellen -- bitte NICHT mit Platzhaltern live schalten, das waere selbst ein Rechtsverstoss.

---

Track C/F: bitte diese sechs Inhalte in die entsprechenden Unterseiten/Bereiche der oeffentlichen driftware.online-Kachel einbauen. Rechtstexte (Seiten 3-5) klar als das kennzeichnen was sie sind, mit einem sichtbaren Hinweis "Entwurf, in anwaltlicher Pruefung" bis Massimo die Pruefung bestaetigt hat -- danach kann der Hinweis entfernt werden.


[2026-09-21] [erledigt: driftware-Repo Commit 7e09291] [ERGAENZUNG zum Inhalts-Paket - Eigenverantwortung des Nutzers] [Track C/F] — Massimo: wichtiger Zusatz zum Inhalts-Paket von eben. Dem User muss klar und ehrlich vermittelt werden, dass er auch selbst fuer seinen Schutz verantwortlich ist -- neue Betrugsmaschen und Techniken entstehen laufend, driftmail kann niemals 100%ige Sicherheit garantieren. Bitte als eigenen Abschnitt auf der Produktseite UND als Ergaenzung im Haftungsausschluss-Text einbauen.

---
## NEUER ABSCHNITT: "So schuetzt du dich zusaetzlich" (auf der Produktseite, sichtbar platziert, nicht versteckt im Kleingedruckten)

**Einleitungssatz:** driftmail nimmt dir viel Arbeit ab -- aber 100%ige Sicherheit gibt es bei keinem Mail-Client, auch nicht bei uns. Angreifer entwickeln staendig neue Tricks. Ein paar einfache Gewohnheiten machen dich zusaetzlich sicherer:

- Nutze die Whitelist aktiv: markiere Absender, denen du wirklich vertraust, ueber den "Absender vertrauen"-Button.
- Sei besonders misstrauisch bei Dringlichkeit: "Sofort handeln", "Konto wird gesperrt", "Letzte Mahnung" -- Zeitdruck ist die haeufigste Betrugstaktik.
- Bei Geld-/Bankdaten-Aenderungen: immer telefonisch gegenpruefen, unter einer dir bekannten (nicht der in der Mail genannten) Telefonnummer.
- Klicke keine Links aus Mails, bei denen du unsicher bist -- rufe die Webseite stattdessen direkt im Browser auf.
- Halte dein Geraet/Betriebssystem aktuell -- viele Sicherheitsluecken werden nur durch Updates geschlossen.
- driftmail warnt dich -- die Entscheidung bleibt bei dir.

---
## Ergaenzung zum Haftungsausschluss-Entwurf von eben (Seite 3), bitte anhaengen:

"driftmail bietet automatisierte Unterstuetzung bei der Erkennung von Spam, Phishing und Betrugsversuchen, kann jedoch keine vollstaendige oder dauerhafte Sicherheit gewaehrleisten. Angreifer entwickeln fortlaufend neue Methoden, die zum Zeitpunkt der Nutzung moeglicherweise noch nicht erkennbar sind. Der Nutzer bleibt selbst dafuer verantwortlich, bei verdaechtigen Nachrichten -- unabhaengig von einer angezeigten oder nicht angezeigten Warnung -- eigene Vorsicht walten zu lassen, insbesondere bei Zahlungsaufforderungen, Preisgabe persoenlicher Daten und Aenderungen von Bankverbindungen."

Bitte diesen Zusatz-Abschnitt gut sichtbar platzieren (z.B. direkt nach der Funktionsuebersicht auf der Produktseite), nicht nur im Kleingedruckten -- das ist Massimo ausdruecklich wichtig.


[2026-09-21] [erledigt: driftware-Repo Commit 7e09291] [BUG - Kachel auf driftware.online oeffnet nicht] [Track C/F] [hohe Prioritaet, blockiert Sichtbarkeit des ganzen Inhalts-Pakets von eben] — Massimo hat gemeldet, dass die driftmail-Kachel auf driftware.online nicht aufgeht. Geprueft: die Kachel zeigt "Bald verfuegbar" statt eines echten "Ansehen"-Links wie bei den anderen Apps (Snoxi, CollectView, Ultimate Music Master, Schriftgenerator). Der Link-Href ist "#" -- reiner Platzhalter, nie mit einer echten Ziel-URL verknuepft.

Bitte die Kachel mit der tatsaechlichen driftmail-Info-Seite/Kachel verlinken (siehe die beiden vorherigen Auftraege "Einstellungsbereich + Info-Seite" und "Inhalts-Paket fuer driftware.online-Kachel" -- die Inhalte/Struktur stehen dort bereits vollstaendig). Falls die Info-Seite noch nicht eigenstaendig erreichbar ist (z.B. weil sie erst mit der laufenden Web-App zusammen deployed wird): Status-Badge entsprechend anpassen (z.B. "In Kuerze" bleibt korrekt so lange, bis die Seite wirklich existiert -- aber sobald sie existiert, muss der Href aktualisiert werden, nicht vergessen).

Hohe Prioritaet -- ohne funktionierenden Link ist das gesamte Inhalts-Paket von eben fuer niemanden erreichbar.


[2026-09-21] [beantwortet, siehe TERMINAL_INBOX.md] [KLARSTELLUNG - Missverstaendnis aufgeklaert] [Track C/F] [hohe Prioritaet] — Gefunden in SYNC.md: ein frueherer Terminal-Eintrag geht davon aus, dass die oeffentliche Info-Seite/Kachel (Punkt 2 aus "Einstellungsbereich + Info-Seite") "bereits ueber Web-Claude laeuft" und deshalb bewusst nicht angefasst wurde. Das ist ein Missverstaendnis -- bitte richtigstellen: Web-Claude (dieser Kanal) baut NICHTS direkt im Repo oder auf driftware.online, sondern schreibt ausschliesslich Auftraege/Inhalte hier in WEB_INBOX.md. Die tatsaechliche Umsetzung (Seiten-Komponenten bauen, Kachel-Link auf driftware.online reparieren) muss IMMER von Claude Code im Terminal gemacht werden, genau wie alle anderen Punkte.

Betrifft zwei noch unbearbeitete Eintraege, die dadurch faelschlich liegen geblieben sind, BITTE JETZT ALS NAECHSTES (vor dem Rest der Warteschlange, Massimo hat das mehrfach als dringend gemeldet):
1. "BUG - Kachel auf driftware.online oeffnet nicht" (Link zeigt auf "#", muss auf die echte Info-Seite zeigen).
2. "INHALTS-PAKET fuer driftware.online-Kachel" (kompletter Text fuer Produktseite, Bedienungsanleitung, Haftungsausschluss, AGB, Datenschutzerklaerung, Impressum-Platzhalter, plus die Ergaenzung "So schuetzt du dich zusaetzlich" -- alles bereits vollstaendig in WEB_INBOX.md ausformuliert, muss nur noch in echte Seiten-Komponenten umgesetzt werden).

Ausserdem offene Rueckfrage von Massimo: der iOS-Abschlussbericht von vorhin erwaehnte "30 neue Diagnose-Probleme in 3 Dateien" -- wurden die behoben, oder sind das bekannte/unkritische Warnungen? Bitte kurz einordnen.


[2026-09-21] [erledigt: driftware-Repo Commit 7fc57b9, siehe SYNC.md] [KORREKTUR - Impressum verlinken statt neu erstellen] [Track C/F] — Massimo: die driftmail-Info-Seite braucht KEIN eigenes Impressum mit Platzhaltern (siehe "Seite 6" im fruehen Inhalts-Paket) -- driftware.online hat bereits ein bestehendes Impressum mit Massimos echten Daten. Bitte stattdessen einfach dorthin verlinken (Impressum-Link/Icon auf der driftmail-Seite zeigt auf das schon vorhandene Impressum der Landingpage, kein neuer Inhalt noetig). Der fruehere Platzhalter-Text aus dem Inhalts-Paket ("Seite 6") ist damit hinfaellig, bitte nicht mehr verwenden. Reine Verlinkung, kein Contract-Bruch, kleine Korrektur.


[2026-09-21] [erledigt: Backend (Commit 6236f36) + Web + iOS, siehe SYNC.md 22.09.] [NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies] [contracts + Track A + Track C/F] [hohe Prioritaet - macht zwei bereits gebaute Features erst funktionsfaehig] — Massimo: Code hat ehrlich gemeldet, dass Tracking-Pixel-Blockierung und Klick-Zeit-Link-Pruefung beide praktisch wirkungslos sind, weil Mail-Bodies aktuell nicht als HTML gerendert werden (nur Rohtext, vermutlich). Bitte HTML-Rendering als eigene, saubere Grundlage nachziehen.

**Sicherheitsanforderungen, nicht verhandelbar:**
- HTML-Mail-Inhalt MUSS in einer Sandbox angezeigt werden -- Web: <iframe sandbox="..."> ohne allow-scripts/allow-same-origin, iOS: WKWebView mit deaktiviertem JavaScript und eingeschraenkter Navigation. Kein direktes Einbetten von Absender-HTML in den normalen DOM/normale View-Hierarchie.
- <script>-Tags und Inline-Event-Handler (onclick etc.) im Mail-HTML muessen vollstaendig entfernt/neutralisiert werden, bevor angezeigt wird (Sanitizing, z.B. mit einer etablierten Bibliothek wie DOMPurify o.ae. statt eigener Regex-Loesung).
- Externe Bilder standardmaessig NICHT automatisch laden (das ist ja der eigentliche Sinn der Tracking-Pixel-Blockierung von eben) -- Platzhalter anzeigen, User kann pro Mail oder generell "Bilder immer laden" waehlen (siehe frueherer Tracking-Pixel-Auftrag, jetzt erst wirklich umsetzbar).
- Alle Links im gerenderten HTML muessen automatisch durch den bestehenden Klick-Zeit-Link-Check-Endpunkt (/link-check) umgeschrieben werden (Auto-Linkify + Rewrite), nicht nur bei reinen Text-URLs -- das ist die fehlende Verbindung, die der Klick-Zeit-Pruefung aktuell fehlt.

**Umfang:**
- Backend: falls noch nicht vorhanden, muss der IMAP-Sync den HTML-Teil einer Mail (multipart/alternative -> text/html) tatsaechlich mit abspeichern, nicht nur den Text-Teil.
- Web: Sandbox-iFrame-Komponente fuer die Nachrichtenansicht.
- iOS: WKWebView-Integration mit den oben genannten Einschraenkungen.

Bitte Umfang/Aufwand realistisch einschaetzen, das ist vermutlich groesser als die meisten Einzelauftraege bisher -- in SYNC.md dokumentieren, ob es in einem Zug geht oder aufgeteilt werden sollte. Hohe Prioritaet, da zwei bereits fertige Backend-Features erst dadurch nutzbar werden.

**Aufwands-Einschaetzung (Terminal, 22.09., wie oben verlangt):** in drei unabhaengige Schritte aufgeteilt, Backend zuerst -- Web/iOS koennen parallel auf einer fertigen, getesteten API aufbauen statt gegen einen sich noch aendernden Contract zu entwickeln. Backend jetzt fertig (`messages.body_html`, Sanitisierung/Bild-Blockierung/Link-Umschreibung serverseitig, `message_links` befuellt, Migration + Smoketest verifiziert, siehe SYNC.md 22.09.). Web (Sandbox-`<iframe>`) und iOS (`WKWebView` ohne JS) sind vom Umfang her vergleichbar mit den bisherigen "9 Features"-UI-Rundgaengen -- keine neuen Contract-Aenderungen mehr noetig, reine Anzeige-Arbeit gegen die jetzt fertige `bodyHtml`/`links`-API.


[2026-09-21] [erledigt: 770f156 im driftware-Repo, "unprofessionelles Namensbeispiel entfernt"] [TEXT-KORREKTUR - anderes Repo, bitte beachten] [driftware-Repo, NICHT driftmail-Repo] — Massimo: Text auf der driftmail-Info-Seite (driftware-Repo, Datei driftmail/index.html) im ersten Funktionsuebersicht-Feld "Spam, Phishing & Betrug erkennen" wirkt mit dem Namensbeispiel unprofessionell. Bitte aendern:

Alt: "Eindeutiger Muell wird automatisch aussortiert, Grenzfaelle landen mit Warnhinweis in Quarantaene statt geloescht zu werden -- auch klassischer Vorschussbetrug ("Prinz aus Nigeria"-Muster)."

Neu: "Eindeutiger Muell wird automatisch aussortiert, Grenzfaelle landen mit Warnhinweis in Quarantaene statt geloescht zu werden -- auch klassischer Vorschussbetrug."

Nur das Klammer-Namensbeispiel entfernen, Rest bleibt gleich. Reine Text-Aenderung im driftware-Repo, kein Contract-Bruch, kein Blocker.


[2026-09-21] [erledigt: 770f156 im driftware-Repo (Akkordeon statt separater Unterseiten, gleichwertig), 25.09. Nachbesserung Commit b51e8e0] [ANLEITUNG - Pro-Anbieter-Unterseiten] [driftware-Repo, Datei driftmail/anleitung.html] — Massimo: Bedienungsanleitung um eine eigene Schritt-fuer-Schritt-Unterseite pro Mail-Anbieter erweitern. Hinweis: echte Screenshots der Fremd-Oberflaechen (Google/Apple/GMX/web.de) kann ich nicht liefern -- Text ist so detailliert wie moeglich, Code kann bei Bedarf eigene einfache Icons/Nummerierungs-Grafiken statt echter Screenshots einbauen, keine 1:1-Nachbildung fremder UIs.

**Umgesetzt (Terminal, 21.09. Commit `770f156`, geprueft/nachgebessert 25.09. Commit `b51e8e0`):** statt separater Unterseiten pro Anbieter (die eine eigene Navigation gebraucht haetten) wurden aufklappbare Akkordeon-Abschnitte direkt in Schritt 1 der Anleitung gebaut (Gmail/iCloud/GMX/web.de/Anderer Anbieter), jeweils mit vollstaendiger Schritt-fuer-Schritt-Liste, keine Screenshots, stattdessen Text + `<code>`-Server-Angaben. Funktional gleichwertig zu separaten Unterseiten, einfacher zu pflegen (eine Quelle statt vier/fuenf Dateien). **Beim 25.09.-Review gefunden und korrigiert:** die web.de-Sektion beschrieb noch IMAP (`imap.web.de`), obwohl das Produkt web.de inzwischen per POP3 anbindet (`pop3.web.de`, siehe contracts/mail-providers.json) -- war seit der IMAP->POP3-Umstellung nie nachgezogen worden, jetzt korrigiert.

---
## Gmail

1. In driftmail "Gmail" bei der Provider-Auswahl anklicken.
2. Der bekannte Google-Anmeldebildschirm oeffnet sich in einem neuen Fenster/Tab.
3. Mit der Gmail-Adresse und dem Google-Passwort anmelden.
4. Google zeigt eine Berechtigungsanfrage ("driftmail moechte auf dein Gmail-Konto zugreifen") -- bestaetigen.
5. Fertig, das Postfach laedt automatisch. Kein App-Passwort noetig.

---
## iCloud Mail

1. App-spezifisches Passwort erzeugen (einmalig): im Browser appleid.apple.com oeffnen, mit der Apple-ID einloggen.
2. Zu "Anmeldung und Sicherheit" scrollen/klicken.
3. "App-spezifische Passwoerter" auswaehlen.
4. "Ein App-spezifisches Passwort erstellen" klicken, einen Namen vergeben (z.B. "driftmail").
5. Das angezeigte Passwort (Format xxxx-xxxx-xxxx-xxxx) kopieren.
6. In driftmail "iCloud Mail" auswaehlen, die @icloud.com-Adresse eintragen.
7. Als Passwort das gerade erzeugte App-Passwort einfuegen (NICHT das normale Apple-ID-Passwort).
8. Server-Einstellungen sind schon richtig vorausgefuellt (imap.mail.me.com).
9. "Verbinden" klicken.

---
## GMX

1. Bei GMX einloggen, oben rechts auf das Profil-Symbol klicken.
2. Zu den E-Mail-Einstellungen wechseln, Bereich "POP3/IMAP" suchen.
3. IMAP-Zugriff aktivieren (bei GMX/web.de standardmaessig ausgeschaltet, muss einmalig angeschaltet werden).
4. Falls Zwei-Faktor-Authentifizierung aktiv ist: zusaetzlich ein App-Passwort in den Sicherheitseinstellungen erzeugen. Ohne 2FA reicht das normale GMX-Passwort.
5. In driftmail "GMX" auswaehlen, E-Mail-Adresse eintragen.
6. Passwort (normales Passwort oder App-Passwort, je nach Schritt 4) eintragen.
7. Server-Einstellungen sind vorausgefuellt (imap.gmx.net).
8. "Verbinden" klicken.

---
## web.de

1. Bei web.de einloggen, oben rechts auf das Namenskuerzel klicken.
2. "E-Mail-Einstellungen" auswaehlen, Bereich "POP3/IMAP" suchen.
3. IMAP-Abruf einschalten (auch hier standardmaessig aus).
4. Falls Zwei-Faktor-Authentifizierung aktiv ist: App-Passwort erzeugen. Ohne 2FA reicht das normale web.de-Passwort.
5. In driftmail "web.de" auswaehlen, E-Mail-Adresse eintragen.
6. Passwort eintragen.
7. Server-Einstellungen sind vorausgefuellt (imap.web.de).
8. "Verbinden" klicken.

---
## Anderer Anbieter (generisches IMAP)

1. Beim eigenen Mail-Anbieter herausfinden: IMAP-Server-Adresse, IMAP-Port (meist 993), SMTP-Server-Adresse, SMTP-Port (meist 587) -- steht meist in den Hilfeseiten des Anbieters unter "IMAP-Einstellungen" oder "E-Mail-Programm einrichten".
2. In driftmail "Anderer Anbieter (IMAP)" auswaehlen.
3. E-Mail-Adresse und Passwort eintragen.
4. IMAP-Server, Port und SMTP-Angaben aus Schritt 1 manuell eintragen.
5. "Verbinden" klicken. Bei Fehler: Angaben nochmal beim Anbieter gegenpruefen, manche verlangen ebenfalls ein App-Passwort statt des normalen Passworts.

---

Bitte diese sechs Unterabschnitte als eigene, klar betitelte Bereiche auf der Anleitungs-Seite einbauen (z.B. Tabs oder Akkordeon-Elemente, damit die Seite nicht zu lang/unuebersichtlich wird -- Umsetzung Code ueberlassen). Reine Content-Erweiterung, kein Contract-Bruch.


[2026-09-21] [erledigt: 3bcb5b7] [BUG - iOS erreicht lokales Backend nicht] [Track C] [hohe Prioritaet, blockiert laufenden iOS-Test] — Massimo hat im Simulator DRIFTMAIL_API_BASE_URL=http://localhost:3000/v1 in Edit Scheme gesetzt (Run -> Arguments -> Environment Variables), Backend laeuft nachweislich (neu gestartet, npm run dev). Trotzdem zeigt die App weiterhin "Anbieterliste konnte nicht live geladen werden -- zeige die zuletzt bekannten Anbieter" UND ein IMAP-Verbindungsversuch (web.de) schlaegt ebenfalls fehl. Backend-Verfuegbarkeit ist damit ausgeschlossen, das Problem liegt auf iOS-Seite.

**Verdacht, bitte zuerst pruefen:** App Transport Security (ATS) blockiert vermutlich Klartext-HTTP zu localhost. Frueherer SYNC.md-Eintrag erwaehnt bereits eine ATS-Ausnahme, die per INFOPLIST_FILE_ADDITIONAL_CONTENT-Build-Setting gesetzt werden sollte, aber von Xcode "still ignoriert" wurde (nur durch Diff des tatsaechlich gebauten Info.plist entdeckt). Bitte pruefen, ob diese ATS-Ausnahme (NSAppTransportSecurity / NSExceptionDomains fuer localhost, oder NSAllowsArbitraryLoads fuer Debug-Builds) im tatsaechlich gebauten Info.plist des aktuellen Standes wirklich vorhanden ist -- nicht nur im Xcode-Projekteinstellungs-UI, sondern im gebauten Artefakt selbst (gleiche Verifikationsmethode wie beim fruehren Fund).

Bitte mit echtem Simulator-Build + Netzwerk-Log (z.B. per log stream oder Xcode-Konsole waehrend eines Verbindungsversuchs) reproduzieren und beheben, nicht nur den Info.plist-Inhalt statisch pruefen.

**Ergebnis (Terminal, 25.09., Commit `3bcb5b7`): ATS-Verdacht war FALSCH.** Gebautes Info.plist per `plutil -p` geprueft -- `NSAllowsLocalNetworking` ist korrekt vorhanden, ATS blockiert nichts. Echte Ursache per `simctl launch --console-pty` + temporaerem Debug-Print gefunden: `DecodingError.keyNotFound("requiresAppPassword")` -- `contracts/mail-providers.json` laesst dieses Feld fuer oauth-Provider (Gmail/Outlook/Yahoo) weg, `Models/MailProvider.swift` verlangte es aber als Pflichtfeld, wodurch JEDER `GET /mail-providers`-Aufruf gegen ein echtes Backend am Decoding scheiterte (ein fehlerhaftes Element verwirft das gesamte Array) -- Netzwerk/ATS war nie das Problem. Fix: eigener `init(from:)` mit `decodeIfPresent(...) ?? false` fuer `requiresAppPassword`. Der gemeldete IMAP-Verbindungsfehler (web.de) liess sich gegen den echten Server NICHT reproduzieren (`curl` mit falschem Passwort liefert korrekt `422`, sauber als `.verificationFailed` behandelt) -- vermutlich eine Zugangsdaten-/App-Passwort-Verwechslung beim Testen, kein Code-Bug; bitte mit einem web.de-App-Passwort erneut versuchen, jetzt wo die Anbieterliste laedt. Details in `ios/README.md` 25.09.-Eintrag. Mit echtem Simulator-Build + Screenshot verifiziert (Anbieterliste laedt ohne Fehlerbanner).

---

[2026-09-21] [teilweise erledigt: 42e98ef -- Contract + iOS (Track C), Web (Track F) noch offen] [UX-VERBESSERUNG - Anbieter automatisch aus E-Mail-Adresse erkennen] [contracts + Track A + Track C/F] — Massimo: die Provider-Auswahl VOR der E-Mail-Eingabe ist ein unnoetiger Extra-Schritt, da der User seine Adresse ohnehin eingeben muss. Bitte Ablauf umdrehen:

1. Erster Bildschirm: nur EIN Eingabefeld fuer die E-Mail-Adresse (kein Anbieter-Auswahl-Bildschirm mehr davor).
2. Nach Eingabe: Endung automatisch auswerten (@gmail.com -> Gmail-OAuth-Flow direkt starten, @icloud.com/@me.com -> iCloud-Preset, @gmx.de/@gmx.net -> GMX-Preset, @web.de -> web.de-Preset, @outlook.com/@hotmail.com -> Outlook falls/sobald verfuegbar).
3. Bei unbekannter Endung: sauberer, logischer Fallback auf den "Anderer Anbieter (IMAP)"-Weg mit manueller Server-Eingabe -- kein Fehler, keine Sackgasse, einfach der naechste sinnvolle Schritt.
4. Passwort-/App-Passwort-Feld erscheint danach, mit dem zum erkannten Anbieter passenden Hinweistext (wie bisher schon vorhanden).

Bitte GET /mail-providers weiterhin nutzen, um die Domain-zu-Preset-Zuordnung zu pflegen (z.B. um das Praefix-Matching serverseitig zentral zu halten, nicht hart im Client verdrahtet) -- Track A entscheidet sinnvolle Umsetzung. Kein Contract-Bruch, reine Ablauf-/UX-Aenderung, betrifft Web und iOS gleichermassen.

**Umgesetzt (Terminal, 25.09., Commit `42e98ef`): Contract + iOS.** `contracts/mail-providers.json`/`api-spec.yaml` bekommen ein `domains`-Feld pro Provider (Kleinbuchstaben-Domainliste, `other_imap` leer als Fallback) -- kein Backend-Code-Change noetig, `mailProviders.ts` liefert die Datei unveraendert aus. iOS (`OnboardingAccountConnectView`) fragt jetzt zuerst nur die Adresse, matcht die Domain und springt direkt ins passende Formular (Adresse durchgereicht); bekannte-aber-nicht-nutzbare Treffer (Gmail/Outlook/Yahoo) erklaeren das + bieten "trotzdem per IMAP versuchen" an, unbekannte Domains fallen ohne Fehlermeldung auf generisches IMAP zurueck (Punkt 3). Der alte Listen-Picker bleibt als manueller Override erhalten. Details/Testgrenzen in `ios/README.md` 25.09.-Eintrag. **Offen: Web (Track F)** -- `web/src/components/OnboardingScreen.tsx` braucht denselben `domains`-Abgleich noch.


[2026-09-23] [erledigt: bbdf23b im driftware-Repo, "Emojis entfernen, Text professioneller formulieren"] [ZWEI TEXT-KORREKTUREN - unprofessionelle Formulierungen] [driftware-Repo, Datei driftmail/index.html] — Massimo: zwei Formulierungen auf der driftmail-Info-Seite wirken zu umgangssprachlich fuer erwachsene Nutzer, bitte aendern:

1) Karte "Spam, Phishing & Betrug erkennen":
Alt: "Eindeutiger Muell wird automatisch aussortiert, Grenzfaelle landen mit Warnhinweis in Quarantaene statt geloescht zu werden -- auch klassischer Vorschussbetrug."
Neu: "Eindeutig schaedliche Nachrichten werden automatisch aussortiert, Grenzfaelle landen mit Warnhinweis in Quarantaene statt geloescht zu werden -- auch klassischer Vorschussbetrug."

2) Karte "Echter Virenscan":
Alt-Titel: "Echter Virenscan"
Neu-Titel: "Vollstaendiger Virenscan"
(Beschreibungstext "Fuer Anhaenge in beide Richtungen -- beim Senden und beim Empfangen." bleibt unveraendert.)

Rest der Seite wurde gegengeprueft und ist in Ordnung, keine weiteren Aenderungen noetig. Reine Text-Korrektur, kein Contract-Bruch.


[2026-09-23] [erledigt: bbdf23b im driftware-Repo, "Emojis entfernen, Text professioneller formulieren"; 25.09. gegengeprueft (Terminal): kein Emoji-Unicode-Zeichen mehr in index.html/anleitung.html/agb.html/privacy.html/haftungsausschluss.html] [EMOJIS ENTFERNEN - wirken kindlich] [driftware-Repo, Datei driftmail/index.html] [gilt auch fuer anleitung.html, agb.html, privacy.html, haftungsausschluss.html falls dort ebenfalls Emojis verwendet werden] — Massimo: alle Emoji-Icons auf der driftmail-Seite entfernen (Schutzschild, Haken, Warndreieck, Maske, "Neu", Mikrobe, Kamera, Roboter, Briefumschlag, Schloss, Kompass vor den Funktions-Karten-Titeln) -- wirkt zu verspielt/kindlich fuer ein Sicherheitsprodukt fuer erwachsene Nutzer.

**Vorschlag statt Emoji:** echte, minimalistische Icons (z.B. Tabler Icons oder aehnliches SVG-Icon-Set, passend zur bereits festgelegten Superhuman-Design-Richtung -- neutrale Strichzeichnungen statt bunter Symbole, nur die bestehenden Sicherheits-Warnfarben duerfen weiter farbig hervorgehoben sein, siehe frueherer Design-Auftrag). Falls kein Icon-Set eingebunden werden soll: ersatzweise nur der Text-Titel ohne jegliches Icon davor, auch das waere schon deutlich aufgeraeumter.

Bitte konsistent auf der ganzen driftmail-Unterseite (nicht nur der Startseite) durchziehen, falls Emojis auch in anleitung.html oder den Rechtstexten verwendet wurden.


[2026-09-23] [erledigt: c005a84 im driftware-Repo, "Datenschutz: helles Design + US-Hosting-Hinweis"] [ERGAENZUNG Datenschutzerklaerung - US-Hosting/Registrar] [driftware-Repo, Datei driftmail/privacy.html] — Massimo hat bestaetigt: Hosting laeuft ueber GitHub Pages (GitHub Inc./Microsoft, USA), Domain-Registrar ist Namecheap (USA). Beides sind US-Anbieter und gehoeren in die Datenschutzerklaerung, aehnlich wie der bestehende Hinweis zu optionalen Cloud-KI-Anbietern (Drittland-Datenuebermittlung).

Bitte folgenden Abschnitt in privacy.html ergaenzen (Formulierung als Vorschlag, Massimo/Anwalt kann anpassen):

"Diese Website wird ueber GitHub Pages (GitHub Inc., ein Unternehmen von Microsoft, USA) gehostet und die Domain driftware.online ist bei Namecheap Inc. (USA) registriert. Beim Aufruf dieser Seite werden technische Daten (z.B. IP-Adresse) an die Server dieser US-Anbieter uebermittelt. Fuer den Datentransfer in die USA stuetzen sich die Anbieter nach eigenen Angaben auf Standardvertragsklauseln bzw. ein Angemessenheitsniveau nach Art. 46 DSGVO -- bitte die aktuellen Datenschutzbedingungen von GitHub und Namecheap fuer Details ergaenzend verlinken."

Reine Ergaenzung des bestehenden Datenschutzerklaerung-Entwurfs (bereits als "Entwurf, in anwaltlicher Pruefung" gekennzeichnet), kein Contract-Bruch.


[2026-09-24] [teilweise erledigt: 7ecec18 -- iOS (Track C), Web (Track F) noch offen] [PRAEZISIERUNG - Titel oben bei mehreren Konten] [Track C/F] — Massimo praezisiert den aelteren offenen Punkt "Driftmail-Titel oben durch E-Mail-Adresse ersetzen" (WEB_INBOX.md 10.09.): bei nur EINEM verbundenen Konto reicht die einzelne E-Mail-Adresse oben wie bereits spezifiziert. Bei MEHREREN verbundenen Konten sollen ALLE Konto-Namen/E-Mail-Adressen oben aufgefuehrt werden, nicht nur das aktuell aktive -- damit der User auf einen Blick sieht, welche Konten insgesamt verbunden sind, nicht nur in welchem er gerade ist. Umsetzung (z.B. mehrere Adressen nebeneinander/als kleine Liste, oder das aktive hervorgehoben mit den anderen daneben/darunter kleiner) bleibt Track C/F ueberlassen, Hauptsache alle sind sichtbar, nicht nur eine. Betrifft Web und iOS gleichermassen. Kein Contract-Bruch, reine UI-Anpassung.

**Umgesetzt (Terminal, 25.09., Commit `7ecec18`): iOS.** `FolderListView.swift`: aktive Adresse bleibt oben (fett), bei mehr als einem Konto erscheint darunter eine kleinere, gedaempfte Zeile mit allen uebrigen Adressen (·-getrennt). Einzelkonto-Fall visuell unveraendert. Details/Testgrenzen in `ios/README.md` 25.09.-Eintrag. **Offen: Web (Track F)** -- dieselbe Praezisierung fuer die Web-Sidebar/den Header.


[2026-09-24] [ueberholt: durch den praeziseren Eintrag "DESIGN-RICHTUNG PRAEZISIERT - Outlook-inspiriert" vom selben Tag ersetzt (dort umgesetzt, siehe Commits 701f91b/e0e656e) -- dieser Eintrag selbst ist nicht mehr die gueltige Vorgabe] [NEUE DESIGN-RICHTUNG - App hell + Kobaltblau] [Web + iOS] [ersetzt/ergaenzt fruehere Design-Vorgaben, bitte als aktuellste Vorgabe behandeln] — Massimo hat aus mehreren gezeigten Mockup-Varianten "Kobaltblau, hell" gewaehlt (nicht das dunkle Superhuman-Grau/Teal von vorher, auch bewusst ANDERS als die neue helle Salbeigruen-Landingpage -- eigene Identitaet fuer die App selbst).

**Farben (aus dem bestaetigten Mockup):**
- Hintergrund: reines Weiss (#ffffff) bzw. sehr helles Grau fuer Panels
- Primaerer Akzent: Kobaltblau #2f5fdb (Buttons, aktive Zustaende, "Neu"-Badges)
- Helle Akzent-Flaeche fuer hervorgehobene/neue Mails: #eef3ff Hintergrund, #2f5fdb bzw. dunkleres Blau fuer Text/Badge darauf (Badge-Hintergrund #dbe6ff, Badge-Text #2f5fdb)
- Fliesstext dunkel: #1a1d24 (Haupttext), #444751 (sekundaerer Text), #7c8291 (gedaempft/Meta-Text)
- Trennlinien: #e6e8ec (Rahmen), #f1f2f5 (Listenzeilen-Trenner)
- Sicherheits-Warnfarben (rot fuer "Prüfen"-Badges etc.) bleiben wie bisher UNVERAENDERT fest/nicht themebar -- nur der normale UI-Akzent wechselt auf Kobaltblau.

**Hinweis zum bestehenden 5-Themes-System:** Falls die App bereits die fruehere "5 waehlbare Akzent-Themes"-Struktur hat (Teal Default, Ocean Blue #378ADD, Violett, Koralle, Ocean-Verlauf) -- pruefen, ob sich das neue Kobaltblau (#2f5fdb) als NEUER DEFAULT in dieses System einordnen laesst (aehnlich/ueberschneidend mit dem bisherigen "Ocean Blue"), oder ob Massimo eine komplett neue Grundausrichtung moechte, die das alte Teal-Default ersetzt. Bitte kurze Rueckfrage/Einschaetzung in SYNC.md, falls das nicht eindeutig ist, sonst nach bestem Wissen umsetzen: Kobaltblau + Hell wird der neue Standard-Look der App (Web + iOS), ersetzt den bisherigen dunklen/Teal-Grundton als Ausgangspunkt.

**Umfang:** Betrifft grundlegende Hintergrund-/Textfarben, Buttons, aktive/hervorgehobene Listenzeilen, Badges -- im Prinzip die gesamte App-Oberflaeche auf Web und iOS, nicht nur einzelne Screens. Bitte Umfang/Reihenfolge (z.B. zentrale Farb-Variablen zuerst anpassen, dann Screen fuer Screen pruefen) selbst sinnvoll einteilen und in SYNC.md dokumentieren.

Kein Contract-Bruch (reine visuelle Ueberarbeitung), aber grosser Umfang -- bitte realistisch einschaetzen, ob das in einem Zug geht oder aufgeteilt werden sollte.


[2026-09-24] [teilweise erledigt: 701f91b -- Contract-Farben/Radien + iOS (Track C), Drei-Spalten-Layout auf Web (Track F) noch offen] [DESIGN-RICHTUNG PRAEZISIERT - Outlook-inspiriert] [Web + iOS] [ERSETZT den vorherigen Eintrag "NEUE DESIGN-RICHTUNG - App hell + Kobaltblau" vom selben Tag -- bitte NUR diesen hier umsetzen, der alte war zu ungenau] — Massimo hat nach mehreren Mockup-Runden das neue Outlook fuer Windows (2026, aktueller Standard-Look) als konkretes Vorbild bestaetigt. Recherchiert: neues Outlook nutzt Fluent-Design mit Drei-Spalten-Layout, Microsoft-Signalblau, dezente Rundungen, "Segoe UI"-Schriftfamilie.

**Layout (wichtigster Unterschied zum bisherigen Konzept):**
Klassisches Drei-Spalten-Layout, nicht nur eine Liste:
1. Schmale linke Ordner-Leiste (Eingang, Gesendet, Entwuerfe, Quarantaene, Spam, Papierkorb) mit einem deutlichen "+ Neue Mail"-Button oben in Akzentfarbe.
2. Mittlere Nachrichtenliste, kompakt (Absender + Betreff + Uhrzeit/Datum, zweizeilig pro Eintrag).
3. Rechts der Lesebereich (Vorschau der ausgewaehlten Mail) -- auf breiten Bildschirmen direkt sichtbar, auf schmalen/Mobile als Vollbild-Wechsel wie bisher.

**Farben:**
- Hintergrund: reines Weiss (#ffffff), Ordner-Leiste leicht abgesetzt (#faf9f8)
- Primaerer Akzent: Microsoft-Blau #0078d4 (Buttons, aktive/ausgewaehlte Zeile)
- Ausgewaehlte/aktive Listenzeile: Hintergrund #deecf9, Text #004578
- Haupttext: #201f1e, sekundaerer Text: #605e5c, gedaempft: #a19f9d
- Trennlinien: #e1dfdd (staerker), #f3f2f1 (dezenter, zwischen Listenzeilen)
- Sicherheits-Warnfarben (rot fuer Quarantaene/"Pruefen"-Badges: Hintergrund #fde7e9, Text #a4262c) bleiben FEST, nicht themebar -- nur der normale UI-Akzent ist blau.

**Typografie:** "Segoe UI" als primaere Schriftfamilie auf Web (mit System-Font-Fallback), auf iOS die naechstliegende Systemschrift (SF Pro reicht, keine Segoe-Emulation noetig -- Ziel ist der Fluent-Charakter, nicht Pixel-Kopie).

**Ecken/Formen:** dezente Rundung (4px), keine starken Schatten, klare Trennlinien statt Card-Schatten (Fluent-Stil, nicht Material-Design-Schatten).

Bitte den fruehreren, vageren "Kobaltblau"-Eintrag vom selben Tag als ueberholt behandeln -- dieser hier mit dem Drei-Spalten-Layout und den exakten Hex-Werten ist die verbindliche Vorgabe. Kein Contract-Bruch, aber grosser Umfang (Grundlayout-Aenderung von Liste zu Drei-Spalten auf Web, iOS behaelt vermutlich den bestehenden Navigations-Stack mit angepassten Farben, da Drei-Spalten auf dem iPhone nicht sinnvoll ist -- auf iPad ggf. schon, bitte einschaetzen). Bitte Umfang/Reihenfolge selbst einteilen und in SYNC.md dokumentieren.

**Umgesetzt (Terminal, 25.09., Commit `701f91b`): Contract + iOS (Farben/Radien, kein Layout-Umbau).** `contracts/design-tokens.json`: Akzent auf `#0078D4` als neuen Default-Theme `outlook_blue` (teal bleibt waehlbar), danger-Farben auf die Fluent-Rotvariante, neues `color.selected`-Paar, `color.light` auf die Outlook-Palette (dark unveraendert), `radius.control/.card` auf 4px, `fontFamilyWeb` ("Segoe UI") fuer Track F ergaenzt. Backend-`accent_theme`-Default ebenfalls auf `outlook_blue` umgestellt (Migration fuer bestehende DBs, bestehende Nutzer behalten ihre Wahl). iOS: alle Tokens gespiegelt, `AccentTheme.outlookBlue` neu. Details in `ios/README.md` 25.09.-Eintrag. **Offen: das Drei-Spalten-Layout selbst auf Web (Track F)** -- diese Aenderung deckt nur die Farb-/Radius-Grundlage ab, kein Layout-Umbau.


[2026-09-24] [teilweise erledigt: 701f91b -- iOS (Track C), Web-Icons (Track F) noch offen] [ORDNER-ICONS - 3D/Facetten-Stil, Details bestaetigt] [Web + iOS] [gehoert zum Eintrag "DESIGN-RICHTUNG PRAEZISIERT - Outlook-inspiriert"] — Massimo hat nach mehreren Mockup-Runden einen 3D/Facetten-Icon-Stil bestaetigt (flache Farbflaechen die Tiefe andeuten, kein echter Gradient/Schatten -- aehnlich Fluent-3D-Icons, aber mit klar abgegrenzten Farbflaechen statt weichem Verlauf). Referenz-Farben passend zur Outlook-Palette (Blau #0078d4/#5eb1ec/#106ebe/#004578, Amber #f0a800/#ffcb5c/#7a4d00 fuer Quarantaene, Grau #a19f9d/#c8c6c4/#8a8886 fuer Papierkorb). Jedes Icon steht auf einer flachen ovalen "Schatten"-Ellipse darunter (#e1dfdd) als Bodenkontakt.

Bestaetigt (bitte 1:1 uebernehmen, Formen liegen als SVG-Pfade in der Chat-Historie/den Mockups vor, Track C/F kann sich bei Bedarf ein SVG-Set exportieren lassen):
- Eingang: Briefumschlag-Form in Blau, mit hellerer Flap-Flaeche oben und zwei dunkleren Seiten-Facetten
- Quarantaene: Warndreieck in Amber/Gelb mit dunklerem Ausrufezeichen
- Papierkorb: ECHTER Papierkorb (leicht konisch, oben breiter als unten, mit sichtbaren vertikalen "Gitterstaeben"), NICHT eine eckige Muelltonne -- das war explizit falsch und wurde korrigiert

Noch NICHT final: das Icon fuer "Gesendet" soll ein Papierflieger sein, mehrere Varianten (spitz/flach, hart/weich) wurden gezeigt, aber keine hat Massimo ueberzeugt ("weichere Linien" war letztes Feedback, noch nicht getroffen). Statt weiter blind im Chat zu iterieren: bitte Track C/F einen Papierflieger in der oben stehenden Blau-Palette (#0078d4/#5eb1ec/#106ebe) direkt im echten Build umsetzen (2-3 Formvarianten probieren) und Massimo am tatsaechlichen Screen/Icon-Preview entscheiden lassen -- das laesst sich in einem echten Icon-Editor/Build praeziser treffen als in einem Chat-Mockup.


[2026-09-25] [teilweise erledigt: 701f91b -- iOS (Track C), Web-Icon (Track F) noch offen] [GESENDET-ICON - finale Referenz erhalten] [Web + iOS] [loest die offene Frage aus "ORDNER-ICONS - 3D/Facetten-Stil" vom 24.09.] — Massimo hat ein konkretes Referenzbild fuer das "Gesendet"-Icon geschickt: klassischer Papierflieger, nach oben-rechts zeigend, mit deutlich sichtbaren Faltkanten (mehrere dreieckige Facetten, die den gefalteten Papier-Look erzeugen -- Rumpf/Nase, ein Fluegel heller, die Unterseite/der Rumpf-Falz dunkler). Farbgebung mittleres/klares Blau, passend zur bereits bestaetigten Icon-Palette (#0078d4/#5eb1ec/#106ebe-Familie). Bitte dieses Motiv fuer das Gesendet-Icon umsetzen (Nachbau aus dem Referenzbild, Bild liegt im Chat-Verlauf/den Uploads), im selben 3D-Facetten-Stil wie Eingang/Quarantaene/Papierkorb, gleiche flache ovale Boden-Schatten-Ellipse darunter wie bei den anderen dreien.

Damit ist der Icon-Satz fuer Eingang, Gesendet, Quarantaene und Papierkorb vollstaendig spezifiziert -- keine weiteren offenen Fragen zu diesem Punkt.

**Umgesetzt (Terminal, 25.09., Commit `701f91b`): iOS.** Alle vier Icons als eigene SVG-Nachbauten der Spec (Eingang: Umschlag mit hellerer Flap + zwei dunkleren Seiten; Gesendet: Papierflieger nach oben-rechts mit hellerem Fluegel/dunklerer Unterseite; Quarantaene: Amber-Warndreieck mit dunklerem Ausrufezeichen; Papierkorb: konischer Korb mit Gitterstaeben statt eckiger Tonne) gerendert, als Bild-Assets in die iOS-Ordnerliste eingebaut (ersetzt die bisherigen einfarbigen SF Symbole dort). Farbwerte 1:1 aus dieser Spec, zusaetzlich als gemeinsame Referenz in `contracts/design-tokens.json` `systemFolders.facetIconStyle` hinterlegt, damit Web dieselben Werte nutzen kann. Einzeln als PNG visuell gegen die Spec geprueft (siehe ios/README.md 25.09.), die zusammengesetzte Ordnerliste selbst liess sich in dieser Umgebung nicht screenshotten (kein Test-Account, keine Tap-Automation) -- ehrlich als offener Verifikationspunkt vermerkt. **Offen: Web (Track F)** -- gleiche vier Icons fuer die Web-Sidebar/das Drei-Spalten-Layout.


[2026-09-25] [erledigt: e0e656e (iOS, Track C) -- Web-Icon (Track F) noch offen] [GESENDET-ICON - endgueltige Form bestaetigt, WICHTIG: nicht die Stock-Datei verwenden] [Web + iOS] [ersetzt/praezisiert den Eintrag "GESENDET-ICON - finale Referenz erhalten" vom selben Tag] — Massimo hat als finalen Favoriten ein Bild von einer Shutterstock-Ergebnisseite gezeigt (Suche "papierflieger icon"). WICHTIG: die konkrete Bilddatei von Shutterstock ist lizenzpflichtiges Stockmaterial und darf NICHT direkt in die App uebernommen/kopiert werden (Copyright, Shutterstock ist kostenpflichtig). Bitte stattdessen ein eigenes Icon nach folgender Beschreibung neu zeichnen (Original-Artwork, keine Stockfoto-Uebernahme):

**Form:** Klassischer Papierflieger, nach oben-rechts fliegend (ca. 30-45 Grad Winkel). Deutlich sichtbare gefaltete Papier-Facetten: spitze Nase rechts, ein Fluegel/eine Flaeche oben sichtbar hell, Rumpf/Unterseite mit einer diagonalen Falzlinie die den Koerper in zwei Facetten teilt, hinten ein kurzer spitzer "Schwanz"/Heck-Zipfel unten.

**Farben (mittleres, klares Blau -- bitte an die bestehende Icon-Palette angleichen):** Hauptflaeche mittleres Blau (#5eb1ec-#0078d4-Bereich), obere/Fluegel-Flaeche etwas heller (Richtung #8ecbf5), untere Rumpf-Falz-Flaeche dunkler (Richtung #106ebe/#004578) fuer den 3D-Facetten-Effekt.

**Schatten:** weicher, dezenter Schlagschatten/Bodenschatten unter dem Flieger (wie bei den anderen drei Icons: flache Ellipse in Grau, kein harter Schatten) -- passend zum restlichen 3D-Facetten-Icon-Stil (Eingang, Quarantaene, Papierkorb).

Damit ist die Form endgueltig festgelegt. Bitte NICHT die Shutterstock-Datei selbst irgendwo im Repo ablegen oder referenzieren -- nur als visuelle Beschreibung/Vorlage fuer ein neu gezeichnetes eigenes Icon nutzen.

**Erster Versuch (Terminal, 25.09., Commit `e0b0130`) war NICHT ausreichend** -- siehe direkt darunter Massimos Nachbesserungs-Meldung dazu, danach hier gleich die eigentliche Loesung.

[2026-09-25] [erledigt: e0e656e] [GESENDET-ICON - Nachbesserung noetig] [iOS] [Bezug: Commit 701f91b, Datei ios/DriftmailApp/Assets.xcassets/FolderIconGesendet.imageset/FolderIconGesendet.png] — Massimo hat sich das gebaute Icon-Set live angeschaut (direkt im Repo als PNG geprueft). Eingang (Briefumschlag), Quarantaene (Warndreieck) und Papierkorb (echter konischer Korb mit Gitterstaeben) treffen die Spec gut, bitte unveraendert lassen.

"Gesendet" ist noch zu reduziert: aktuell nur ein einfacher schmaler Pfeil/Strich in Blau, ohne die in der Spec vom 25.09. ("GESENDET-ICON - endgueltige Form bestaetigt") beschriebenen sichtbaren Faltkanten/Facetten (helle obere Flaeche, dunklere untere Rumpf-Falz-Flaeche, kurzer Heck-Zipfel). Bitte FolderIconGesendet.png (und alle @2x/@3x-Varianten im selben imageset-Ordner) ueberarbeiten: sichtbar als gefalteter Papierflieger mit mind. 2-3 erkennbaren Farbflaechen/Facetten in der bestehenden Blau-Palette (#5eb1ec/#0078d4/#106ebe), nicht nur eine einfarbige Pfeil-Silhouette. Restliche drei Icons bleiben wie sie sind.

**Tatsaechlich geloest (Terminal, 25.09., Commit `e0e656e`):** der Zwischenstand `e0b0130` (helle Fluegel-Flaeche `#8ecbf5` + Heck-Zipfel `#004578`) behielt dieselbe duenne Grundproportion wie das urspruengliche Icon bei -- am tatsaechlichen Anzeigemassstab (24pt, nicht die 256px-Vorschau) blieb es weiterhin wie ein duenner Strich, das Problem war die FORM/Groesse, nicht nur die Farben. Diesmal vor dem Melden explizit bei 24px UND 72px geprueft (nicht nur bei 256px): komplett neu proportioniert als EIN grosses, massives Dreieck (statt einer tief eingeschnittenen V-Form, die bei kleiner Groesse zu viel Substanz wegfrisst), randnah wie die anderen drei Icons, per diagonaler Falzlinie in zwei Facetten geteilt plus kleinem dunklen Heck-Akzent. `contracts/design-tokens.json` `systemFolders.facetIconStyle.gesendet`-Motiv-Text entsprechend aktualisiert. Bei 24pt jetzt eindeutig als zweifarbige Flaeche erkennbar, nicht mehr als Strich. **Offen: Web (Track F)** -- dasselbe (diesmal robuste) Icon fuer die Web-Sidebar.


[2026-09-25] [offen] [APP-ICON (Homescreen) - Papierflieger auf Salbei-Hintergrund] [iOS, Web-Favicon falls vorhanden] [neuer Auftrag, unabhaengig vom In-App-Ordner-Icon-Set] — Massimo: das eigentliche App-Icon (iOS-Homescreen-Icon in AppIcon.appiconset, ggf. auch Web-Favicon/PWA-Icon falls vorhanden) soll ebenfalls den Papierflieger zeigen -- NICHT den offenen Briefumschlag von der driftware.online-Landingpage, sondern denselben Papierflieger, der gerade als "Gesendet"-Ordner-Icon fertiggestellt wurde/wird (finale Form siehe WEB_INBOX.md 25.09. "GESENDET-ICON - endgueltige Form bestaetigt" + Nachbesserung).

**Hintergrund:** leichtes Salbeigruen (nicht das App-interne Outlook-Blau) -- als Flaechenfarbe fuer das quadratische App-Icon, aehnlich dem Salbeigruen-Ton von der driftware.online-Landingpage (dort als Akzent verwendet, siehe driftmail/index.html im driftware-Repo, Farbfamilie um #7f9a72/#5d7752).

**Flieger:** derselbe Papierflieger (Form + Blautoene #5eb1ec/#0078d4/#106ebe/#8ecbf5 aus der bestaetigten Icon-Spec), zentriert auf der Salbei-Flaeche, in den ueblichen Groessen/Skalierungsstufen fuer ein iOS-AppIcon-Set (alle benoetigten @1x/@2x/@3x bzw. px-Groessen gemaess Xcode-Anforderungen).

Bitte bestehendes AppIcon.appiconset ersetzen. Falls es fuer Web ein eigenes Favicon/PWA-Icon-Set gibt, gleiches Motiv dort ebenfalls anwenden, sonst nur iOS.


[2026-09-25] [offen] [APP-ICON - Papierflieger-Form noch nicht getroffen, bitte im echten Build iterieren] [iOS] [gehoert zum Eintrag "APP-ICON (Homescreen) - Papierflieger auf Salbei-Hintergrund" vom selben Tag] — Massimo hat mehrere Chat-Mockups des Papierflieger-Icons durchgesehen, keines hat gepasst (zu nadelartig, Rumpf fehlte, dann "verschlimmbessert"). Genau dieselbe Lehre wie beim Gesendet-Ordner-Icon: SVG-Mockups im Chat sind fuer diese Formfeinheit nicht praezise genug, bitte NICHT weiter hier iterieren, sondern direkt im echten Build/Icon-Editor probieren und Massimo am tatsaechlichen Icon (echte Groesse, z.B. 60pt/180px) entscheiden lassen.

**Referenz-Beschreibung (verbal, keine Bilddatei -- Original-Artwork zeichnen):** klassische Papierflieger-Silhouette, Nase oben-rechts, EIN zusammenhaengender Hauptkoerper (Rumpf+oberer Fluegel als eine Flaeche), UND zusaetzlich ein separates kleines Dreieck ("Kiel"), das unten mittig aus dem Hauptkoerper heraushaengt -- klar erkennbar als eigenes Element, getrennt durch eine duenne Fuge/Falzlinie vom Hauptkoerper (nicht Teil derselben Flaeche). Genau dieser haengende untere Kiel hat in den bisherigen Versuchen gefehlt bzw. wurde falsch getroffen.

**Farbe:** durchgehend ein Hellblau (Familie um #5eb1ec), keine mehrfarbigen Facetten mehr -- nur duenne, etwas dunklere Konturlinien (#2f7cc4 o.ae.) um Rumpf/Kiel/Fluegel-Kanten sichtbar zu machen, falls das dem Rumpf-Erkennungsproblem hilft. Massimo entscheidet final am echten gerenderten Icon, nicht im Chat.


[2026-09-25] [offen] [APP-ICON - Praezisierung: Fugen als Hintergrundfarbe, nicht als Kontur] [iOS] [Ergaenzung zum Eintrag "APP-ICON - Papierflieger-Form noch nicht getroffen" vom selben Tag] — Massimo praezisiert: die Trennung zwischen Hauptkoerper und Kiel soll wie im Referenzbild eine DUENNE FUGE IN DER HINTERGRUNDFARBE sein (also durchscheinendes Salbei-Icon-Hintergrund an den Faltkanten), NICHT eine dunkle/farbige Konturlinie. Das komplette Icon bleibt einfarbig Hellblau (#5eb1ec-Familie), die Faltkanten werden ausschliesslich durch schmale ausgesparte Fugen (Hintergrundfarbe scheint durch) sichtbar, aehnlich wie bei der urspruenglich gezeigten Referenz-Silhouette.
