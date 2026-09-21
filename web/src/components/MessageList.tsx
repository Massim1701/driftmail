import { useMemo, useState } from "react";
import type { Message } from "../types";
import { SecurityBadge } from "./SecurityBadge";
import "./MessageList.css";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) +
    " · " +
    d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// [2026-09-21] WEB_INBOX.md "DREI WEITERE FEATURES - Gmail-Recherche"
// Punkt 2 ("Nudge") -- "Vor X Tagen erhalten, antworten?", X aus
// receivedAt selbst berechnet (das Backend liefert nur das boolean-Signal).
function nudgeLabel(receivedAt: string): string {
  const days = Math.max(1, Math.floor((Date.now() - new Date(receivedAt).getTime()) / (24 * 3600 * 1000)));
  return `Vor ${days} ${days === 1 ? "Tag" : "Tagen"} erhalten, antworten?`;
}

// Threaded Ansicht (WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt
// 4) -- gruppiert Nachrichten client-seitig ueber inReplyToMessageId-Ketten,
// AUSSCHLIESSLICH innerhalb der aktuell geladenen Liste (siehe
// backend/README.md "Threaded Ansicht"-Grenze: ein Elternteil in einem
// anderen Ordner, z.B. eine gesendete Antwort auf eine Mail in "eingang",
// bleibt unverknuepft -- kein Cross-Folder-Nachladen, um diese Grenze zu
// umgehen). Jede Gruppe zeigt die NEUESTE Nachricht als sichtbare Zeile,
// der Rest ("aeltere") ist ueber "+N aeltere" aufklappbar. Gruppen der
// Groesse 1 sehen exakt wie vorher aus (kein visueller Unterschied im
// haeufigsten Fall).
interface MessageGroup {
  primary: Message;
  older: Message[];
}

function groupMessages(messages: Message[]): MessageGroup[] {
  const byId = new Map(messages.map((m) => [m.id, m]));

  function rootIdOf(start: Message): string {
    let current = start;
    const seen = new Set<string>([start.id]);
    while (current.inReplyToMessageId) {
      const parent = byId.get(current.inReplyToMessageId);
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      current = parent;
    }
    return current.id;
  }

  const byRoot = new Map<string, Message[]>();
  for (const m of messages) {
    const root = rootIdOf(m);
    const group = byRoot.get(root);
    if (group) group.push(m);
    else byRoot.set(root, [m]);
  }

  const result: MessageGroup[] = [];
  const emittedRoots = new Set<string>();
  for (const m of messages) {
    const root = rootIdOf(m);
    if (emittedRoots.has(root)) continue;
    emittedRoots.add(root);
    const sorted = byRoot.get(root)!.slice().sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1));
    result.push({ primary: sorted[0], older: sorted.slice(1) });
  }
  return result;
}

function MessageRow({
  message,
  selectedId,
  onSelect,
}: {
  message: Message;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`message-row${message.id === selectedId ? " active" : ""}`}
      onClick={() => onSelect(message.id)}
    >
      <div className="message-row-top">
        <span className="message-from">{message.fromDisplayName || message.fromAddress}</span>
        <span className="message-date">{formatDate(message.receivedAt)}</span>
      </div>
      <div className="message-subject">{message.subject}</div>
      {message.classification !== "safe" && <SecurityBadge classification={message.classification} compact />}
      {message.awaitingReply && <div className="message-nudge-hint">{nudgeLabel(message.receivedAt)}</div>}
    </button>
  );
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupMessages(messages), [messages]);

  if (loading) {
    return <div className="message-list-status">Lade Nachrichten…</div>;
  }
  if (messages.length === 0) {
    return <div className="message-list-status">{emptyLabel}</div>;
  }
  return (
    <ul className="message-list">
      {groups.map((g) => {
        const isExpanded = expanded.has(g.primary.id);
        return (
          <li key={g.primary.id}>
            <MessageRow message={g.primary} selectedId={selectedId} onSelect={onSelect} />
            {g.older.length > 0 && (
              <>
                <button
                  type="button"
                  className="message-thread-toggle"
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.primary.id)) next.delete(g.primary.id);
                      else next.add(g.primary.id);
                      return next;
                    })
                  }
                >
                  {isExpanded ? "Ältere ausblenden" : `+${g.older.length} ältere`}
                </button>
                {isExpanded && (
                  <ul className="message-thread-older">
                    {g.older.map((m) => (
                      <li key={m.id}>
                        <MessageRow message={m} selectedId={selectedId} onSelect={onSelect} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
