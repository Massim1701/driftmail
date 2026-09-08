import { Router } from "express";
import { store, ensureDemoUser } from "../db/store";
import { toApiMessage, toApiMessageDetail, toApiMailSummary } from "../mappers";
import { aiAdapter } from "../ai";
import { checkDraftForPhishingMock } from "../ai/draftPhishingCheckMock";
import { recipientReputationLookup } from "../lookups";
import type { AiSource, ApiDraftPhishingCheckLink } from "../types";

export const messagesRouter = Router();

// POST /messages/draft/phishing-check — siehe api-spec.yaml (neu seit Commit
// b6b3eb2, WEB_INBOX.md 08.09. "Ausgehender Phishing-Check im Composer" +
// Erweiterung). Registriert VOR den `/:messageId`-Routen unten aus Klarheit
// (funktional egal, da HTTP-Methode + letztes Pfadsegment ohnehin nicht mit
// `/messages/:messageId/quarantine` o.ä. kollidieren). Nutzt eine simple
// Mock-Implementierung (src/ai/draftPhishingCheckMock.ts) nach demselben
// Grundprinzip wie Track B's echte Erkennungslogik
// (security-classification/src/draftPhishingCheck.ts) -- echte Integration
// mit Track B ist ein separater, noch offener Schritt (siehe README/SYNC.md).
messagesRouter.post("/messages/draft/phishing-check", async (req, res) => {
  const bodyText = typeof req.body?.bodyText === "string" ? req.body.bodyText : "";
  const rawLinks = Array.isArray(req.body?.links) ? req.body.links : [];
  // `recipientAddress` (optional, kleine Contract-Ergänzung, siehe
  // api-spec.yaml + SYNC.md Änderungsprotokoll): Grundlage für den
  // Empfänger-Reputations-Lookup unten. Ohne dieses Feld bleibt
  // recipientReputation "unknown", wie bisher.
  const recipientAddress = typeof req.body?.recipientAddress === "string" && req.body.recipientAddress.trim() ? req.body.recipientAddress.trim() : null;

  const links: ApiDraftPhishingCheckLink[] = rawLinks
    .filter((l: unknown): l is Record<string, unknown> => typeof l === "object" && l !== null)
    .map((l: Record<string, unknown>) => ({
      displayText: typeof l.displayText === "string" ? l.displayText : null,
      actualUrl: typeof l.actualUrl === "string" ? l.actualUrl : "",
    }))
    .filter((l: ApiDraftPhishingCheckLink) => l.actualUrl.length > 0);

  const result = checkDraftForPhishingMock(bodyText, links);

  // Empfänger-Reputation als eigener Nachbearbeitungsschritt NACH
  // checkDraftForPhishingMock() (SYNC.md 08.09., Web-Antwort), ersetzt den
  // bisherigen festen "unknown"-Platzhalter. Mock-Implementierung, siehe
  // src/lookups/recipientReputationMock.ts.
  const { user } = ensureDemoUser();
  result.recipientReputation = await recipientReputationLookup.lookup(user.id, recipientAddress);

  res.json(result);
});

// GET /messages?folderId=&accountId= — siehe api-spec.yaml
// CONTRACT-ÄNDERUNG (SYNC.md, Commit 734781e): Query-Param `folder` (Enum)
// -> `folderId` (UUID, verweist auf eine Zeile in folders).
messagesRouter.get("/messages", (req, res) => {
  const folderId = typeof req.query.folderId === "string" ? req.query.folderId : undefined;
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  if (folderId && !store.getFolder(folderId)) {
    return res.status(400).json({ error: `ungültiger folderId-Wert: ${folderId}` });
  }

  const messages = store.listMessages({ folderId, accountId });
  res.json(messages.map((m) => toApiMessage(m, store.getMessageSecurity(m.id))));
});

// GET /messages/:messageId — siehe api-spec.yaml
messagesRouter.get("/messages/:messageId", (req, res) => {
  const message = store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  res.json(toApiMessageDetail(message, store.getMessageSecurity(message.id)));
});

// POST /messages/:messageId/quarantine — siehe api-spec.yaml
messagesRouter.post("/messages/:messageId/quarantine", (req, res) => {
  const message = store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const record = store.quarantineMessage(message.id, "manuell durch User");
  res.json(record);
});

// POST /messages/:messageId/move — siehe api-spec.yaml (neu durch die
// Ordner-Contract-Änderung, SYNC.md Commit 734781e)
messagesRouter.post("/messages/:messageId/move", (req, res) => {
  const message = store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const folderId = req.body?.folderId;
  if (typeof folderId !== "string" || !folderId) {
    return res.status(400).json({ error: "folderId ist erforderlich" });
  }
  if (!store.getFolder(folderId)) {
    return res.status(400).json({ error: `Ordner nicht gefunden: ${folderId}` });
  }

  const updated = store.moveMessage(message.id, folderId)!;
  res.json(toApiMessage(updated, store.getMessageSecurity(updated.id)));
});

// DELETE /messages/:messageId — Mail in den Papierkorb verschieben (soft
// delete), siehe api-spec.yaml. Nachtrag WEB_INBOX.md 08.09. "Fehlende
// Basis-Funktion entdeckt" (Commit 156f0fd, Contract-Teil). Gleiche
// Mechanik wie POST /messages/:messageId/move (kein neuer Mechanismus) --
// nur das Ziel ist fest der Papierkorb-Ordner des Accounts statt eines
// beliebigen, im Body übergebenen Ordners.
messagesRouter.delete("/messages/:messageId", (req, res) => {
  const message = store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const account = store.getMailAccount(message.mailAccountId);
  const papierkorb = account ? store.getSystemFolder(account.userId, "papierkorb") : undefined;
  if (!papierkorb) {
    // Sollte praktisch nie passieren (ensureDemoUser() legt den Ordner
    // immer an), aber sauberer 500 statt eines "undefined"-Absturzes falls
    // doch mal ein User ohne Papierkorb-Ordner existiert (z.B. altes
    // In-Memory-Store-Objekt von vor diesem Feature).
    return res.status(500).json({ error: "Papierkorb-Ordner für dieses Konto nicht gefunden" });
  }

  // TODO(Provider-Spiegelung, siehe WEB_INBOX.md 08.09. Punkt 3 + Auftrag
  // Track A Schritt 4): laut Contract soll dies serverseitig zusätzlich
  // über die Provider-API gespiegelt werden (Gmail API `messages.trash`
  // bzw. IMAP `\Deleted`-Flag setzen), analog zur bereits umgesetzten
  // Provider-Anbindung in src/mail/gmailAdapter.ts/imapAdapter.ts. Dieses
  // Backend hat aktuell nur Lese-/Sync-Zugriff auf Gmail/IMAP (siehe
  // README "Was ist echt, was ist Mock/Stub" -- kein Schreibzugriff
  // implementiert), deshalb bleibt das hier ein Platzhalter/TODO, kein
  // Blocker für diesen Track (gleiche Grenze wie beim restlichen
  // Mock-Adapter-Rand).
  store.moveMessage(message.id, papierkorb.id);
  res.status(200).json(toApiMessage(store.getMessage(message.id)!, store.getMessageSecurity(message.id)));
});

// DELETE /messages/:messageId/permanent — Mail endgültig löschen, siehe
// api-spec.yaml. Nachtrag WEB_INBOX.md 08.09. "Fehlende Basis-Funktion
// entdeckt" (Commit 156f0fd, Contract-Teil).
//
// Design-Entscheidung (2026-09-08, nicht explizit im Auftrag, siehe
// README "Endgültiges Löschen (Papierkorb)"): standardmäßig nur erlaubt,
// wenn sich die Nachricht GERADE im Papierkorb-Ordner befindet, sonst 400
// mit Erklärung. Begründung: der Contract-Endpunkt-Kommentar sagt selbst
// "nur sinnvoll aus dem Papierkorb heraus" -- ohne diese Prüfung könnte
// jede Mail aus jedem Ordner (Posteingang, Quarantäne, ...) ohne den
// Zwischenschritt "erst in den Papierkorb verschieben" endgültig und ohne
// jede Undo-Möglichkeit verschwinden. Das wäre ein Foot-Gun (z.B.
// versehentlicher Klick/API-Call löscht eine wichtige Mail komplett statt
// sie nur in den Papierkorb zu verschieben) und widerspricht dem
// Gmail-Vorbild, an dem sich dieser Nachtrag laut Auftrag orientiert
// (Gmail erlaubt "endgültig löschen" ebenfalls nur aus dem Papierkorb
// heraus über die normale UI).
messagesRouter.delete("/messages/:messageId/permanent", (req, res) => {
  const message = store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const account = store.getMailAccount(message.mailAccountId);
  const papierkorb = account ? store.getSystemFolder(account.userId, "papierkorb") : undefined;
  if (!papierkorb || message.folderId !== papierkorb.id) {
    return res.status(400).json({
      error: "endgültiges Löschen ist nur für Nachrichten im Papierkorb erlaubt -- zuerst DELETE /messages/{messageId} (in den Papierkorb verschieben)",
    });
  }

  // TODO(Provider-Spiegelung, siehe WEB_INBOX.md 08.09. Punkt 3 + Auftrag
  // Track A Schritt 4): laut Contract soll dies zusätzlich die endgültige
  // Löschung beim Provider auslösen (Gmail API `messages.delete` bzw. IMAP
  // `EXPUNGE`). Gleiche Backend-Grenze wie oben bei DELETE
  // /messages/{messageId} -- kein echter Schreibzugriff auf Gmail/IMAP in
  // diesem Durchstich, deshalb hier nur als markierter Platzhalter, kein
  // Blocker.
  store.deleteMessage(message.id);
  res.status(200).json({ deleted: true });
});

// GET /messages/:messageId/summary — siehe api-spec.yaml
// Wird on-demand berechnet (per User-Klick "Was wollen die von mir?") und
// in message_ai_summary gecacht, wie in ai-adapter-interface.ts beschrieben.
messagesRouter.get("/messages/:messageId/summary", async (req, res) => {
  const message = store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const cached = store.getMessageAiSummary(message.id);
  if (cached) return res.json(toApiMailSummary(cached));

  const summary = await aiAdapter.summarize(message.bodyText ?? "");
  const source: AiSource = "cloud_fallback"; // Backend-Mock läuft serverseitig, siehe src/ai/mockAdapter.ts
  const record = {
    messageId: message.id,
    summaryText: summary.summaryText,
    actionRequired: summary.actionRequired,
    actionDescription: summary.actionDescription,
    deadline: summary.deadline,
    source,
    generatedAt: new Date().toISOString(),
  };
  store.setMessageAiSummary(record);
  res.json(toApiMailSummary(record));
});

// POST /messages/:messageId/reply-draft — siehe api-spec.yaml
messagesRouter.post("/messages/:messageId/reply-draft", async (req, res) => {
  const message = store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const draftText = await aiAdapter.draftReply({
    messages: [
      {
        fromAddress: message.fromAddress,
        subject: message.subject ?? "",
        bodyText: message.bodyText ?? "",
        receivedAt: message.receivedAt,
      },
    ],
  });

  res.json({ draftText });
});
