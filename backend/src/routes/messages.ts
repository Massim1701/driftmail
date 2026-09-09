import { Router } from "express";
import { store, ensureDemoUser } from "../db/store";
import { toApiMessage, toApiMessageDetail, toApiMailSummary } from "../mappers";
import { aiAdapter } from "../ai";
import { checkDraftForPhishing } from "@driftmail/security-classification";
import { recipientReputationLookup } from "../lookups";
import { adapterForAccount } from "../mail/sync";
import type { AiSource, ApiDraftPhishingCheckLink } from "../types";
import type { MessageRecord } from "../types";

// Provider-Spiegelung (WEB_INBOX.md 08.09. Punkt 3, umgesetzt 09.09.): ruft
// den passenden Mail-Adapter für das Konto der Nachricht auf. Best-effort
// -- der lokale Store-Zustand (Papierkorb/gelöscht) ist bereits die
// Quelle der Wahrheit für die App selbst, wenn der Provider-Call
// fehlschlägt (Netzwerk, abgelaufenes Token, ...) wird das geloggt, aber
// die lokale Operation NICHT rückgängig gemacht -- ein User soll eine Mail
// in seiner eigenen App-Ansicht auch dann loswerden können, wenn der
// Roundtrip zum Provider gerade klemmt. Kein Mirroring, wenn die Nachricht
// keine `providerMessageId` hat (Fixture-Ursprung).
async function mirrorToProvider(message: MessageRecord, action: "trash" | "permanent"): Promise<void> {
  if (!message.providerMessageId) return;
  const account = await store.getMailAccount(message.mailAccountId);
  if (!account) return;
  try {
    const adapter = adapterForAccount(account);
    if (action === "trash") await adapter.trashMessage(message.providerMessageId);
    else await adapter.permanentlyDeleteMessage(message.providerMessageId);
  } catch (err) {
    console.warn(`Provider-Spiegelung (${action}) für Nachricht ${message.id} fehlgeschlagen:`, err);
  }
}

export const messagesRouter = Router();

// POST /messages/draft/phishing-check — siehe api-spec.yaml (neu seit Commit
// b6b3eb2, WEB_INBOX.md 08.09. "Ausgehender Phishing-Check im Composer" +
// Erweiterung). Registriert VOR den `/:messageId`-Routen unten aus Klarheit
// (funktional egal, da HTTP-Methode + letztes Pfadsegment ohnehin nicht mit
// `/messages/:messageId/quarantine` o.ä. kollidieren). Nutzt seit der
// Integration (09.09., WEB_INBOX.md "Track A + Track B Integration") die
// ECHTE Erkennungslogik aus @driftmail/security-classification statt der
// vorherigen Mock-Implementierung (src/ai/draftPhishingCheckMock.ts, jetzt
// ungenutzt).
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

  // Track B's ExtractedLink verlangt displayText als string (nicht
  // nullable wie im API-Contract) -- fehlender Anzeigetext wird als leerer
  // String übergeben, das Fehlen selbst bleibt dadurch für die
  // Mismatch-Erkennung wirkungslos (kein "Anzeigetext täuscht Domain vor"
  // ohne Anzeigetext).
  const result = checkDraftForPhishing(
    bodyText,
    links.map((l) => ({ displayText: l.displayText ?? "", actualUrl: l.actualUrl })),
  );

  // Empfänger-Reputation als eigener Nachbearbeitungsschritt NACH
  // checkDraftForPhishing() (SYNC.md 08.09., Web-Antwort), ersetzt den
  // von Track B gelieferten festen "unknown"-Wert. Mock-Implementierung,
  // siehe src/lookups/recipientReputationMock.ts.
  const { user } = await ensureDemoUser();
  result.recipientReputation = await recipientReputationLookup.lookup(user.id, recipientAddress);

  res.json(result);
});

// GET /messages?folderId=&accountId= — siehe api-spec.yaml
// CONTRACT-ÄNDERUNG (SYNC.md, Commit 734781e): Query-Param `folder` (Enum)
// -> `folderId` (UUID, verweist auf eine Zeile in folders).
messagesRouter.get("/messages", async (req, res) => {
  const folderId = typeof req.query.folderId === "string" ? req.query.folderId : undefined;
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  if (folderId && !(await store.getFolder(folderId))) {
    return res.status(400).json({ error: `ungültiger folderId-Wert: ${folderId}` });
  }

  const messages = await store.listMessages({ folderId, accountId });
  res.json(await Promise.all(messages.map(async (m) => toApiMessage(m, await store.getMessageSecurity(m.id)))));
});

// GET /messages/:messageId — siehe api-spec.yaml
messagesRouter.get("/messages/:messageId", async (req, res) => {
  const message = await store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const [security, quarantine] = await Promise.all([
    store.getMessageSecurity(message.id),
    store.getQuarantineForMessage(message.id),
  ]);
  res.json(toApiMessageDetail(message, security, quarantine));
});

// POST /messages/:messageId/quarantine — siehe api-spec.yaml
messagesRouter.post("/messages/:messageId/quarantine", async (req, res) => {
  const message = await store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const record = await store.quarantineMessage(message.id, "manuell durch User");
  res.json(record);
});

// POST /messages/:messageId/move — siehe api-spec.yaml (neu durch die
// Ordner-Contract-Änderung, SYNC.md Commit 734781e)
messagesRouter.post("/messages/:messageId/move", async (req, res) => {
  const message = await store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const folderId = req.body?.folderId;
  if (typeof folderId !== "string" || !folderId) {
    return res.status(400).json({ error: "folderId ist erforderlich" });
  }
  if (!(await store.getFolder(folderId))) {
    return res.status(400).json({ error: `Ordner nicht gefunden: ${folderId}` });
  }

  const updated = (await store.moveMessage(message.id, folderId))!;
  res.json(toApiMessage(updated, await store.getMessageSecurity(updated.id)));
});

// DELETE /messages/:messageId — Mail in den Papierkorb verschieben (soft
// delete), siehe api-spec.yaml. Nachtrag WEB_INBOX.md 08.09. "Fehlende
// Basis-Funktion entdeckt" (Commit 156f0fd, Contract-Teil). Gleiche
// Mechanik wie POST /messages/:messageId/move (kein neuer Mechanismus) --
// nur das Ziel ist fest der Papierkorb-Ordner des Accounts statt eines
// beliebigen, im Body übergebenen Ordners.
messagesRouter.delete("/messages/:messageId", async (req, res) => {
  const message = await store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const account = await store.getMailAccount(message.mailAccountId);
  const papierkorb = account ? await store.getSystemFolder(account.userId, "papierkorb") : undefined;
  if (!papierkorb) {
    // Sollte praktisch nie passieren (ensureDemoUser() legt den Ordner
    // immer an), aber sauberer 500 statt eines "undefined"-Absturzes falls
    // doch mal ein User ohne Papierkorb-Ordner existiert (z.B. altes
    // In-Memory-Store-Objekt von vor diesem Feature).
    return res.status(500).json({ error: "Papierkorb-Ordner für dieses Konto nicht gefunden" });
  }

  // Provider-Spiegelung (WEB_INBOX.md 08.09. Punkt 3, umgesetzt 09.09.,
  // siehe mirrorToProvider oben): Gmail `messages.trash` bzw. IMAP
  // `\Deleted`-Flag.
  await mirrorToProvider(message, "trash");
  await store.moveMessage(message.id, papierkorb.id);
  const updated = (await store.getMessage(message.id))!;
  res.status(200).json(toApiMessage(updated, await store.getMessageSecurity(message.id)));
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
messagesRouter.delete("/messages/:messageId/permanent", async (req, res) => {
  const message = await store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const account = await store.getMailAccount(message.mailAccountId);
  const papierkorb = account ? await store.getSystemFolder(account.userId, "papierkorb") : undefined;
  if (!papierkorb || message.folderId !== papierkorb.id) {
    return res.status(400).json({
      error: "endgültiges Löschen ist nur für Nachrichten im Papierkorb erlaubt -- zuerst DELETE /messages/{messageId} (in den Papierkorb verschieben)",
    });
  }

  // Provider-Spiegelung (WEB_INBOX.md 08.09. Punkt 3, umgesetzt 09.09.,
  // siehe mirrorToProvider oben): Gmail `messages.delete` bzw. IMAP
  // `\Deleted`-Flag + Expunge. VOR dem lokalen `deleteMessage()`, weil
  // `message.providerMessageId` danach nicht mehr auflösbar wäre.
  await mirrorToProvider(message, "permanent");
  await store.deleteMessage(message.id);
  res.status(200).json({ deleted: true });
});

// GET /messages/:messageId/summary — siehe api-spec.yaml
// Wird on-demand berechnet (per User-Klick "Was wollen die von mir?") und
// in message_ai_summary gecacht, wie in ai-adapter-interface.ts beschrieben.
messagesRouter.get("/messages/:messageId/summary", async (req, res) => {
  const message = await store.getMessage(req.params.messageId);
  if (!message) return res.status(404).json({ error: "message nicht gefunden" });

  const cached = await store.getMessageAiSummary(message.id);
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
  await store.setMessageAiSummary(record);
  res.json(toApiMailSummary(record));
});

// POST /messages/:messageId/reply-draft — siehe api-spec.yaml
messagesRouter.post("/messages/:messageId/reply-draft", async (req, res) => {
  const message = await store.getMessage(req.params.messageId);
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
