// driftmail — schlanker API-Client gegen den Mock-Server
//
// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): der bisherige Kommentar
// hier ("Web nutzt immer Cloud-Fallback-KI") ist überholt -- Web versucht
// jetzt VOR jedem Backend-Aufruf für summarize/draftReply zuerst eine
// browser-eigene On-Device-KI (siehe onDeviceAi.ts), source ist nur noch
// "cloud_fallback"/"heuristic", wenn dieser Versuch nicht verfügbar war
// oder fehlschlägt. Kein driftmail-finanzierter Cloud-Key mehr -- Cloud-KI
// läuft nur mit vom User selbst hinterlegtem BYOK-Key (siehe
// getAiSettings/setAiSettings unten).

import type {
  AiSettings,
  AiSource,
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

  // POST /accounts/{accountId}/sync (WEB_INBOX.md 21.09. "SEHR WICHTIGE
  // LUECKE - HOECHSTE PRIORITAET", Punkt 1) -- fuer den "Jetzt
  // aktualisieren"-Button, loest sofort einen Sync aus statt auf das
  // naechste automatische Backend-Intervall zu warten.
  syncAccount: (accountId: string) =>
    request<{ imported: number; autoDeleted: number; syncStatus: MailAccount["syncStatus"] }>(
      `/accounts/${accountId}/sync`,
      { method: "POST" },
    ),

  // GET /trusted-senders (WEB_INBOX.md 15.09. "Whitelist vertrauenswuerdiger
  // Absender") -- kombiniert sich mit MessageDetail.isNewSender: die "Neuer
  // Absender"-Badge wird nur gezeigt, wenn die Adresse hier NICHT auftaucht.
  listTrustedSenders: () => request<TrustedSender[]>("/trusted-senders"),

  // [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): mit
  // accountId nur die Ordner dieses Kontos ("getrennte Ansichten pro
  // Konto"), ohne accountId alle Ordner aller eigenen Konten zusammen.
  listFolders: (accountId?: string) => request<Folder[]>(`/folders${accountId ? `?accountId=${accountId}` : ""}`),

  // accountId erforderlich, sobald mehr als ein Konto verbunden ist (siehe
  // backend/README.md) -- bei genau einem Konto optional (Server leitet es
  // selbst ab).
  createFolder: (data: { name: string; icon?: string; accountId?: string }) =>
    request<Folder>("/folders", { method: "POST", body: JSON.stringify(data) }),

  updateFolder: (folderId: string, data: { name?: string; icon?: string; sortOrder?: number }) =>
    request<Folder>(`/folders/${folderId}`, { method: "PATCH", body: JSON.stringify(data) }),

  deleteFolder: (folderId: string) => request<void>(`/folders/${folderId}`, { method: "DELETE" }),

  // q (WEB_INBOX.md 21.09. "Suche ueber Mails"): Substring-Suche ueber
  // subject/from_address/from_display_name/body_text, kombinierbar mit
  // folderId/accountId (siehe backend/README.md "Suche über Mails").
  listMessages: (params: { folderId?: string; accountId?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.folderId) qs.set("folderId", params.folderId);
    if (params.accountId) qs.set("accountId", params.accountId);
    if (params.q) qs.set("q", params.q);
    const query = qs.toString();
    return request<Message[]>(`/messages${query ? `?${query}` : ""}`);
  },

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

  // [2026-09-21] KORREKTUR: source war hier vorher komplett abwesend
  // (Contract-Lücke, jetzt behoben, siehe backend/README.md "KI-Anbindung
  // (BYOK)").
  createReplyDraft: (id: string) =>
    request<{ draftText: string; source: AiSource }>(`/messages/${id}/reply-draft`, { method: "POST" }),

  // GET/PUT /ai-settings (TERMINAL_INBOX.md 21.09. KORREKTUR): eigene
  // Cloud-KI-Zugangsdaten (BYOK) lesen/setzen. apiKey wird nie
  // zurückgegeben, nur ob einer hinterlegt ist (hasApiKey).
  getAiSettings: () => request<AiSettings>("/ai-settings"),

  setAiSettings: (data: { mode: "off" | "byok"; byokProvider?: "anthropic" | "openai"; apiKey?: string; cloudConsent?: boolean }) =>
    request<AiSettings>("/ai-settings", { method: "PUT", body: JSON.stringify(data) }),

  // POST /messages/send (WEB_INBOX.md 09.09. "Fehlender Senden-Endpunkt").
  // Genau eines von accountId/inReplyToMessageId ist erforderlich (siehe
  // backend/README.md "Versand") -- bei einer Antwort reicht
  // inReplyToMessageId, das Backend leitet das Konto daraus ab.
  sendMessage: (data: {
    accountId?: string;
    inReplyToMessageId?: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
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
