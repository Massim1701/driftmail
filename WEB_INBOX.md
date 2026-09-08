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


[2026-09-08] [offen] [contracts/db-schema.sql + Track B] — Ergaenzung zum Spam-Subcategory-Eintrag von eben: Botnetz-Erkennungssignale, da Botnetz-Spam KEINEN stabilen Absender hat (IP/Domain wechseln staendig, Absender oft gefaelscht/gekaperte Accounts). Erkennung muss auf Infrastruktur-Verhalten zielen, nicht auf Absender-Blocklisten.

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


[2026-09-08] [offen] [Track A + Infra/DNS, nicht akut] — Ausgehende Mail-Authentifizierung ("erkennbar als echte Mail" fuer fremde Mailserver). Zwei getrennte Faelle, WICHTIG nicht verwechseln:

Fall 1 — Versand ueber Nutzer-eigenes Gmail/IMAP-Konto (aktueller Stand):
Braucht KEINE eigene Massnahme. Wenn driftmail ueber die offizielle Gmail API sendet, signiert Google selbst per DKIM — fremde Server sehen "kommt von Google, legitim". Wichtig ist nur: Versand MUSS ueber die offizielle Provider-API laufen (Gmail API / Provider-SMTP mit Auth), nicht ueber einen selbstgebauten SMTP-Client mit gefaelschtem From-Header.

Fall 2 — driftmail bekommt eine eigene Absender-Domain (spaeter, z.B. @driftware.online-Adressen oder System-Benachrichtigungen):
Das ist reine DNS-Konfiguration bei der Domain, KEIN UI-Feature im Compose-Fenster, User sieht davon nichts. Noetig sobald driftmail selbst Mails im eigenen Namen verschickt:
- SPF-Record bei driftware.online: legt fest, welche Server im Namen der Domain senden duerfen.
- DKIM-Signierung: jede ausgehende Mail bekommt eine kryptografische Signatur (Private Key im Backend, Public Key als DNS TXT-Record).
- DMARC-Policy (TXT-Record _dmarc.driftware.online): sagt fremden Servern, was bei SPF/DKIM-Fail passieren soll (reject/quarantine/none), plus Reporting-Adresse.

Kein Blocker jetzt, da Fall 2 noch nicht akut ist (kein eigener Versand-Server aktiv). Bitte trotzdem vormerken: sobald Track A einen eigenen Mail-Versand-Pfad baut (nicht nur Weiterleitung an Provider-APIs), hier nochmal anfragen bevor das live geht — DKIM-Key-Erzeugung und DNS-Eintraege muessen VOR dem ersten eigenen Versand stehen, sonst landet alles automatisch im Spam der Empfaenger.
