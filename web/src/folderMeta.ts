// driftmail — Client-seitige Ordner-Metadaten
//
// Gespiegelt aus contracts/design-tokens.json "systemFolders.defaults":
// Name/Icon/Reihenfolge der Ordner kommen jetzt aus GET /folders (der User
// kann sie ändern), aber colorRole/muted/renamable sind reine
// Darstellungs-Metadaten für die 5 festen System-Ordner und stehen NICHT im
// Folder-API-Objekt (api-spec.yaml "Folder" hat nur id/name/icon/isSystem/
// systemKey/sortOrder). Bei Änderungen an design-tokens.json hier synchron
// halten (siehe SYNC.md).

import type { SystemFolderKey } from "./types";

export interface SystemFolderMeta {
  colorRole?: "danger";
  muted?: boolean;
  renamable: boolean;
}

export const SYSTEM_FOLDER_META: Record<SystemFolderKey, SystemFolderMeta> = {
  wichtig: { renamable: true },
  sonstiges: { renamable: true },
  rechnungen: { renamable: true },
  quarantaene: { colorRole: "danger", renamable: false },
  spam: { muted: true, renamable: false },
};

// contracts/design-tokens.json "customFolder.defaultIcon"
export const CUSTOM_FOLDER_DEFAULT_ICON = "folder";
