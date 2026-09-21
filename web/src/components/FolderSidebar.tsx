import { useState, type FormEvent } from "react";
import type { Folder, MailAccount } from "../types";
import { FOLDER_ICONS, FolderIcon, MoonIcon, PencilIcon, PlusIcon, RefreshIcon, SendIcon, SettingsIcon, SunIcon, SystemIcon, TrashIcon } from "../icons";
import { SYSTEM_FOLDER_META } from "../folderMeta";
import type { ThemeChoice } from "../useTheme";
import "./FolderSidebar.css";

function metaFor(folder: Folder) {
  if (folder.isSystem && folder.systemKey) {
    return SYSTEM_FOLDER_META[folder.systemKey];
  }
  return { renamable: true };
}

// [2026-09-15] WEB_INBOX.md 10.09. "kleine UX-Ergänzung": "Rechnungen" als
// Ordnername ist negativ behaftet (klingt nach Kosten/Schulden) und deckt
// nicht ab, dass auch Verträge/sonstige wichtige Unterlagen dort landen
// können. Kein System-Ordner-Comeback -- stattdessen nur ein neutraler
// Namensvorschlag als Quick-Pick beim Anlegen eines eigenen Ordners, statt
// eines leeren Textfelds. Reiner Vorschlag: Klick übernimmt den Namen ins
// Textfeld, User kann ihn vor dem Anlegen noch anpassen.
const FOLDER_NAME_SUGGESTIONS = ["Dokumente"];

export function FolderSidebar({
  folders,
  active,
  onSelect,
  counts,
  accounts,
  activeAccountId,
  onSwitchAccount,
  onAddAccount,
  onSyncNow,
  isSyncing,
  onNewMessage,
  theme,
  onThemeChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenSettings,
}: {
  folders: Folder[];
  active: string | null;
  onSelect: (folderId: string) => void;
  counts: Partial<Record<string, number>>;
  /** [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): mehrere
   * Konten statt einer einzelnen accountEmail -- "getrennte Ansichten pro
   * Konto", Umschalten passiert komplett hier in der Sidebar. */
  accounts: MailAccount[];
  activeAccountId: string | null;
  onSwitchAccount: (accountId: string) => void;
  onAddAccount: () => void;
  /** "Jetzt aktualisieren" (WEB_INBOX.md 21.09. "SEHR WICHTIGE LUECKE -
   * HOECHSTE PRIORITAET", Punkt 1): löst POST /accounts/{accountId}/sync
   * aus, statt auf das automatische Backend-Intervall zu warten. */
  onSyncNow: () => void;
  isSyncing: boolean;
  /** "Neue Nachricht"-Button (WEB_INBOX.md 21.09. "BUG - Massimo beim
   * echten Live-Test entdeckt": fehlender Compose-Button) -- öffnet den
   * ComposeModal in App.tsx im "new"-Modus. */
  onNewMessage: () => void;
  theme: ThemeChoice;
  onThemeChange: (t: ThemeChoice) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  /** [2026-09-21] WEB_INBOX.md 21.09. "Einstellungsbereich": öffnet den
   * neuen gebündelten SettingsModal in App.tsx -- App-Sperre und
   * KI-Einstellungen leben jetzt dort, nicht mehr hier direkt in der
   * Sidebar (siehe SettingsModal.tsx). */
  onOpenSettings: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newFolderName, setNewFolderName] = useState("");

  function startEdit(f: Folder) {
    setEditingId(f.id);
    setEditValue(f.name);
  }

  function commitEdit() {
    const name = editValue.trim();
    if (editingId && name) onRenameFolder(editingId, name);
    setEditingId(null);
  }

  function submitNewFolder(e: FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    onCreateFolder(name);
    setNewFolderName("");
  }

  return (
    <nav className="folder-sidebar" aria-label="Ordner">
      <div className="folder-sidebar-brand">
        <span className="brand-dot" aria-hidden="true" />
        driftmail
      </div>

      <button type="button" className="new-message-button" onClick={onNewMessage}>
        <SendIcon />
        Neue Nachricht
      </button>

      {accounts.length > 0 && (
        <div className="folder-sidebar-account-row">
          {accounts.length > 1 ? (
            <select
              className="account-switcher"
              value={activeAccountId ?? ""}
              onChange={(e) => onSwitchAccount(e.target.value)}
              aria-label="Konto wechseln"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emailAddress}
                </option>
              ))}
            </select>
          ) : (
            <div className="folder-sidebar-account">{accounts[0].emailAddress}</div>
          )}
          <button
            type="button"
            className="sync-now-button"
            onClick={onSyncNow}
            disabled={isSyncing}
            title="Jetzt nach neuer Mail suchen"
            aria-label="Jetzt aktualisieren"
          >
            <RefreshIcon className={isSyncing ? "spinning" : undefined} />
          </button>
          <button type="button" className="sync-now-button" onClick={onAddAccount} title="Konto hinzufügen" aria-label="Konto hinzufügen">
            <PlusIcon />
          </button>
        </div>
      )}

      <div className="cmdk-hint" aria-hidden="true">
        <kbd>⌘</kbd>
        <kbd>K</kbd>
        Suche
      </div>

      <ul className="folder-list">
        {folders.map((f) => {
          const meta = metaFor(f);
          const Icon = FOLDER_ICONS[f.icon] ?? FolderIcon;
          const isActive = f.id === active;
          const isEditing = editingId === f.id;

          if (isEditing) {
            return (
              <li key={f.id}>
                <input
                  className="folder-rename-input"
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  aria-label={`${f.name} umbenennen`}
                />
              </li>
            );
          }

          return (
            <li key={f.id}>
              <div
                className={`folder-item${isActive ? " active" : ""}${meta.colorRole === "danger" ? " danger" : ""}${meta.muted ? " muted" : ""}`}
              >
                <button
                  type="button"
                  className="folder-item-main"
                  onClick={() => onSelect(f.id)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon />
                  <span className="folder-label">{f.name}</span>
                  <span className="folder-count">{counts[f.id] ?? 0}</span>
                </button>
                {meta.renamable && (
                  <button
                    type="button"
                    className="folder-action"
                    title="Umbenennen"
                    aria-label={`${f.name} umbenennen`}
                    onClick={() => startEdit(f)}
                  >
                    <PencilIcon />
                  </button>
                )}
                {!f.isSystem && (
                  <button
                    type="button"
                    className="folder-action folder-action-danger"
                    title="Löschen"
                    aria-label={`${f.name} löschen`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Ordner "${f.name}" wirklich löschen? Enthaltene Nachrichten wandern nach "Sonstiges".`
                        )
                      ) {
                        onDeleteFolder(f.id);
                      }
                    }}
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {!newFolderName && (
        <div className="folder-create-suggestions" role="group" aria-label="Namensvorschläge für neuen Ordner">
          {FOLDER_NAME_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="folder-create-suggestion"
              onClick={() => setNewFolderName(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      <form className="folder-create" onSubmit={submitNewFolder}>
        <input
          type="text"
          placeholder="Neuer Ordner…"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          aria-label="Name für neuen Ordner"
        />
        <button type="submit" title="Ordner anlegen" aria-label="Ordner anlegen" disabled={!newFolderName.trim()}>
          <PlusIcon />
        </button>
      </form>

      <div className="theme-switch" role="group" aria-label="Theme">
        <button
          type="button"
          className={theme === "hell" ? "active" : ""}
          onClick={() => onThemeChange("hell")}
          title="Hell"
          aria-label="Helles Theme"
        >
          <SunIcon />
        </button>
        <button
          type="button"
          className={theme === "dunkel" ? "active" : ""}
          onClick={() => onThemeChange("dunkel")}
          title="Dunkel"
          aria-label="Dunkles Theme"
        >
          <MoonIcon />
        </button>
        <button
          type="button"
          className={theme === "system" ? "active" : ""}
          onClick={() => onThemeChange("system")}
          title="System"
          aria-label="Systemeinstellung"
        >
          <SystemIcon />
        </button>
      </div>

      <button type="button" className="settings-entry-button" onClick={onOpenSettings}>
        <SettingsIcon />
        Einstellungen
      </button>
    </nav>
  );
}
