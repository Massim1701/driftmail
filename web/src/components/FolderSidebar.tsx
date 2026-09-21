import { useState, type FormEvent } from "react";
import type { Folder } from "../types";
import { FOLDER_ICONS, FolderIcon, LockIcon, MoonIcon, PencilIcon, PlusIcon, RefreshIcon, SunIcon, SystemIcon, TrashIcon, UnlockIcon } from "../icons";
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
  accountEmail,
  onSyncNow,
  isSyncing,
  theme,
  onThemeChange,
  appLockSupported,
  appLockEnabled,
  onAppLockChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  folders: Folder[];
  active: string | null;
  onSelect: (folderId: string) => void;
  counts: Partial<Record<string, number>>;
  accountEmail?: string;
  /** "Jetzt aktualisieren" (WEB_INBOX.md 21.09. "SEHR WICHTIGE LUECKE -
   * HOECHSTE PRIORITAET", Punkt 1): löst POST /accounts/{accountId}/sync
   * aus, statt auf das automatische Backend-Intervall zu warten. */
  onSyncNow: () => void;
  isSyncing: boolean;
  theme: ThemeChoice;
  onThemeChange: (t: ThemeChoice) => void;
  /** Web-Äquivalent zur iOS-App-Sperre (WEB_INBOX.md 19.09. Punkt 3, siehe
   * useAppLock.ts): `appLockSupported` blendet den Schalter komplett aus,
   * wenn der Browser keinen Plattform-Authenticator hat -- kein totes UI. */
  appLockSupported: boolean;
  appLockEnabled: boolean;
  onAppLockChange: (enabled: boolean) => Promise<boolean>;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [appLockPending, setAppLockPending] = useState(false);
  const [appLockError, setAppLockError] = useState(false);

  async function toggleAppLock() {
    setAppLockPending(true);
    setAppLockError(false);
    try {
      const ok = await onAppLockChange(!appLockEnabled);
      if (!ok) setAppLockError(true);
    } finally {
      setAppLockPending(false);
    }
  }

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
      {accountEmail && (
        <div className="folder-sidebar-account-row">
          <div className="folder-sidebar-account">{accountEmail}</div>
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
        </div>
      )}

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

      {appLockSupported && (
        <div className="app-lock-toggle">
          <button
            type="button"
            className={`app-lock-toggle-button${appLockEnabled ? " active" : ""}`}
            onClick={toggleAppLock}
            disabled={appLockPending}
            title={appLockEnabled ? "App-Sperre deaktivieren" : "App-Sperre aktivieren (Face ID/Touch ID/Gerätepasscode)"}
          >
            {appLockEnabled ? <LockIcon /> : <UnlockIcon />}
            <span>{appLockPending ? "…" : appLockEnabled ? "App-Sperre an" : "App-Sperre aus"}</span>
          </button>
          {appLockError && <span className="app-lock-toggle-error">Einrichtung fehlgeschlagen.</span>}
        </div>
      )}
    </nav>
  );
}
