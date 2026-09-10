import type { Draft } from "../types";
import "./MessageList.css";
import "./DraftList.css";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) +
    " · " +
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  );
}

// Zeigt den Inhalt des "entwuerfe"-Systemordners (GET /drafts, WEB_INBOX.md
// 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags"). Bewusst nur
// Liste + Löschen, kein Bearbeiten -- ein Entwurf-Editor bräuchte einen
// eigenen Compose-Screen (analog "neue Mail verfassen"), der ebenfalls noch
// nicht Teil dieses Clients ist (siehe backend/README.md "Versand").
export function DraftList({
  drafts,
  loading,
  onDelete,
}: {
  drafts: Draft[];
  loading: boolean;
  onDelete: (id: string) => void;
}) {
  if (loading) {
    return <div className="message-list-status">Lade Entwürfe…</div>;
  }
  if (drafts.length === 0) {
    return <div className="message-list-status">Keine Entwürfe.</div>;
  }
  return (
    <ul className="message-list">
      {drafts.map((d) => (
        <li key={d.id}>
          <div className="message-row draft-row">
            <div className="message-row-top">
              <span className="message-from">{d.to.length > 0 ? d.to.join(", ") : "(kein Empfänger)"}</span>
              <span className="message-date">{formatDate(d.updatedAt)}</span>
            </div>
            <div className="message-subject">{d.subject || "(kein Betreff)"}</div>
            {d.bodyText && <div className="draft-preview">{d.bodyText}</div>}
            <button type="button" className="btn btn-danger-outline draft-delete" onClick={() => onDelete(d.id)}>
              Löschen
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
