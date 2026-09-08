import type { Message } from "../types";
import { SecurityBadge } from "./SecurityBadge";
import "./MessageList.css";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) +
    " · " +
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

export function MessageList({
  messages,
  selectedId,
  onSelect,
  loading,
  emptyLabel,
}: {
  messages: Message[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  emptyLabel: string;
}) {
  if (loading) {
    return <div className="message-list-status">Lade Nachrichten…</div>;
  }
  if (messages.length === 0) {
    return <div className="message-list-status">{emptyLabel}</div>;
  }
  return (
    <ul className="message-list">
      {messages.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            className={`message-row${m.id === selectedId ? " active" : ""}`}
            onClick={() => onSelect(m.id)}
          >
            <div className="message-row-top">
              <span className="message-from">{m.fromDisplayName || m.fromAddress}</span>
              <span className="message-date">{formatDate(m.receivedAt)}</span>
            </div>
            <div className="message-subject">{m.subject}</div>
            {m.classification !== "safe" && (
              <SecurityBadge classification={m.classification} compact />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
