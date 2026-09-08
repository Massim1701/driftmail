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

[2026-09-08] [Contract: erledigt 37a22d3 · Track B (Erkennung): erledigt, siehe SYNC.md Track-B-Eintrag auf Branch track-b-security · Track A (Auto-Loeschen-Pfad): offen, laeuft separat] [contracts/db-schema.sql + Track B] — Neue Spam-Unterkategorie fuer aggressives Auto-Loeschen bei eindeutigem Erotik-/Gluecksspiel-Spam (kein Phishing-Risiko dort, daher andere Regel als bei Phishing/Quarantaene).

```sql
ALTER TABLE message_security ADD COLUMN spam_subcategory TEXT
  CHECK (spam_subcategory IN ('adult', 'gambling', 'generic', 'marketing'));
```

Handlungslogik (Track B / Klassifikations-Layer):
- classification = 'spam' UND spam_subcategory IN ('adult','gambling') -> sofort loeschen, KEINE Quarantaene, kein 30-Tage-Aufheben, kein Undo.
- spam_subcategory IN ('generic','marketing') -> Verhalten unveraendert (Spam-Ordner, normale Aufbewahrung).
- classification = 'phishing' -> von dieser Regel komplett unberuehrt, Vorsicht/Quarantaene bleibt Pflicht.

Erkennung laeuft im selben Klassifikations-Layer wie Spam/Phishing (Content-Scan + Keywords, ggf. Bilderkennung bei Anhaengen). Kein Blocker, betrifft primaer Track B; Track A muss ggf. den Auto-Delete-Pfad in der Message-Pipeline ergaenzen (analog zum Quarantaene-Pfad, nur ohne Aufbewahrung).
