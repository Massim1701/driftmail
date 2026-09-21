// "Nudge" -- Erinnerung an unbeantwortete Mails (WEB_INBOX.md 21.09. "DREI
// WEITERE FEATURES - Gmail-Recherche" Punkt 2). Rein zur Laufzeit
// abgeleitet (kein eigenes Feld/Cache, gleiches Prinzip wie isNewSender in
// routes/messages.ts) -- eine Nachricht gilt als "wartet auf Antwort", wenn
// sie alt genug ist UND in der DIREKT gegenueberliegenden System-
// Ordner-Richtung (eingang <-> gesendet) desselben Kontos keine Antwort
// existiert. "existiert eine Antwort IRGENDWO" waere zu ungenau -- eine
// weitere Mail desselben externen Absenders im selben Thread (z.B. ein
// Nachfass-Schreiben) landet ebenfalls im eingang-Ordner mit gesetztem
// inReplyToMessageId, zaehlt aber NICHT als Antwort DES USERS.

import { store } from "../db/store";
import type { MessageRecord, MessageSecurityRecord } from "../types";

const DEFAULT_THRESHOLD_DAYS = 3;

function thresholdDays(): number {
  const raw = process.env.NUDGE_THRESHOLD_DAYS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_DAYS;
}

function isOldEnough(receivedAt: string): boolean {
  return Date.now() - new Date(receivedAt).getTime() >= thresholdDays() * 24 * 3600 * 1000;
}

export interface NudgeFolderContext {
  eingangFolderId: string | undefined;
  gesendetFolderId: string | undefined;
}

/** Einmal pro Request/Konto geladen (nicht pro Nachricht) -- die beiden
 * System-Ordner-IDs aendern sich innerhalb eines Requests nie. */
export async function loadNudgeFolderContext(mailAccountId: string): Promise<NudgeFolderContext> {
  const [eingang, gesendet] = await Promise.all([
    store.getSystemFolder(mailAccountId, "eingang"),
    store.getSystemFolder(mailAccountId, "gesendet"),
  ]);
  return { eingangFolderId: eingang?.id, gesendetFolderId: gesendet?.id };
}

export async function computeAwaitingReply(
  message: MessageRecord,
  security: MessageSecurityRecord | undefined,
  nudgeEnabled: boolean,
  folders: NudgeFolderContext,
): Promise<boolean> {
  if (!nudgeEnabled) return false;
  // Verdaechtige Mail soll nicht zum Antworten "einladen".
  if (security?.classification === "spam" || security?.classification === "phishing") return false;
  if (!isOldEnough(message.receivedAt)) return false;

  if (folders.eingangFolderId && message.folderId === folders.eingangFolderId) {
    if (!folders.gesendetFolderId) return true;
    return !(await store.hasReplyInFolder(folders.gesendetFolderId, message.id));
  }
  if (folders.gesendetFolderId && message.folderId === folders.gesendetFolderId) {
    if (!folders.eingangFolderId) return true;
    return !(await store.hasReplyInFolder(folders.eingangFolderId, message.id));
  }
  // Andere Ordner (spam/quarantaene/papierkorb/sonstiges/entwuerfe): nie.
  return false;
}
