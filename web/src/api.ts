// driftmail — schlanker API-Client gegen den Mock-Server
//
// Web nutzt immer Cloud-Fallback-KI (kein On-Device im Browser möglich),
// daher ist AiAdapterResult.source hier stets "cloud_fallback" — der
// Mock-Server liefert diesen Wert bereits in MailSummary.source mit.

import type { Contract, Folder, MailAccount, MailSummary, Message, MessageDetail } from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

// Erweitert den generischen Fehler um Status + (falls vorhanden) den
// geparsten Response-Body — der Send-Composer (POST /messages/send) braucht
// den Body bei 422, um blocked/reason anzuzeigen statt nur eine generische
// Fehlermeldung.
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(`API-Fehler ${res.status} bei ${path}`, res.status, body);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  listAccounts: () => request<MailAccount[]>("/accounts"),

  listFolders: () => request<Folder[]>("/folders"),

  createFolder: (data: { name: string; icon?: string }) =>
    request<Folder>("/folders", { method: "POST", body: JSON.stringify(data) }),

  updateFolder: (folderId: string, data: { name?: string; icon?: string; sortOrder?: number }) =>
    request<Folder>(`/folders/${folderId}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteFolder: (folderId: string) => request<void>(`/folders/${folderId}`, { method: "DELETE" }),

  listMessages: (folderId?: string) =>
    request<Message[]>(`/messages${folderId ? `?folderId=${folderId}` : ""}`),

  getMessage: (id: string) => request<MessageDetail>(`/messages/${id}`),

  moveMessage: (id: string, folderId: string) =>
    request<Message>(`/messages/${id}/move`, { method: "POST", body: JSON.stringify({ folderId }) }),

  quarantineMessage: (id: string) =>
    request<unknown>(`/messages/${id}/quarantine`, { method: "POST" }),

  // Soft delete: verschiebt die Nachricht in den Papierkorb (analog moveMessage,
  // nur mit fest verdrahtetem Ziel-Ordner serverseitig statt frei wählbarem folderId).
  deleteMessage: (id: string) => request<Message>(`/messages/${id}`, { method: "DELETE" }),

  // Endgültiges Löschen — nur sinnvoll für Nachrichten, die bereits im Papierkorb liegen.
  permanentlyDeleteMessage: (id: string) =>
    request<unknown>(`/messages/${id}/permanent`, { method: "DELETE" }),

  getSummary: (id: string) => request<MailSummary>(`/messages/${id}/summary`),

  createReplyDraft: (id: string) =>
    request<{ draftText: string }>(`/messages/${id}/reply-draft`, { method: "POST" }),

  // POST /messages/send (WEB_INBOX.md 09.09. "Fehlender Senden-Endpunkt").
  // Genau eines von accountId/inReplyToMessageId ist erforderlich (siehe
  // backend/README.md "Versand") -- bei einer Antwort reicht
  // inReplyToMessageId, das Backend leitet das Konto daraus ab.
  sendMessage: (data: {
    accountId?: string;
    inReplyToMessageId?: string;
    to: string[];
    cc?: string[];
    subject?: string;
    bodyText: string;
  }) => request<{ sentMessageId: string }>("/messages/send", { method: "POST", body: JSON.stringify(data) }),

  listContracts: () => request<Contract[]>("/contracts"),
};
