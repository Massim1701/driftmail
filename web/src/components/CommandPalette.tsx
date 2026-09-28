import { useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "../types";
import { api } from "../api";
import { SearchIcon } from "../icons";
import "./CommandPalette.css";

// [2026-09-28] WEB_INBOX.md 27.09. "VIER FEATURES NACH SUPERHUMAN-VORBILD"
// Punkt 1: Befehlspalette per Cmd/Ctrl+K. Ein Eingabefeld, das Befehle
// filtert UND kontoweit Mails sucht. Die Befehle selbst baut App.tsx (dort
// liegen Auswahl, Ordner und alle Handler), diese Komponente kennt nur
// Anzeige, Filter und Tastatur.

export interface PaletteCommand {
  id: string;
  group: string;
  label: string;
  /** Zusätzliche Suchbegriffe, z.B. "snooze" für "Später erinnern". */
  keywords?: string;
  /** Rechts angezeigt, z.B. der aktuelle Wert oder ein Kürzel. */
  hint?: string;
  run: () => void;
}

interface Item {
  key: string;
  group: string;
  label: string;
  hint?: string;
  run: () => void;
}

const MAX_MAIL_RESULTS = 5;

function normalize(s: string): string {
  return s.toLocaleLowerCase("de-DE").normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

// Jedes Wort der Eingabe muss irgendwo in Label/Gruppe/Keywords vorkommen
// ("verschieb arch" findet "Verschieben nach: Archiv"). Treffer am
// Label-Anfang zuerst, sonst bleibt die Reihenfolge aus App.tsx.
function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return commands;
  const scored: { cmd: PaletteCommand; score: number; index: number }[] = [];
  commands.forEach((cmd, index) => {
    const label = normalize(cmd.label);
    const haystack = `${label} ${normalize(cmd.group)} ${normalize(cmd.keywords ?? "")}`;
    if (!words.every((w) => haystack.includes(w))) return;
    scored.push({ cmd, score: label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2, index });
  });
  return scored.sort((a, b) => a.score - b.score || a.index - b.index).map((s) => s.cmd);
}

export function CommandPalette({
  commands,
  accountId,
  onOpenMessage,
  onShowAllResults,
  onClose,
}: {
  commands: PaletteCommand[];
  accountId: string | null;
  onOpenMessage: (message: Message) => void;
  /** Übergibt den Suchbegriff an die normale Suchansicht der Liste. */
  onShowAllResults: (query: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [mailResults, setMailResults] = useState<Message[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  // Mailsuche wie in App.tsx: 250ms entprellt, ab zwei Zeichen, nur im
  // Arbeitsspeicher (kein Mail-Cache im Browser, WEB_INBOX.md 27.09.).
  const trimmed = query.trim();
  useEffect(() => {
    // Unter zwei Zeichen blendet `items` die Mails ohnehin aus.
    if (!accountId || trimmed.length < 2) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      api
        .listMessages({ accountId, q: trimmed })
        .then((msgs) => {
          if (!cancelled) setMailResults(msgs);
        })
        .catch(() => {
          if (!cancelled) setMailResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [accountId, trimmed]);

  const items = useMemo<Item[]>(() => {
    const result: Item[] = filterCommands(commands, trimmed).map((c) => ({
      key: c.id,
      group: c.group,
      label: c.label,
      hint: c.hint,
      run: c.run,
    }));
    if (trimmed.length >= 2) {
      for (const m of mailResults.slice(0, MAX_MAIL_RESULTS)) {
        result.push({
          key: `mail:${m.id}`,
          group: "Mails",
          label: m.subject || "(kein Betreff)",
          hint: m.fromDisplayName || m.fromAddress,
          run: () => onOpenMessage(m),
        });
      }
      result.push({
        key: "mail:all",
        group: "Mails",
        label: `Alle Mails mit „${trimmed}“ anzeigen`,
        run: () => onShowAllResults(trimmed),
      });
    }
    return result;
  }, [commands, trimmed, mailResults, onOpenMessage, onShowAllResults]);

  const safeIndex = Math.min(activeIndex, Math.max(items.length - 1, 0));

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${safeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [safeIndex]);

  function runItem(item: Item | undefined) {
    if (!item) return;
    onClose();
    item.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (Math.min(i, items.length - 1) + 1) % items.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (items.length ? (Math.min(i, items.length - 1) - 1 + items.length) % items.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runItem(items[safeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Befehlspalette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-input-row">
          <SearchIcon className="palette-input-icon" />
          <input
            autoFocus
            className="palette-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // Beim Tippen wieder beim ersten Treffer anfangen.
              setActiveIndex(0);
            }}
            placeholder="Befehl oder Suchbegriff eingeben…"
            aria-label="Befehl oder Suchbegriff"
            aria-controls="palette-list"
            aria-activedescendant={items[safeIndex] ? `palette-item-${safeIndex}` : undefined}
            role="combobox"
            aria-expanded="true"
          />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox" ref={listRef}>
          {items.length === 0 && <li className="palette-empty">Nichts gefunden.</li>}
          {items.map((item, index) => (
            <li key={item.key} role="presentation">
              {(index === 0 || items[index - 1].group !== item.group) && (
                <div className="palette-group" aria-hidden="true">
                  {item.group}
                </div>
              )}
              <div
                id={`palette-item-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === safeIndex}
                className={index === safeIndex ? "palette-item palette-item-active" : "palette-item"}
                onMouseMove={() => index !== safeIndex && setActiveIndex(index)}
                onClick={() => runItem(item)}
              >
                <span className="palette-item-label">{item.label}</span>
                {item.hint && <span className="palette-item-hint">{item.hint}</span>}
              </div>
            </li>
          ))}
        </ul>
        <div className="palette-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> auswählen
          </span>
          <span>
            <kbd>↵</kbd> ausführen
          </span>
        </div>
      </div>
    </div>
  );
}
