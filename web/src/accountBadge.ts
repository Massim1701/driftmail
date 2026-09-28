// [2026-09-28] Massimo: "ich sehe nicht, welches Mailkonto die Mail hat,
// womit ich antworte -- logisch waeren zwei Eingaenge mit Logo dahinter".
// Jedes Konto bekommt ein ruhiges, rundes Kennzeichen in der Hausfarbe
// seines Anbieters mit dem Anfangsbuchstaben -- bewusst KEINE nachgebauten
// Markenlogos (Markenrecht), aber sofort wiedererkennbar. Erkennung nur an
// der Domain der Adresse; unbekannte Domains bekommen die Akzentfarbe und
// den Anfangsbuchstaben der Domain.

import type { MailAccount } from "./types";

export interface AccountBadge {
  /** Kurzname des Anbieters, z.B. "Gmail", "GMX", sonst die Domain. */
  label: string;
  letter: string;
  background: string;
  foreground: string;
}

const KNOWN: { domains: string[]; label: string; background: string; foreground?: string }[] = [
  { domains: ["gmail.com", "googlemail.com"], label: "Gmail", background: "#EA4335" },
  { domains: ["gmx.de", "gmx.net", "gmx.at", "gmx.ch"], label: "GMX", background: "#1C449B" },
  { domains: ["web.de"], label: "web.de", background: "#FFD800", foreground: "#3B3B3B" },
  { domains: ["icloud.com", "me.com", "mac.com"], label: "iCloud", background: "#3693F3" },
  { domains: ["outlook.com", "outlook.de", "hotmail.com", "hotmail.de", "live.com", "live.de", "msn.com"], label: "Outlook", background: "#0078D4" },
  { domains: ["yahoo.com", "yahoo.de", "ymail.com", "rocketmail.com"], label: "Yahoo", background: "#6001D2" },
  { domains: ["t-online.de", "magenta.de"], label: "T-Online", background: "#E20074" },
  { domains: ["freenet.de"], label: "freenet", background: "#7AB51D" },
  { domains: ["posteo.de", "posteo.net"], label: "Posteo", background: "#F5A623", foreground: "#3B3B3B" },
  { domains: ["mailbox.org"], label: "mailbox.org", background: "#3DAE2B" },
  { domains: ["aol.com", "aol.de"], label: "AOL", background: "#3D3D3D" },
];

export function accountBadge(account: Pick<MailAccount, "emailAddress">): AccountBadge {
  const domain = account.emailAddress.split("@")[1]?.toLowerCase() ?? "";
  const known = KNOWN.find((k) => k.domains.includes(domain));
  if (known) {
    return {
      label: known.label,
      letter: known.label.charAt(0).toUpperCase(),
      background: known.background,
      foreground: known.foreground ?? "#FFFFFF",
    };
  }
  return {
    label: domain || account.emailAddress,
    letter: (domain.charAt(0) || account.emailAddress.charAt(0) || "?").toUpperCase(),
    background: "var(--color-accent)",
    foreground: "var(--color-on-accent)",
  };
}
