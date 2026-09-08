import type { Folder } from "../types";
import { FOLDER_ICONS, MoonIcon, SunIcon, SystemIcon } from "../icons";
import type { ThemeChoice } from "../useTheme";
import "./FolderSidebar.css";

export interface FolderDef {
  key: Folder;
  label: string;
  icon: string;
  colorRole?: "danger";
  muted?: boolean;
}

// 1:1 aus contracts/design-tokens.json "folders" — Reihenfolge ist bewusst so.
export const FOLDERS: FolderDef[] = [
  { key: "wichtig", label: "Wichtig", icon: "star" },
  { key: "sonstiges", label: "Sonstiges", icon: "inbox" },
  { key: "rechnungen", label: "Rechnungen", icon: "receipt" },
  { key: "quarantaene", label: "Quarantäne", icon: "shield-exclamation", colorRole: "danger" },
  { key: "spam", label: "Spam", icon: "trash", muted: true },
];

export function FolderSidebar({
  active,
  onSelect,
  counts,
  accountEmail,
  theme,
  onThemeChange,
}: {
  active: Folder;
  onSelect: (f: Folder) => void;
  counts: Partial<Record<Folder, number>>;
  accountEmail?: string;
  theme: ThemeChoice;
  onThemeChange: (t: ThemeChoice) => void;
}) {
  return (
    <nav className="folder-sidebar" aria-label="Ordner">
      <div className="folder-sidebar-brand">
        <span className="brand-dot" aria-hidden="true" />
        driftmail
      </div>
      {accountEmail && <div className="folder-sidebar-account">{accountEmail}</div>}

      <ul className="folder-list">
        {FOLDERS.map((f) => {
          const Icon = FOLDER_ICONS[f.icon];
          const isActive = f.key === active;
          return (
            <li key={f.key}>
              <button
                type="button"
                className={`folder-item${isActive ? " active" : ""}${f.colorRole === "danger" ? " danger" : ""}${f.muted ? " muted" : ""}`}
                onClick={() => onSelect(f.key)}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon />
                <span className="folder-label">{f.label}</span>
                <span className="folder-count">{counts[f.key] ?? 0}</span>
              </button>
            </li>
          );
        })}
      </ul>

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
