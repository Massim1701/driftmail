import type { Request, Response } from "express";
import { Router } from "express";
import { store } from "../db/store";
import { toApiMessage, toApiMessageDetail, toApiMailSummary } from "../mappers";
import { runAiTask } from "../ai";
import { checkDraftForPhishing } from "@driftmail/security-classification";
import { recipientReputationLookup } from "../lookups";
import { adapterForAccount } from "../mail/sync";
import { parseListUnsubscribeHeader, performUnsubscribe } from "../mail/listUnsubscribe";
import { loadNudgeFolderContext, computeAwaitingReply } from "../mail/nudge";
import { sendMessageForUser } from "../mail/sendMessage";
import type { ApiDraftPhishingCheckLink } from "../types";
import type { MailAccountRecord, MessageRecord } from "../types";

// [2026-09-10] echte Auth: Besitz-Prüfung an einer Stelle gebündelt, statt
// in jedem einzelnen `/:messageId`-Handler zu duplizieren. Nachrichten
// haben selbst keine direkte `userId`-Spalte (nur `mail_account_id`,
// siehe db-schema.sql) -- Besitz läuft also über das zugehörige Konto.
// Schreibt bei Fehlschlag direkt die Response (404 bei unbekannter
// messageId, 403 bei fremder), damit die Aufrufer nur noch `if (!owned)
// return;` prüfen müssen.
async function requireOwnMessage(
  req: Request,
  res: Response,
  messageId: string,
): Promise<{ message: MessageRecord; account: MailAccountRecord } | null> {
  const message = await store.getMessage(messageId);
  if (!message) {
    res.status(404).json({ error: "message nicht gefunden" });
    return null;
  }
  const account = await store.getMailAccount(message.mailAccountId);
  if (!account || account.userId !== req.userId) {
    res.status(403).json({ error: "Nachricht gehört nicht zum angemeldeten User" });
    return null;
  }
  return { message, account };
}

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
  result.recipientReputation = await recipientReputationLookup.lookup(req.userId, recipientAddress);

  res.json(result);
});

// POST /messages/send — siehe api-spec.yaml (WEB_INBOX.md 09.09. "Fehlender
// Senden-Endpunkt"). Bisher fehlte trotz vorhandener Infrastruktur drumherum
// (Phishing-Check oben, outgoing_send_log/recordOutgoingSend in db/store.ts)
// der eigentliche Endpunkt, der einen Versand auslöst.
//
// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule Send"): der
// eigentliche Versand-Kern ist jetzt in mail/sendMessage.ts ausgelagert,
// damit der Scheduler beim automatischen Versand eines faelligen Entwurfs
// exakt denselben Weg nimmt (Phishing-Check, Anhang-Gate, outgoing_send_log,
// gesendet-Ordner) -- diese Route ist nur noch ein duenner HTTP-Wrapper.
messagesRouter.post("/messages/send", async (req, res) => {
  const result = await sendMessageForUser(req.userId, req.body ?? {});
  if (!result.ok) return res.status(result.status).json(result.body);
  res.status(200).json({ sentMessageId: result.sentMessageId });
});

// GET /messages?folderId=&accountId= — siehe api-spec.yaml
// CONTRACT-ÄNDERUNG (SYNC.md, Commit 734781e): Query-Param `folder` (Enum)
// -> `folderId` (UUID, verweist auf eine Zeile in folders).
messagesRouter.get("/messages", async (req, res) => {
  const folderId = typeof req.query.folderId === "string" ? req.query.folderId : undefined;
  let accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;
  // [2026-09-21] WEB_INBOX.md 21.09. "2) Suche ueber Mails" -- kombinierbar
  // mit folderId/accountId (z.B. "nur in diesem Ordner suchen"), aber der
  // naheliegendere Client-Weg ist q + accountId OHNE folderId, damit ueber
  // alle Ordner des Kontos gesucht wird (siehe store.listMessages()).
  const q = typeof req.query.q === "string" ? req.query.q : undefined;

  if (folderId) {
    const folder = await store.getFolder(folderId);
    if (!folder) return res.status(400).json({ error: `ungültiger folderId-Wert: ${folderId}` });
    // [2026-09-10] echte Auth: vorher konnte jeder angemeldete User jede
    // beliebige (existierende) folderId übergeben und so fremde Nachrichten
    // sehen -- listMessages() selbst filtert nicht nach User. [2026-09-21]
    // Mehrfach-Konten: Ordner gehören jetzt zu einem Konto, nicht direkt zu
    // einem User -- Ownership über das Konto des Ordners geprüft.
    const folderAccount = await store.getMailAccount(folder.mailAccountId);
    if (!folderAccount || folderAccount.userId !== req.userId) {
      return res.status(403).json({ error: "Ordner gehört nicht zum angemeldeten User" });
    }
    // [2026-09-21] "Nudge" (siehe unten): ohne explizites accountId lässt
    // sich sonst nicht ermitteln, welches Konto die eingang-/gesendet-
    // System-Ordner-IDs hat -- der Ordner selbst kennt sein Konto bereits.
    if (!accountId) accountId = folder.mailAccountId;
  }

  if (accountId) {
    const account = await store.getMailAccount(accountId);
    if (!account || account.userId !== req.userId) {
      return res.status(403).json({ error: "Mail-Konto gehört nicht zum angemeldeten User" });
    }
  } else if (!folderId) {
    // Weder folderId noch accountId angegeben: auf das eigene Konto
    // einschränken statt (wie vorher) ungefiltert ALLE Nachrichten aller
    // User zu liefern -- war bis dahin unkritisch, weil es ohnehin nur den
    // einen Demo-User gab.
    accountId = (await store.getMailAccountByUserId(req.userId))?.id;
  }

  // [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 2
  // ("Nudge"): User-Praeferenz + die beiden System-Ordner-IDs EINMAL pro
  // Request laden, nicht pro Nachricht (siehe mail/nudge.ts).
  const user = await store.getUserById(req.userId);
  const nudgeEnabled = user?.nudgeUnansweredEnabled ?? true;
  const nudgeFolders = accountId && nudgeEnabled
    ? await loadNudgeFolderContext(accountId)
    : { eingangFolderId: undefined, gesendetFolderId: undefined };

  const messages = await store.listMessages({ folderId, accountId, q });
  res.json(
    await Promise.all(
      messages.map(async (m) => {
        const security = await store.getMessageSecurity(m.id);
        const awaitingReply = await computeAwaitingReply(m, security, nudgeEnabled, nudgeFolders);
        return toApiMessage(m, security, awaitingReply);
      }),
    ),
  );
});

// GET /messages/:messageId — siehe api-spec.yaml
messagesRouter.get("/messages/:messageId", async (req, res) => {
  const owned = await requireOwnMessage(req, res, req.params.messageId);
  if (!owned) return;
  const { message } = owned;

  const [security, quarantine, hasOtherMessage, nudgeFolders, user, attachments] = await Promise.all([
    store.getMessageSecurity(message.id),
    store.getQuarantineForMessage(message.id),
    store.hasOtherMessageFromAddress(message.mailAccountId, message.fromAddress, message.id),
    loadNudgeFolderContext(message.mailAccountId),
    store.getUserById(req.userId),
    store.listAttachmentsForMessage(message.id),
  ]);
  const awaitingReply = await computeAwaitingReply(message, security, user?.nudgeUnansweredEnabled ?? true, nudgeFolders);
  res.json(toApiMessageDetail(message, security, quarantine, !hasOtherMessage, awaitingReply, attachments));
});

// POST /messages/:messageId/quarantine — siehe api-spec.yaml
messagesRouter.post("/messages/:messageId/quarantine", async (req, res) => {
  const owned = await requireOwnMessage(req, res, req.params.messageId);
  if (!owned) return;
  const { message } = owned;

  const record = await store.quarantineMessage(message.id, "manuell durch User");
  res.json(record);
});

// POST /messages/:messageId/snooze — siehe api-spec.yaml (WEB_INBOX.md
// 21.09. "5 Wettbewerbs-Luecken" Punkt 5, "Snooze"). `until: null` hebt ein
// bestehendes Snooze sofort wieder auf.
messagesRouter.post("/messages/:messageId/snooze", async (req, res) => {
  const owned = await requireOwnMessage(req, res, req.params.messageId);
  if (!owned) return;
  const { message } = owned;

  const body = req.body as { until?: string | null };
  let until: string | null = null;
  if (body.until !== undefined && body.until !== null) {
    if (typeof body.until !== "string") {
      return res.status(400).json({ error: "until muss ein ISO-Zeitstempel-String oder null sein" });
    }
    const parsed = new Date(body.until);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      return res.status(400).json({ error: "until muss ein gueltiger, in der Zukunft liegender Zeitpunkt sein" });
    }
    until = parsed.toISOString();
  }

  const updated = (await store.snoozeMessage(message.id, until))!;
  const snoozeSecurity = await store.getMessageSecurity(updated.id);
  const snoozeUser = await store.getUserById(req.userId);
  const snoozeAwaitingReply = await computeAwaitingReply(
    updated,
    snoozeSecurity,
    snoozeUser?.nudgeUnansweredEnabled ?? true,
    await loadNudgeFolderContext(updated.mailAccountId),
  );
  res.json(toApiMessage(updated, snoozeSecurity, snoozeAwaitingReply));
});

// POST /messages/:messageId/unsubscribe — siehe api-spec.yaml. War im
// Contract bereits seit Track 0 definiert, aber bisher von keinem Code
// implementiert -- beim Umsetzen der automatischen Abmeldung (WEB_INBOX.md
// 09.09. "Automatisches Abmelden bei Spam", siehe mail/sync.ts) nachgezogen,
// da beide denselben Store-Mechanismus (insertUnsubscribeAction) brauchen.
// NIE Klick auf Links im Mail-Body, nur der sichere List-Unsubscribe-Header-
// Mechanismus.
//
// [2026-09-21] "LUECKE SCHLIESSEN - echter Abmelde-Aufruf" (WEB_INBOX.md
// 21.09.): loest jetzt performUnsubscribe() synchron aus statt nur
// status='pending_confirmation' abzulegen und nie wieder anzufassen (ein
// dauerhafter Endzustand ohne je folgenden Schritt -- die eigentliche
// Luecke). Ergebnis steht bei Rueckgabe fest, kein Rueckfrage-Schritt mehr.
messagesRouter.post("/messages/:messageId/unsubscribe", async (req, res) => {
  const owned = await requireOwnMessage(req, res, req.params.messageId);
  if (!owned) return;
  const { message, account } = owned;

  const parsed = parseListUnsubscribeHeader(message.rawHeaders);
  if (!parsed) {
    return res.status(400).json({ error: "Nachricht hat keinen gültigen List-Unsubscribe-Header" });
  }

  const adapter = adapterForAccount(account);
  const result = await performUnsubscribe(parsed, (input) =>
    adapter.sendMail({ ...input, cc: [], bcc: [], inReplyToMessageIdHeader: null }),
  );

  const action = await store.insertUnsubscribeAction({
    userId: account.userId,
    messageId: message.id,
    method: "manual",
    listUnsubscribeHeaderValue: parsed.raw,
    status: result.status,
    userConfirmedAt: result.status === "confirmed" ? new Date().toISOString() : null,
  });

  res.status(200).json({ status: action.status });
});

// POST /messages/:messageId/move — siehe api-spec.yaml (neu durch die
// Ordner-Contract-Änderung, SYNC.md Commit 734781e)
messagesRouter.post("/messages/:messageId/move", async (req, res) => {
  const owned = await requireOwnMessage(req, res, req.params.messageId);
  if (!owned) return;
  const { message } = owned;

  const folderId = req.body?.folderId;
  if (typeof folderId !== "string" || !folderId) {
    return res.status(400).json({ error: "folderId ist erforderlich" });
  }
  const targetFolder = await store.getFolder(folderId);
  if (!targetFolder) {
    return res.status(400).json({ error: `Ordner nicht gefunden: ${folderId}` });
  }
  // [2026-09-10] echte Auth: verhindert, eine eigene Nachricht in einen
  // fremden Ordner zu verschieben (targetFolder existierte zwar, gehörte
  // aber vorher ungeprüft irgendeinem User). [2026-09-21] Mehrfach-Konten:
  // Ownership über das Konto des Ziel-Ordners, nicht mehr direkt userId.
  const targetAccount = await store.getMailAccount(targetFolder.mailAccountId);
  if (!targetAccount || targetAccount.userId !== req.userId) {
    return res.status(403).json({ error: "Ziel-Ordner gehört nicht zum angemeldeten User" });
  }

  const updated = (await store.moveMessage(message.id, folderId))!;
  const movedSecurity = await store.getMessageSecurity(updated.id);
  const movedUser = await store.getUserById(req.userId);
  const movedAwaitingReply = await computeAwaitingReply(
    updated,
    movedSecurity,
    movedUser?.nudgeUnansweredEnabled ?? true,
    await loadNudgeFolderContext(updated.mailAccountId),
  );
  res.json(toApiMessage(updated, movedSecurity, movedAwaitingReply));
});

// DELETE /messages/:messageId — Mail in den Papierkorb verschieben (soft
// delete), siehe api-spec.yaml. Nachtrag WEB_INBOX.md 08.09. "Fehlende
// Basis-Funktion entdeckt" (Commit 156f0fd, Contract-Teil). Gleiche
// Mechanik wie POST /messages/:messageId/move (kein neuer Mechanismus) --
// nur das Ziel ist fest der Papierkorb-Ordner des Accounts statt eines
// beliebigen, im Body übergebenen Ordners.
messagesRouter.delete("/messages/:messageId", async (req, res) => {
  const owned = await requireOwnMessage(req, res, req.params.messageId);
  if (!owned) return;
  const { message, account } = owned;

  const papierkorb = await store.getSystemFolder(account.id, "papierkorb");
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
  // Papierkorb ist nie eingang/gesendet -- awaitingReply ist hier immer
  // false, keine extra Berechnung noetig (siehe mail/nudge.ts).
  res.status(200).json(toApiMessage(updated, await store.getMessageSecurity(message.id), false));
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
  const owned = await requireOwnMessage(req, res, req.params.messageId);
  if (!owned) return;
  const { message, account } = owned;

  const papierkorb = await store.getSystemFolder(account.id, "papierkorb");
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
  const owned = await requireOwnMessage(req, res, req.params.messageId);
  if (!owned) return;
  const { message } = owned;

  const cached = await store.getMessageAiSummary(message.id);
  if (cached) return res.json(toApiMailSummary(cached));

  // [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): pro-User-Adapterwahl
  // statt des vorher fest verdrahteten Mock-Adapters mit hartcodiertem
  // source="cloud_fallback" (was schon vorher irrefuehrend war -- der Mock
  // lief serverseitig, rief aber nie einen externen Anbieter auf). Siehe
  // src/ai/index.ts runAiTask() fuer BYOK-Routing + Graceful-Fallback.
  const { result: summary, source } = await runAiTask(req.userId, (adapter) => adapter.summarize(message.bodyText ?? ""));
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
  const owned = await requireOwnMessage(req, res, req.params.messageId);
  if (!owned) return;
  const { message } = owned;

  const { result: draftText, source } = await runAiTask(req.userId, (adapter) =>
    adapter.draftReply({
      messages: [
        {
          fromAddress: message.fromAddress,
          subject: message.subject ?? "",
          bodyText: message.bodyText ?? "",
          receivedAt: message.receivedAt,
        },
      ],
    }),
  );

  // [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): source war hier
  // vorher komplett abwesend, siehe api-spec.yaml-Kommentar am Endpunkt.
  res.json({ draftText, source });
});
