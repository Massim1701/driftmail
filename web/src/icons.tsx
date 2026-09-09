// driftmail — kleines, abhängigkeitsfreies Icon-Set
// Nur die Icon-Keys, die contracts/design-tokens.json unter "folders" nutzt,
// plus ein paar UI-Icons für Aktionen.

import type { ReactElement, SVGProps } from "react";

function Svg(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function StarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3.5l2.6 5.4 5.9.7-4.4 4.2 1.1 5.9-5.2-2.9-5.2 2.9 1.1-5.9-4.4-4.2 5.9-.7z" />
    </Svg>
  );
}

export function InboxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 12h4.5l1.5 3h6l1.5-3H21" />
      <path d="M5 12 6.5 5.5A2 2 0 0 1 8.44 4h7.12a2 2 0 0 1 1.94 1.5L19 12v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" />
    </Svg>
  );
}

export function ReceiptIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 3h12v18l-2.5-1.5L13 21l-2.5-1.5L8 21l-2-1.5z" />
      <path d="M9 8h6M9 12h6" />
    </Svg>
  );
}

export function ShieldExclamationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16.2" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function TrashIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
    </Svg>
  );
}

export function Trash2Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-8 0 1 13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-13" />
      <path d="M10 11v6M14 11v6" />
      <path d="M2.5 7h1M20.5 7h1" />
    </Svg>
  );
}

export function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

export function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M16.5 3.5a1.9 1.9 0 0 1 2.7 2.7L7 18.4l-3.5.9.9-3.5z" />
      <path d="M14.5 5.5l2.7 2.7" />
    </Svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

// FOLDER_ICONS: Icon-Keys aus contracts/design-tokens.json "systemFolders.defaults[].icon"
// (star/inbox/receipt/shield-exclamation/trash/trash-2) plus "folder" aus
// "customFolder.defaultIcon" für benutzerdefinierte Ordner ohne eigenes Icon.
export const FOLDER_ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  star: StarIcon,
  inbox: InboxIcon,
  receipt: ReceiptIcon,
  "shield-exclamation": ShieldExclamationIcon,
  trash: TrashIcon,
  "trash-2": Trash2Icon,
  folder: FolderIcon,
};

export function CheckShieldIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z" />
      <path d="M9 12l2 2 4-4.5" />
    </Svg>
  );
}

export function SunIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </Svg>
  );
}

export function MoonIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
    </Svg>
  );
}

export function SystemIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </Svg>
  );
}
