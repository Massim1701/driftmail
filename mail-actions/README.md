# mail-actions — Track E: Antwortentwürfe & Signatur-Verwaltung

Reine Backend-Logik, kein UI. Implementiert gegen `contracts/ai-adapter-interface.ts`
(`draftReply`) und `contracts/db-schema.sql` (Tabelle `signatures`).

## Umfang

- `src/draftReply.ts` — `draftReply(thread): Promise<string>`, Contract-konform.
  Aktuell **Platzhalter/Template-Logik** (kein Modell, kein Netzwerk), klar
  markiert für den späteren Austausch gegen echte KI-Generierung.
- `src/signatures.ts` — Auswahl-Regeln für `apply_to_new` / `apply_to_replies` /
  `is_default` (echte, getestete Logik, kein Platzhalter) plus ein
  In-Memory-`SignatureStore` als Stand-in für die Track-A-DB-Anbindung.
- `src/types.ts` — importiert `MailThread`/`AiSource` direkt aus dem Contract
  (`contracts/ai-adapter-interface.ts`), statt sie zu duplizieren; spiegelt
  zusätzlich `signatures` aus `db-schema.sql` als `SignatureRecord`.

## Setup & Tests

```bash
cd mail-actions
npm install
npm test          # vitest run — 28 Tests
npm run typecheck # tsc --noEmit
```

## Signatur-Auswahlregel (`selectSignatureForContext`)

1. Nur Signaturen des angegebenen `mail_account_id`.
2. Nur Signaturen mit gesetztem Flag für den Kontext (`apply_to_new` für neue
   Mails, `apply_to_replies` für Antworten).
3. Genau ein Treffer → der wird verwendet.
4. Mehrere Treffer → `is_default` entscheidet; bei weiterhin mehrdeutigem
   oder fehlendem Default wird deterministisch der erste Eintrag (Array-
   Reihenfolge) genommen, statt zufällig zu wählen.
5. Kein Treffer → `null`. Es wird **nichts** automatisch angehängt.

`SignatureStore` (In-Memory-Repository) erzwingt zusätzlich die Invariante
"höchstens eine Default-Signatur pro Account" bei `create`/`setDefault`/`update`,
da das DB-Schema das selbst **nicht** über einen Constraint absichert.

## Annahmen (nicht 100% aus dem Contract ableitbar)

Diese Punkte habe ich selbst entschieden, weil sie im Contract offen sind, aber
für Track A/C/F relevant sein könnten (siehe auch SYNC.md → "Offene Fragen"):

1. **Kein Fallback auf `is_default`, wenn keine Signatur für den Kontext
   freigeschaltet ist.** D.h. eine Default-Signatur mit `apply_to_replies =
   false` wird bei Antworten NICHT automatisch angehängt, auch wenn sie die
   einzige Signatur des Accounts ist. Alternative Interpretation wäre: Default
   greift immer als letzter Fallback. Ich halte "Flag explizit aus = Nutzer
   wollte das so" für die sicherere Default-Annahme (kein ungewolltes
   Anhängen), aber das ist eine Produktentscheidung.
2. **Erste Signatur eines Accounts wird beim Anlegen automatisch `is_default`.**
   Ein Account soll nie ganz ohne Default-Signatur dastehen.
3. **Löschen der Default-Signatur befördert automatisch die nächste
   verbleibende Signatur zum neuen Default** (statt den Account ohne Default
   zurückzulassen).
4. **`draftReply` bekommt keinen `mail_account_id`-Parameter** (Contract-Signatur
   ist fix: `draftReply(thread: MailThread): Promise<string>`). Deshalb kann
   `draftReply` selbst keine Signatur anhängen — das übernimmt der zusätzliche
   Helfer `composeReplyDraft(thread, mailAccountId, signatures)`, den eine
   Backend-Route (z.B. `/messages/{id}/reply-draft`) aufrufen würde. Reines
   `draftReply` liefert nur den Antworttext ohne Signatur.
5. **Reihenfolge von `thread.messages` ist aufsteigend chronologisch**
   (`MailThread` im Contract macht dazu keine Aussage). `draftReply` nimmt
   das letzte Array-Element als "letzte Nachricht".
6. **Absendername für die Anrede** wird grob aus dem Local-Part der
   `fromAddress` geraten (`jane.doe@x.com` → "Jane Doe"), weil `MailThread`
   keinen separaten Display-Namen führt. Bewusst best-effort, keine
   Namenserkennung.

## Was für echte KI-Generierung fehlen würde

`generateReplyDraftText` in `src/draftReply.ts` ist die markierte Stelle.
Eine echte Implementierung bräuchte:

- On-Device-Modell-Versuch (analog zu `analyzeMail`/`summarize`, siehe
  `user_ai_capability` in `db-schema.sql`), sonst Cloud-Fallback über den
  Provider aus `ai_provider_config` mit `task_type = 'reply_draft'`.
- Den vollständigen Thread als Kontext (nicht nur die letzte Nachricht) —
  inkl. Tonalität/Sprache der bisherigen Konversation.
- Eine Quellenangabe (`on_device` / `cloud_fallback`), die aber die aktuelle
  `draftReply`-Signatur laut Contract (`Promise<string>`) nicht transportiert
  — anders als bei `AiAdapterResult<T>`. Das habe ich als offene Frage in
  SYNC.md eingetragen, statt eigenmächtig die Contract-Signatur zu ändern.
- Rate-Limiting/Quota-Handling gegen `daily_quota_used`/`quota_reset_at`.

## Kein UI

Der Contract-Kommentar zu `draftReply` ("Ergebnis geht nie automatisch raus,
immer Review/Edit/Send durch User") ist **nicht** Teil dieses Moduls — das
muss die aufrufende UI/Backend-Schicht durchsetzen. Dieses Modul liefert nur
Text.
