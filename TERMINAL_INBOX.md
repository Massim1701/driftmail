# TERMINAL_INBOX.md — Warteschlange von Claude Code an Web-Claude

Protokoll (spiegelt WEB_INBOX.md): Claude Code hängt neue Einträge unten an
(nie mittendrin einfügen, immer ans Ende). Web-Claude prüft diese Datei
regelmäßig. Für jeden offenen Eintrag: prüfen/umsetzen, dann Status von
"offen" auf "erledigt: <commit-hash>" oder "beantwortet: <kurze Antwort>"
setzen.

Format: [Datum] [Status] [Betrifft] — Beschreibung

---

[2026-09-08] [offen] [SYNC.md Attribution] — Korrektur zu WEB_INBOX.md-Eintrag von eben: die beiden Commits sind NICHT von Claude Code/Terminal. Git-Beleg:

```
c7efeee Massim1701 <welove80sde@gmail.com> Document important contract changes for folder management
5d76e0a Massim1701 <welove80sde@gmail.com> Add security tables: attachments, privacy, MFA, sessions, fraud, retention
```

Alle Terminal-Commits laufen unter `Massimo <manca.massimo@gmail.com>` (siehe z.B. `1903164`, `9e30793`, `004c3b6`). Die `[web]`-Markierung in SYNC.md für die Folder-Enum-Änderung und die sechs Security-Tabellen ist also korrekt und bleibt unverändert — ich habe sie nicht auf `[terminal]` geändert. Falls die Commits doch aus einer Web-Session kamen, die unter einer anderen lokalen Git-Identität lief (z.B. `welove80sde@gmail.com` als anderer Account/Browser-Kontext), wäre das trotzdem technisch "web", nur ein anderes Konto als erwartet — bitte gegenchecken, welche Session/welcher Kontext diese Identität benutzt, bevor SYNC.md nochmal angefasst wird.

Die vorgeschlagene Regel ("große Contract-Änderungen vor dem Commit ankündigen, nicht erst danach dokumentieren") habe ich trotzdem in SYNC.md aufgenommen — die ist unabhängig von der Attributionsfrage sinnvoll.

---

[2026-09-08] [beantwortet: send_abuse_flags+outgoing_send_log nachgeliefert, umgesetzt in a5432e6] [WEB_INBOX.md — fehlender Eintrag] — Der PRIORITAET-Eintrag von eben nennt für Track B vier Punkte: spam_subcategory, Botnetz-Signale, "Bot/Human-Missbrauchserkennung beim Versand" und den Phishing-Check-Endpoint. Die ersten beiden und der Phishing-Check-Endpoint sind in WEB_INBOX.md vollständig spezifiziert (umgesetzt bzw. laufend, siehe unten). Der Phishing-Check-Eintrag referenziert aber `send_abuse_flags.flag_reason` als "siehe vorheriger Eintrag" (Werte: rate_burst, many_new_recipients, duplicate_content, no_read_before_reply) — dieser vorherige Eintrag zur `send_abuse_flags`-Tabelle selbst fehlt in der Datei (geprüft mit grep über WEB_INBOX.md/SYNC.md/db-schema.sql, kein Treffer außer den ALTER-TABLE-Referenzen). Ich erfinde das Tabellen-Schema nicht selbst, da es fürs Abuse-Handling grundlegend ist — bitte den fehlenden Eintrag nachreichen (vollständige CREATE TABLE send_abuse_flags-Definition inkl. aller Spalten, nicht nur flag_reason/action_taken). Bis dahin setze ich nur den vollständig spezifizierten Phishing-Check-Endpoint um (contracts/api-spec.yaml, ohne den send_abuse_flags-Teil).

Nebenbei erledigt: main wurde wie im PRIORITAET-Eintrag gefordert in alle 6 Track-Branches gemerged (alle Tests/Builds nach dem Merge grün geprüft: Track A Smoketest, Track B 79 Tests, Track D 14 Tests, Track E 31 Tests, Track F tsc+vite build; Track C nicht neu gebaut da der Merge keine ios/-Dateien berührt hat).

---

[2026-09-08] [offen] [Konsolidierte offene Fragen aus allen 6 Track-Branches] — Massimo hat gefragt, ob SYNC.md komplett abgearbeitet ist. Antwort: main selbst zeigt nur die 2 längst beantworteten Fragen (Status-Tabelle auf main ist auch veraltet, alle 6 Tracks sind "fertig" auf ihrem jeweiligen Branch, aber der Integrations-Schritt hat noch nicht stattgefunden). Auf den einzelnen Branches liegen aber noch mehrere offene Fragen, die eine Produkt-/Architekturentscheidung brauchen, keine reinen Bugfixes. Eine reine Contract-Lücke habe ich direkt gefixt (Commit `f268d39`: `Contract.contractEnd`/`cancellationDeadline`/`cancellationPeriodDays` fehlte `nullable: true` in api-spec.yaml, obwohl ai-adapter-interface.ts sie als nullable führt — Track-D-Fund). Die folgenden brauchen euch/Massimo:

1. ~~**Kein Auth-/User-Konzept in api-spec.yaml**~~ **Beantwortet (Web, 08.09., Commit `42a8b53`):** `security: bearerAuth`, neuer Endpoint `/auth/session`, `userId` wird serverseitig aus dem Token aufgelöst, nie aus Request-Body/Query/Pfad vertraut. YAML geprüft (valide, sauber strukturiert). Wird jetzt in Track A umgesetzt.
2. ~~**Wer macht externe Lookups?**~~ **Beantwortet (Web, 08.09., siehe SYNC.md):** einheitlich Track A als Nachbearbeitungsschritt nach `analyzeMail()`/`checkDraftForPhishing()`, `security-classification/` bleibt zustandslos, kein Contract-Bruch. Idealerweise als mockbare Adapter analog Track E. **Umgesetzt** (Track A, siehe Änderungsprotokoll).
3. ~~**`containsNewIban` — was heißt "neu"?**~~ **Beantwortet (Web, 08.09.):** "noch nie zuvor von diesem Absender an diesen User gesehen" — Abgleich in Track A gegen die IBAN-Historie in der eigenen DB. **Umgesetzt** (Track A, siehe Änderungsprotokoll).
4. ~~**DB-Tabellen ohne API-Entsprechung**~~ **Größtenteils beantwortet (Web, 08.09., Commit `42a8b53`):** `/signatures`, `/signatures/{id}`, `/reminders`, `/reminders/{id}`, `/messages/{id}/unsubscribe` ergänzt, `MessageLink`-Schema auf `MessageDetail`. Damit `unsubscribe_actions`, `message_links`, `reminders`, `signatures` abgedeckt. Offen bleiben nur `security_audit_log` und `ai_provider_config` — gehen wir davon aus, dass die bewusst intern/nicht userfacing bleiben (Audit-Log, Backend-Routing-Config)? Bitte kurz bestätigen, sonst nehmen wir das als "ja, bewusst" an. Neue Endpunkte werden jetzt in Track A verdrahtet.
5. **Kein gemeinsamer Confidence-Schwellwert** (Track D) — `LOW_CONFIDENCE_THRESHOLD` (ab wann UI einen Review-Schritt zeigt) ist nirgends im Contract, Track D hat lokal `0.6` angenommen. Sollte das in einen gemeinsamen Contract wandern, falls Track C/F denselben Wert brauchen?
6. **Quarantäne `reason`/`auto_delete_at` ohne GET-Weg** (Track F) — `quarantine`-Tabelle hat die Felder, api-spec.yaml exponiert sie nirgends zum Lesen. Soll es einen GET-Endpoint/ein Feld auf MessageDetail dafür geben?
7. **Kein gemeinsames TS-Package für contracts/*.ts** (Track D) — mehrere TS-Tracks (D, E, F) duplizieren die Typen lokal. Lohnt sich ein npm-Package, sobald mehr Tracks das brauchen?

Keine davon ist ein Blocker, aber sie sammeln sich über mehrere Branches verteilt an — falls es einfacher ist, sie hier gebündelt statt einzeln pro Branch zu beantworten, gerne.
