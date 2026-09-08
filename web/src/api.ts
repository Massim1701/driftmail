// driftmail — schlanker API-Client gegen den Mock-Server
//
// Web nutzt immer Cloud-Fallback-KI (kein On-Device im Browser möglich),
// daher ist AiAdapterResult.source hier stets "cloud_fallback" — der
// Mock-Server liefert diesen Wert bereits in MailSummary.source mit.

import type { Contract, MailAccount, MailSummary, Message, MessageDetail, Folder } from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`API-Fehler ${res.status} bei ${path}`);
  }
  return (await res.json()) as T;
}

export const api = {
  listAccounts: () => request<MailAccount[]>("/accounts"),

  listMessages: (folder?: Folder) =>
    request<Message[]>(`/messages${folder ? `?folder=${folder}` : ""}`),

  getMessage: (id: string) => request<MessageDetail>(`/messages/${id}`),

  quarantineMessage: (id: string) =>
    request<unknown>(`/messages/${id}/quarantine`, { method: "POST" }),

  getSummary: (id: string) => request<MailSummary>(`/messages/${id}/summary`),

  createReplyDraft: (id: string) =>
    request<{ draftText: string }>(`/messages/${id}/reply-draft`, { method: "POST" }),

  listContracts: () => request<Contract[]>("/contracts"),
};
