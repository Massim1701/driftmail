import { Fragment, useMemo, useState, type FormEvent } from "react";
import type { Folder, MailAccount, SystemFolderKey } from "../types";
import {
  BanIcon,
  BrandMark,
  ComposeIcon,
  FileTextIcon,
  FolderIcon,
  InboxIcon,
  PencilIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  ShieldExclamationIcon,
  Trash2Icon,
  TrashIcon,
} from "../icons";
import { FOLDER_ICONS } from "../folderIcons";
import { accountBadge } from "../accountBadge";
import { SYSTEM_FOLDER_META } from "../folderMeta";
import { seasonFor } from "../season";
import { SeasonalTwig } from "../seasonalTwig";
import "./FolderSidebar.css";

function metaFor(folder: Folder) {
  if (folder.isSystem && folder.systemKey) {
    return SYSTEM_FOLDER_META[folder.systemKey];
  }
  return { renamable: true };
}

// [2026-09-28] Redesign "ruhig & warm": einheitliche Linien-Icons für alle
// System-Ordner (die Facetten-Icons vom 25.09. entfallen auf Web), Spam
// bekommt ein eigenes Verbots-Symbol statt des Papierkorbs, damit Spam und
// Papierkorb nicht gleich aussehen. Eigene Ordner behalten ihr Icon aus
// GET /folders.
const SYSTEM_ICONS: Record<SystemFolderKey, typeof FolderIcon> = {
  eingang: InboxIcon,
  entwuerfe: FileTextIcon,
  gesendet: SendIcon,
  sonstiges: FolderIcon,
  quarantaene: ShieldExclamationIcon,
  spam: BanIcon,
  papierkorb: Trash2Icon,
};

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
  onSyncNow,
  isSyncing,
  onNewMessage,
  onOpenSearch,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenSettings,
  onAddAccount,
  displayName,
  onSaveDisplayName,
  inboxCounts,
  onSelectAccountInbox,
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
  /** "Jetzt aktualisieren" (WEB_INBOX.md 21.09. "SEHR WICHTIGE LUECKE -
   * HOECHSTE PRIORITAET", Punkt 1): löst POST /accounts/{accountId}/sync
   * aus, statt auf das automatische Backend-Intervall zu warten. */
  onSyncNow: () => void;
  isSyncing: boolean;
  /** "Neue Nachricht"-Button (WEB_INBOX.md 21.09. "BUG - Massimo beim
   * echten Live-Test entdeckt": fehlender Compose-Button) -- öffnet den
   * ComposeModal in App.tsx im "new"-Modus. */
  onNewMessage: () => void;
  /** [2026-09-28] Redesign: Such-Knopf mit ⌘K-Hinweis fokussiert das
   * bestehende Suchfeld über der Liste (gleiche Wirkung wie ⌘K). */
  onOpenSearch: () => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folderId: string, name: string) => void;
  onDeleteFolder: (folderId: string) => void;
  /** [2026-09-21] WEB_INBOX.md 21.09. "Einstellungsbereich": öffnet den
   * gebündelten SettingsModal in App.tsx. [2026-09-28] Hell/Dunkel/System
   * lebt seit dem Redesign ebenfalls dort (Abschnitt "Ansicht"). */
  onOpenSettings: () => void;
  /** [2026-09-28] Massimo: sichtbarer Knopf für weitere Konten (vorher nur
   * unter Einstellungen → Konten). Öffnet denselben Assistenten wie dort. */
  onAddAccount: () => void;
  /** [2026-09-28] Massimo: der Name des Users steht gross oben, "driftmail"
   * klein darunter. null = noch nicht angegeben -> sanfte Frage "Wie heisst
   * du?" direkt an dieser Stelle. */
  displayName: string | null;
  onSaveDisplayName: (name: string) => void;
  /** [2026-09-28] "zwei Eingaenge mit Logo": Anzahl im Eingang je Konto
   * (accountId -> Anzahl), auch fuer gerade nicht geoeffnete Konten. */
  inboxCounts: Partial<Record<string, number>>;
  /** Oeffnet den Eingang dieses Kontos (wechselt bei Bedarf das Konto). */
  onSelectAccountInbox: (accountId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  // Beim Laden der Sidebar einmal bestimmt -- ein Saisonwechsel mitten in
  // einer offenen Sitzung wird beim nächsten Neuladen sichtbar.
  const season = useMemo(() => seasonFor(new Date()), []);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? accounts[0];
  // [2026-09-28] Bei mehreren Konten stehen die Eingaenge oben je Konto
  // (mit Kennzeichen) -- der Eingang des geoeffneten Kontos wird in der
  // Ordnerliste darunter deshalb nicht noch einmal gezeigt.
  const multiAccount = accounts.length > 1;
  const eingangId = folders.find((f) => f.systemKey === "eingang")?.id ?? null;
  const listedFolders = multiAccount ? folders.filter((f) => f.id !== eingangId) : folders;
  const firstCustomIndex = listedFolders.findIndex((f) => !f.isSystem);

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
    setCreating(false);
  }

  return (
    <nav className="folder-sidebar" aria-label="Ordner">
      <div className="folder-sidebar-brand">
        <SidebarName displayName={displayName} onSave={onSaveDisplayName} />
        <div className="folder-sidebar-brandline">
          <BrandMark width={14} height={14} />
          <span className="folder-sidebar-wordmark">driftmail</span>
        </div>
      </div>

      <button type="button" className="new-message-button" onClick={onNewMessage}>
        <ComposeIcon />
        Neue Nachricht
      </button>

      <button type="button" className="sidebar-search-button" onClick={onOpenSearch}>
        <SearchIcon />
        <span className="sidebar-search-label">Suchen</span>
        <kbd>⌘K</kbd>
      </button>

      {multiAccount && (
        <>
          <div className="sidebar-section-label">Posteingänge</div>
          <ul className="folder-list account-inboxes">
            {accounts.map((a) => {
              const badge = accountBadge(a);
              const isActive = a.id === activeAccountId && active === eingangId;
              const count = inboxCounts[a.id] ?? 0;
              return (
                <li key={a.id}>
                  <div className={`folder-item${isActive ? " active" : ""}`}>
                    <button
                      type="button"
                      className="folder-item-main account-inbox"
                      onClick={() => onSelectAccountInbox(a.id)}
                      aria-current={isActive ? "page" : undefined}
                      title={a.emailAddress}
                    >
                      <AccountBadgeMark account={a} />
                      <span className="account-inbox-text">
                        <span className="folder-label">{badge.label}</span>
                        <span className="account-inbox-address">{a.emailAddress}</span>
                      </span>
                      {count > 0 && <span className="folder-count">{count}</span>}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {activeAccount && (
            <div className="sidebar-section-label sidebar-section-label-account">
              Ordner
              <span className="sidebar-section-account">
                <AccountBadgeMark account={activeAccount} size={14} />
                {accountBadge(activeAccount).label}
              </span>
            </div>
          )}
        </>
      )}

      <ul className="folder-list">
        {listedFolders.map((f, index) => {
          const meta = metaFor(f);
          const Icon = (f.systemKey ? SYSTEM_ICONS[f.systemKey] : undefined) ?? FOLDER_ICONS[f.icon] ?? FolderIcon;
          const isActive = f.id === active;
          const isEditing = editingId === f.id;
          const count = counts[f.id] ?? 0;
          const divider = index === firstCustomIndex && index > 0 ? <li className="folder-divider" aria-hidden="true" /> : null;

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
            <Fragment key={f.id}>
              {divider}
              <li>
                <div
                  className={`folder-item${isActive ? " active" : ""}${meta.colorRole === "danger" ? " warning" : ""}${meta.muted ? " muted" : ""}`}
                >
                  <button
                    type="button"
                    className="folder-item-main"
                    onClick={() => onSelect(f.id)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon className="folder-item-icon" width={18} height={18} />
                    <span className="folder-label" title={f.name}>{f.name}</span>
                    {count > 0 && <span className="folder-count">{count}</span>}
                  </button>
                  {(meta.renamable || !f.isSystem) && (
                  <span className="folder-actions">
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
                  </span>
                  )}
                </div>
              </li>
            </Fragment>
          );
        })}
      </ul>

      {creating ? (
        <div className="folder-create-block">
          <form className="folder-create" onSubmit={submitNewFolder}>
            <input
              type="text"
              placeholder="Name des Ordners"
              value={newFolderName}
              autoFocus
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewFolderName("");
                }
              }}
              aria-label="Name für neuen Ordner"
            />
            <button type="submit" title="Ordner anlegen" aria-label="Ordner anlegen" disabled={!newFolderName.trim()}>
              <PlusIcon />
            </button>
          </form>
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
        </div>
      ) : (
        <button type="button" className="folder-create-toggle" onClick={() => setCreating(true)}>
          <PlusIcon />
          Ordner anlegen
        </button>
      )}

      <div className="folder-sidebar-spacer" />
      <SeasonalTwig season={season} className="folder-sidebar-twig" />

      <button type="button" className="folder-create-toggle sidebar-add-account" onClick={onAddAccount}>
        <PlusIcon />
        Konto hinzufügen
      </button>

      {activeAccount && (
        <div className="folder-sidebar-account-row">
          <AccountBadgeMark account={activeAccount} size={26} />
          <div className="folder-sidebar-account" title={activeAccount.emailAddress}>
            {activeAccount.emailAddress}
          </div>
          <button
            type="button"
            className="sidebar-icon-button"
            onClick={onSyncNow}
            disabled={isSyncing}
            title="Jetzt nach neuer Mail suchen"
            aria-label="Jetzt aktualisieren"
          >
            <RefreshIcon className={isSyncing ? "spinning" : undefined} />
          </button>
          <button type="button" className="sidebar-icon-button" onClick={onOpenSettings} title="Einstellungen" aria-label="Einstellungen">
            <SettingsIcon />
          </button>
        </div>
      )}
    </nav>
  );
}

// [2026-09-28] Rundes Anbieter-Kennzeichen (siehe accountBadge.ts).
export function AccountBadgeMark({ account, size = 22 }: { account: MailAccount; size?: number }) {
  const badge = accountBadge(account);
  return (
    <span
      className="account-badge"
      aria-hidden="true"
      style={{ background: badge.background, color: badge.foreground, width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      {badge.letter}
    </span>
  );
}

// [2026-09-28] Name des Users oben in der Seitenleiste. Ohne Namen eine
// leise Frage statt eines Formulars; ein Klick auf den Namen macht ihn
// direkt hier aenderbar (Enter speichert, Escape bricht ab).
function SidebarName({ displayName, onSave }: { displayName: string | null; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  function start() {
    setValue(displayName ?? "");
    setEditing(true);
  }

  function commit() {
    const name = value.trim();
    if (name && name !== displayName) onSave(name);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="sidebar-name-edit">
        <input
          className="sidebar-name-input"
          autoFocus
          value={value}
          maxLength={80}
          placeholder="Dein Name"
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="Dein Name"
        />
        <span className="sidebar-name-hint">So sehen dich die Empfänger deiner Mails.</span>
      </div>
    );
  }

  return displayName ? (
    <button type="button" className="sidebar-name" onClick={start} title="Namen ändern">
      {displayName}
    </button>
  ) : (
    <button type="button" className="sidebar-name sidebar-name-empty" onClick={start}>
      Wie heißt du?
    </button>
  );
}
