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

[2026-09-08] [erledigt: 37a22d3 (Contract), 881354a (Track A Backend, Auto-Delete-Pfad), Track B siehe eigener Branch] [contracts/db-schema.sql + Track B] — Neue Spam-Unterkategorie fuer aggressives Auto-Loeschen bei eindeutigem Erotik-/Gluecksspiel-Spam (kein Phishing-Risiko dort, daher andere Regel als bei Phishing/Quarantaene).

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


[2026-09-08] [teilweise erledigt: b6b3eb2 (nur api-spec.yaml-Endpoint, send_abuse_flags-Teil fehlt -- siehe TERMINAL_INBOX.md), Track A/B Erkennungslogik folgt] [contracts/api-spec.yaml + contracts/db-schema.sql + Track A/B] — Ausgehender Phishing-Check im Composer: erkennt der Composer, dass ein Mail-ENTWURF Phishing-Merkmale hat, darf er NICHT gesendet werden (harter Block, kein Warnen-und-trotzdem-erlauben wie bei den anderen Abuse-Flags aus dem vorherigen Eintrag). Schuetzt driftmail selbst davor, als Phishing-Versandweg missbraucht zu werden (z.B. durch kompromittiertes Geraet/Konto).

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


[2026-09-08] [erledigt: b6b3eb2 (Contract-Felder in api-spec.yaml), Track A/UI Logik folgt] [Erweiterung des Phishing-Check-Eintrags von eben, contracts/api-spec.yaml + Track A/UI] — Drei zusaetzliche Signale fuer denselben "Check vor dem Senden"-Moment (POST /messages/draft/phishing-check), NICHT als harter Block wie Phishing, sondern als nicht-blockierender Warnhinweis (Sprechblase/Tooltip nahe der betroffenen Textstelle):

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


[2026-09-08] [offen] [PRIORITAET - bitte zuerst] [an Track B, dann A] — Massimo moechte, dass die Warteschlange jetzt konkret abgearbeitet wird, nicht weiter wachsen. Bitte in dieser Reihenfolge:

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
