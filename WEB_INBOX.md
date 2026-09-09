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


[2026-09-08] [teilweise erledigt: b6b3eb2 (api-spec.yaml-Endpoint, send_abuse_flags-Teil fehlt weiterhin, siehe TERMINAL_INBOX.md + SYNC.md "Offene Fragen"), Track B Erkennungslogik fertig (security-classification/src/draftPhishingCheck.ts, Branch track-b-security), Track A Mock-Route gebaut (backend/src/ai/draftPhishingCheckMock.ts + Route in routes/messages.ts, siehe SYNC.md-Änderungsprotokoll 08.09.) -- echte Integration Mock->Track-B-Logik folgt] [contracts/api-spec.yaml + contracts/db-schema.sql + Track A/B] — Ausgehender Phishing-Check im Composer: erkennt der Composer, dass ein Mail-ENTWURF Phishing-Merkmale hat, darf er NICHT gesendet werden (harter Block, kein Warnen-und-trotzdem-erlauben wie bei den anderen Abuse-Flags aus dem vorherigen Eintrag). Schuetzt driftmail selbst davor, als Phishing-Versandweg missbraucht zu werden (z.B. durch kompromittiertes Geraet/Konto).

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


[2026-09-09] [offen] [PRIORITAET - grosse Luecke] [contracts/api-spec.yaml + Track A + Track C/F] — Massimo hat im laufenden iOS-Simulator getestet: es gibt komplett keinen "Senden"-Button bei Antworten. Verifiziert: api-spec.yaml hat KEINEN einzigen Endpunkt zum tatsaechlichen Versenden einer Mail -- nur POST /messages/{id}/reply-draft (generiert den KI-Entwurfstext) existiert. Ueberraschend, weil bereits viel Infrastruktur um einen Sendevorgang herum gebaut wurde (Phishing-Check vor dem Senden, outgoing_send_log, send_abuse_flags, Bot/Human-Missbrauchserkennung), aber der eigentliche Endpunkt, der das alles auslöst, wurde nie definiert. Echte Contract-Luecke, kein UI-Versehen.

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


[2026-09-09] [offen] [Erweiterung des Send-Endpunkt-Eintrags von eben, contracts/db-schema.sql + contracts/api-spec.yaml + Track A/C/F] — Massimo: Dateianhaenge beim Senden erlauben, aber nur nachdem sie geprueft (gescannt) wurden. Bestehende message_attachments-Tabelle (Anhang-Scan) hat scan_status ('pending'/'clean'/'malicious'/'blocked_type'/'scan_failed') und is_dangerous_type, ist aber ueber message_id an eine bereits existierende (empfangene) Nachricht gebunden -- fuer ausgehende Anhaenge (hochgeladen, BEVOR die gesendete Mail als messages-Zeile existiert) passt das nicht direkt. Vorschlag: message_id in message_attachments nullable machen plus neue Spalte fuer den Fall "Anhang gehoert zu einer noch nicht gesendeten Mail":

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


[2026-09-09] [offen] [GROSSE CONTRACT-AENDERUNG - vorher angekuendigt] [contracts/db-schema.sql + contracts/api-spec.yaml + contracts/design-tokens.json + Track A/C/F] — Massimo: Standard-Ordnerstruktur wird umgebaut. Zwei getrennte Aenderungen, beide klar spezifiziert:

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
