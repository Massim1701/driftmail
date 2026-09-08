import { Router } from "express";
import { store } from "../db/store";
import { toApiMessage, toApiMessageDetail, toApiMailSummary } from "../mappers";
import { aiAdapter } from "../ai";
import { checkDraftForPhishingMock } from "../ai/draftPhishingCheckMock";
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
messagesRouter.post("/messages/draft/phishing-check", (req, res) => {
  const bodyText = typeof req.body?.bodyText === "string" ? req.body.bodyText : "";
  const rawLinks = Array.isArray(req.body?.links) ? req.body.links : [];

  const links: ApiDraftPhishingCheckLink[] = rawLinks
    .filter((l: unknown): l is Record<string, unknown> => typeof l === "object" && l !== null)
    .map((l: Record<string, unknown>) => ({
      displayText: typeof l.displayText === "string" ? l.displayText : null,
      actualUrl: typeof l.actualUrl === "string" ? l.actualUrl : "",
    }))
    .filter((l: ApiDraftPhishingCheckLink) => l.actualUrl.length > 0);

  const result = checkDraftForPhishingMock(bodyText, links);
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
