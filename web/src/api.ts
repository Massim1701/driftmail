// driftmail — schlanker API-Client gegen den Mock-Server
//
// Web nutzt immer Cloud-Fallback-KI (kein On-Device im Browser möglich),
// daher ist AiAdapterResult.source hier stets "cloud_fallback" — der
// Mock-Server liefert diesen Wert bereits in MailSummary.source mit.

import type { Contract, Folder, MailAccount, MailSummary, Message, MessageDetail } from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API-Fehler ${res.status} bei ${path}`);
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

  getSummary: (id: string) => request<MailSummary>(`/messages/${id}/summary`),

  createReplyDraft: (id: string) =>
    request<{ draftText: string }>(`/messages/${id}/reply-draft`, { method: "POST" }),

  listContracts: () => request<Contract[]>("/contracts"),
};
