import { useState, type FormEvent } from "react";
import type { Folder } from "../types";
import { FOLDER_ICONS, FolderIcon, MoonIcon, PencilIcon, PlusIcon, SunIcon, SystemIcon, TrashIcon } from "../icons";
import { SYSTEM_FOLDER_META } from "../folderMeta";
import type { ThemeChoice } from "../useTheme";
import "./FolderSidebar.css";

function metaFor(folder: Folder) {
  if (folder.isSystem && folder.systemKey) {
    return SYSTEM_FOLDER_META[folder.systemKey];
  }
  return { renamable: true };
}

export function FolderSidebar({
  folders,
  active,
  onSelect,
  counts,
  accountEmail,
  theme,
  onThemeChange,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: {
  folders: Folder[];
  active: string | null;
  onSelect: (folderId: string) => void;
  counts: Partial<Record<string, number>>;
  accountEmail?: string;
  theme: ThemeChoice;
  onThemeChange: (t: ThemeChoice) => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
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
      {accountEmail && <div className="folder-sidebar-account">{accountEmail}</div>}

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
    </nav>
  );
}
