import { useEffect, useState } from "react";
import type { Folder, MailSummary, MessageDetail } from "../types";
import { api, ApiError } from "../api";
import { SecurityBadge, SecurityDetails } from "./SecurityBadge";
import "./MessageDetailPane.css";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MessageDetailPane({
  message,
  loading,
  folders,
  quarantaeneFolderId,
  papierkorbFolderId,
  onQuarantined,
  onMoved,
  onDeleted,
  onPermanentlyDeleted,
}: {
  message: MessageDetail | null;
  loading: boolean;
  folders: Folder[];
  quarantaeneFolderId: string | null;
  papierkorbFolderId: string | null;
  onQuarantined: (id: string) => void;
  onMoved: (id: string, folderId: string) => void;
  onDeleted: (id: string) => void;
  onPermanentlyDeleted: (id: string) => void;
}) {
  const [summary, setSummary] = useState<MailSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [quarantining, setQuarantining] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [permanentlyDeleting, setPermanentlyDeleting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // Beim Wechsel der Nachricht abgeleiteten Zustand zurücksetzen
  useEffect(() => {
    setSummary(null);
    setDraft(null);
    setSendError(null);
    setSent(false);
    setShowDetails(false);
  }, [message?.id]);

  if (loading) {
    return <div className="detail-pane detail-empty">Lade Nachricht…</div>;
  }
  if (!message) {
    return <div className="detail-pane detail-empty">Wähle eine Nachricht aus der Liste.</div>;
  }

  const isQuarantined = quarantaeneFolderId !== null && message.folderId === quarantaeneFolderId;
  const isInTrash = papierkorbFolderId !== null && message.folderId === papierkorbFolderId;

  async function loadSummary() {
    if (!message) return;
    setSummaryLoading(true);
    try {
      setSummary(await api.getSummary(message.id));
    } finally {
      setSummaryLoading(false);
    }
  }

  async function loadDraft() {
    if (!message) return;
    setDraftLoading(true);
    try {
      const res = await api.createReplyDraft(message.id);
      setDraft(res.draftText);
    } finally {
      setDraftLoading(false);
    }
  }

  async function handleQuarantine() {
    if (!message) return;
    setQuarantining(true);
    try {
      await api.quarantineMessage(message.id);
      onQuarantined(message.id);
    } finally {
      setQuarantining(false);
    }
  }

  async function handleMove(folderId: string) {
    if (!message || !folderId) return;
    setMoving(true);
    try {
      await api.moveMessage(message.id, folderId);
      onMoved(message.id, folderId);
    } finally {
      setMoving(false);
    }
  }

  async function handleDelete() {
    if (!message) return;
    setDeleting(true);
    try {
      await api.deleteMessage(message.id);
      onDeleted(message.id);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSend() {
    if (!message || !draft || !draft.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      const subject = message.subject
        ? message.subject.toLowerCase().startsWith("re:")
          ? message.subject
          : `Re: ${message.subject}`
        : "";
      await api.sendMessage({
        inReplyToMessageId: message.id,
        to: [message.fromAddress],
        subject,
        bodyText: draft,
      });
      setSent(true);
      setDraft(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { reason?: string } | undefined;
        setSendError(body?.reason ?? "Versand wurde aus Sicherheitsgründen blockiert.");
      } else {
        setSendError("Versand fehlgeschlagen. Bitte später erneut versuchen.");
      }
    } finally {
      setSending(false);
    }
  }

  async function handlePermanentDelete() {
    if (!message) return;
    if (!window.confirm("Diese Nachricht endgültig löschen? Das kann nicht rückgängig gemacht werden.")) {
      return;
    }
    setPermanentlyDeleting(true);
    try {
      await api.permanentlyDeleteMessage(message.id);
      onPermanentlyDeleted(message.id);
    } finally {
      setPermanentlyDeleting(false);
    }
  }

  return (
    <div className="detail-pane">
      <header className="detail-header">
        <div className="detail-subject-row">
          <h1>{message.subject}</h1>
          <SecurityBadge classification={message.classification} />
        </div>
        <div className="detail-meta">
          <span>
            <strong>{message.fromDisplayName}</strong> &lt;{message.fromAddress}&gt;
          </span>
          <span>{formatDateTime(message.receivedAt)}</span>
        </div>
      </header>

      {isQuarantined && (
        <div className="quarantine-notice">
          Diese Nachricht liegt in Quarantäne — sie wird automatisch nach 30 Tagen gelöscht,
          falls sie nicht geprüft wird. Öffne nur Links oder Anhänge, wenn du dir absolut sicher bist.
        </div>
      )}

      {isInTrash && (
        <div className="trash-notice">
          Diese Nachricht liegt im Papierkorb. Verschiebe sie über „In Ordner verschieben…“ zurück
          oder lösche sie endgültig — anders als bei Quarantäne gibt es hier keine automatische Frist.
        </div>
      )}

      <section className="detail-section">
        <button type="button" className="link-button" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "Sicherheits-Details ausblenden" : "Sicherheits-Details anzeigen"}
        </button>
        {showDetails && <SecurityDetails security={message.security} />}
      </section>

      <section className="detail-actions">
        {!isQuarantined && !isInTrash && (
          <button type="button" className="btn btn-danger-outline" onClick={handleQuarantine} disabled={quarantining}>
            {quarantining ? "Verschiebe…" : "In Quarantäne verschieben"}
          </button>
        )}
        {!isInTrash && (
          <button type="button" className="btn btn-danger-outline" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Verschiebe…" : "Löschen"}
          </button>
        )}
        {isInTrash && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={handlePermanentDelete}
            disabled={permanentlyDeleting}
          >
            {permanentlyDeleting ? "Lösche…" : "Endgültig löschen"}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={loadSummary} disabled={summaryLoading}>
          {summaryLoading ? "Fasse zusammen…" : "Was wollen die von mir?"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={loadDraft} disabled={draftLoading}>
          {draftLoading ? "Erstelle Entwurf…" : "Antwortentwurf erstellen"}
        </button>
        <select
          className="move-select"
          value=""
          disabled={moving}
          onChange={(e) => {
            if (e.target.value) handleMove(e.target.value);
            e.target.value = "";
          }}
          aria-label="In anderen Ordner verschieben"
        >
          <option value="">{moving ? "Verschiebe…" : "In Ordner verschieben…"}</option>
          {folders
            .filter((f) => f.id !== message.folderId)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
      </section>

      {summary && (
        <section className="detail-card">
          <div className="detail-card-title">Zusammenfassung ({summary.source === "cloud_fallback" ? "Cloud-Fallback" : "On-Device"})</div>
          <p>{summary.summaryText}</p>
          {summary.actionRequired && (
            <p className="summary-action">
              Aktion nötig{summary.deadline ? ` bis ${new Date(summary.deadline).toLocaleDateString("de-DE")}` : ""}
              {summary.actionDescription ? `: ${summary.actionDescription}` : ""}
            </p>
          )}
        </section>
      )}

      {draft && (
        <section className="detail-card">
          <div className="detail-card-title">Antwortentwurf (wird erst nach Klick auf „Senden“ verschickt)</div>
          <textarea
            className="draft-textarea"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSendError(null);
            }}
            rows={6}
          />
          {sendError && <p className="send-error">{sendError}</p>}
          <div className="detail-actions">
            <button type="button" className="btn btn-primary" onClick={handleSend} disabled={sending || !draft.trim()}>
              {sending ? "Sende…" : "Senden"}
            </button>
          </div>
        </section>
      )}

      {sent && (
        <section className="detail-card send-confirmation">
          Antwort an {message.fromAddress} wurde gesendet.
        </section>
      )}

      <section className="detail-body">
        {message.bodyText.split("\n").map((line, i) => (
          <p key={i}>{line || " "}</p>
        ))}
      </section>
    </div>
  );
}
