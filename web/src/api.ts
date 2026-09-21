// driftmail — schlanker API-Client gegen den Mock-Server
//
// Web nutzt immer Cloud-Fallback-KI (kein On-Device im Browser möglich),
// daher ist AiAdapterResult.source hier stets "cloud_fallback" — der
// Mock-Server liefert diesen Wert bereits in MailSummary.source mit.

import type {
  AttachmentScanStatus,
  Contract,
  Draft,
  Folder,
  MailAccount,
  MailProvider,
  MailSummary,
  Message,
  MessageDetail,
  TrustedSender,
} from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

// [2026-09-10] echte Auth (backend/README.md "Echter Google-Login"): das
// Backend verlangt auf jeder Route außer POST /accounts/GET
// /auth/google/start/callback/POST /auth/session einen gültigen
// `Authorization: Bearer <token>`-Header. Anders als im vorigen Schritt gibt
// es jetzt eine sichtbare Login-UI (LoginScreen.tsx) statt einer impliziten
// festen Demo-Adresse -- der Token kommt aus dem Redirect-Flow
// (GET /auth/google/start -> Google -> GET /auth/google/callback -> Redirect
// zu /auth/callback?token=..., von App.tsx übernommen) und wird für
// nachfolgende Seitenladungen in localStorage gemerkt. Der Mock-Server
// (mock-server/server.mjs) implementiert GET /auth/google/start als
// sofortigen Redirect zu /auth/callback?token=mock-server-token (kein
// echtes Google nötig für lokale UI-Entwicklung), damit derselbe
// Client-Code unverändert gegen Mock- und echtes Backend läuft.
const TOKEN_STORAGE_KEY = "driftmail.token";

// [2026-09-19] WEB_INBOX.md 15.09. "Verschlüsselung der lokalen Mail-
// Datenbank", geprüft für den Web-Client: es gibt hier (noch) keine lokale
// Mail-Datenbank zum Verschlüsseln -- Nachrichten werden bei jedem Laden
// live vom Backend geholt und nur im React-State gehalten, nie in
// localStorage/IndexedDB geschrieben. Der einzige persistierte, sensible
// Wert ist dieser Session-Token. Ehrliche Grenze (kein Web-Crypto-Workaround
// vorgeschlagen): localStorage ist grundsätzlich nicht at-rest-verschlüsselt
// und lässt sich das per Browser-JS auch nicht sinnvoll nachrüsten -- ein
// mit SubtleCrypto verschlüsselter Wert bräuchte einen Schlüssel, der vom
// selben Origin-JS lesbar sein müsste, um den Token wieder zu entschlüsseln,
// und würde damit gegen genau die Bedrohung (XSS im selben Origin) nichts
// gewinnen, vor der Verschlüsselung eigentlich schützen soll. Eine echte
// Verbesserung (z.B. httpOnly-Cookie statt Bearer-Token-in-localStorage)
// wäre eine eigene, groessere Auth-Architektur-Entscheidung -- siehe
// SYNC.md 19.09. "Lokale Mail-Datenbank / Web-Token", nicht Teil dieses
// Schritts.

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // localStorage kann in seltenen Umgebungen (privates Fenster o.ä.) nicht
    // verfügbar sein -- der Token lebt dann nur für die aktuelle Seitenladung
    // im Modul-Singleton weiter (siehe currentToken unten), kein harter Fehler.
  }
  currentToken = token;
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // siehe setStoredToken
  }
  currentToken = null;
}

export function googleLoginUrl(): string {
  return `${BASE_URL}/auth/google/start`;
}

let currentToken: string | null = getStoredToken();

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
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    // Abgelaufener/ungültiger Token: lokal löschen, damit App.tsx beim
    // nächsten Render wieder den LoginScreen zeigt statt in einer Schleife
    // aus 401-Fehlern hängen zu bleiben.
    if (res.status === 401) clearStoredToken();
    throw new ApiError(`API-Fehler ${res.status} bei ${path}`, res.status, body);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export const api = {
  // GET /mail-providers (WEB_INBOX.md 15.09./19.09. "Onboarding: Provider-
  // Auswahlbildschirm") -- oeffentlich (kein Token noetig, security: [] im
  // Contract), treibt die Provider-Karten + IMAP-Preset-Vorbefuellung.
  listMailProviders: () => request<MailProvider[]>("/mail-providers"),

  // POST /accounts mit provider="imap" (api-spec.yaml): Login/Registrierungs-
  // Weg fuer Anbieter ohne OAuth (iCloud/GMX/web.de/generisches IMAP).
  // Ebenfalls oeffentlich -- liefert bei Erfolg einen neuen Session-Token,
  // der Aufrufer (OnboardingScreen) speichert ihn wie beim Google-Callback.
  connectImapAccount: (data: {
    emailAddress: string;
    imapHost: string;
    imapPort?: number;
    imapSecure?: boolean;
    imapUser?: string;
    imapPassword: string;
    smtpHost?: string;
    smtpPort?: number;
    smtpSecure?: boolean;
  }) =>
    request<{ account: MailAccount; token: string }>("/accounts", {
      method: "POST",
      body: JSON.stringify({ provider: "imap", ...data }),
    }),

  listAccounts: () => request<MailAccount[]>("/accounts"),

  // GET /trusted-senders (WEB_INBOX.md 15.09. "Whitelist vertrauenswuerdiger
  // Absender") -- kombiniert sich mit MessageDetail.isNewSender: die "Neuer
  // Absender"-Badge wird nur gezeigt, wenn die Adresse hier NICHT auftaucht.
  listTrustedSenders: () => request<TrustedSender[]>("/trusted-senders"),

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

  // POST /messages/{id}/unsubscribe (WEB_INBOX.md 09.09. "Automatische
  // Abmeldung bei Spam", manueller Pfad) -- nur aufrufbar, wenn
  // MessageDetail.canUnsubscribe=true ist (siehe backend/README.md).
  unsubscribeFromMessage: (id: string) =>
    request<{ status: "pending_confirmation" | "confirmed" | "rejected" }>(`/messages/${id}/unsubscribe`, { method: "POST" }),

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
    attachmentIds?: string[];
    draftId?: string;
  }) => request<{ sentMessageId: string }>("/messages/send", { method: "POST", body: JSON.stringify(data) }),

  // POST /attachments (WEB_INBOX.md 09.09. "Erweiterung des Send-Endpunkt-
  // Eintrags von eben") -- multipart/form-data statt JSON, deshalb kein
  // request()-Aufruf (der setzt Content-Type immer auf application/json;
  // bei FormData muss der Browser den multipart-Boundary-Header selbst
  // setzen). Scan läuft synchron, die Antwort enthält das fertige Ergebnis.
  uploadAttachment: async (file: File): Promise<{ attachmentId: string; scanStatus: AttachmentScanStatus }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE_URL}/attachments`, {
      method: "POST",
      body: form,
      headers: currentToken ? { Authorization: `Bearer ${currentToken}` } : undefined,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      if (res.status === 401) clearStoredToken();
      throw new ApiError(`API-Fehler ${res.status} bei /attachments`, res.status, body);
    }
    return (await res.json()) as { attachmentId: string; scanStatus: AttachmentScanStatus };
  },

  // /drafts (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-
  // Eintrags") -- zeigt im "entwuerfe"-Systemordner an, kommt NICHT aus
  // listMessages(). `createDraft`/`updateDraft` sind für einen künftigen
  // Compose-Screen vorbereitet (siehe App.tsx-Kommentar bei der
  // Entwürfe-Ansicht) -- die aktuelle UI nutzt nur list/delete.
  listDrafts: () => request<Draft[]>("/drafts"),

  createDraft: (data: { inReplyToMessageId?: string; to?: string[]; cc?: string[]; subject?: string; bodyText?: string }) =>
    request<Draft>("/drafts", { method: "POST", body: JSON.stringify(data) }),

  updateDraft: (id: string, data: { to?: string[]; cc?: string[]; subject?: string; bodyText?: string }) =>
    request<Draft>(`/drafts/${id}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteDraft: (id: string) => request<unknown>(`/drafts/${id}`, { method: "DELETE" }),

  listContracts: () => request<Contract[]>("/contracts"),
};
