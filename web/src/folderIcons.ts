// driftmail — Zuordnung Icon-Key -> Icon-Komponente fuer Ordner
// [2026-09-28] Aus icons.tsx ausgelagert (WEB_INBOX.md 28.09. "ANTWORT AUF
// LINT-FRAGE - Option (b)"): eine Datei mit Komponenten UND anderen Exporten
// bricht Vites Fast Refresh (oxlint react(only-export-components)).

import type { ReactElement, SVGProps } from "react";
import {
  FileTextIcon,
  FolderIcon,
  InboxIcon,
  ReceiptIcon,
  SendIcon,
  ShieldExclamationIcon,
  StarIcon,
  Trash2Icon,
  TrashIcon,
} from "./icons";

// FOLDER_ICONS: Icon-Keys aus contracts/design-tokens.json "systemFolders.defaults[].icon"
// (inbox/file-pencil/send/shield-exclamation/trash/trash-2, "receipt"/"star"
// bleiben für Bestands-/eigene Ordner wie "Rechnungen" nutzbar) plus "folder"
// aus "customFolder.defaultIcon" für benutzerdefinierte Ordner ohne eigenes
// Icon. [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09.): file-pencil/send neu.
export const FOLDER_ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  star: StarIcon,
  inbox: InboxIcon,
  receipt: ReceiptIcon,
  "shield-exclamation": ShieldExclamationIcon,
  trash: TrashIcon,
  "trash-2": Trash2Icon,
  folder: FolderIcon,
  "file-pencil": FileTextIcon,
  send: SendIcon,
};
