import { Router } from "express";
import { store } from "../db/store";
import { toApiMessage, toApiMessageDetail, toApiMailSummary } from "../mappers";
import { aiAdapter } from "../ai";
import type { AiSource, Folder } from "../types";

export const messagesRouter = Router();

const VALID_FOLDERS: Folder[] = ["wichtig", "sonstiges", "rechnungen", "quarantaene", "spam"];

// GET /messages?folder=&accountId= — siehe api-spec.yaml
messagesRouter.get("/messages", (req, res) => {
  const folder = typeof req.query.folder === "string" ? req.query.folder : undefined;
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  if (folder && !VALID_FOLDERS.includes(folder as Folder)) {
    return res.status(400).json({ error: `ungültiger folder-Wert: ${folder}` });
  }

  const messages = store.listMessages({ folder, accountId });
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
