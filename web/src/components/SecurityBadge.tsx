import type { Classification, SecurityResult } from "../types";
import { CheckShieldIcon, ShieldExclamationIcon } from "../icons";
import "./SecurityBadge.css";

// [2026-09-21] WEB_INBOX.md 19.09. "Sichtbare Kennzeichen/Badges fuer die
// neuen Sicherheitssignale": eigene, kompakte Pill-Badges fuer die vier
// Signale, die es bisher nur in den aufklappbaren Sicherheits-Details gab
// (SecurityDetails unten) -- sollen im Header der Nachricht sofort sichtbar
// sein, nicht erst nach einem Klick auf "Details anzeigen". Nutzt dieselbe
// tone-{role}-Konvention wie SecurityBadge/-Details (siehe SecurityBadge.css),
// keine neue visuelle Sprache.
export interface SecuritySignal {
  key: string;
  label: string;
  tone: "warning" | "danger";
}

export function securitySignalsFor(
  security: Pick<SecurityResult, "displayNameSpoofingDetected" | "replyToMismatchDetected" | "ibanChangedInThread">,
  options: { isNewSender: boolean } = { isNewSender: false },
): SecuritySignal[] {
  const signals: SecuritySignal[] = [];
  if (security.displayNameSpoofingDetected) {
    signals.push({ key: "display-name-spoofing", label: "Anzeigename gefälscht", tone: "danger" });
  }
  if (security.replyToMismatchDetected) {
    signals.push({ key: "reply-to-mismatch", label: "Antwort-Adresse weicht ab", tone: "danger" });
  }
  if (security.ibanChangedInThread) {
    signals.push({ key: "iban-changed-in-thread", label: "IBAN im Verlauf geändert", tone: "danger" });
  }
  // isNewSender wird bewusst vom Aufrufer schon mit GET /trusted-senders
  // abgeglichen übergeben (api-spec.yaml-Vorgabe: Badge nur bei
  // isNewSender=true UND Absender nicht auf der Whitelist) -- diese
  // Funktion selbst kennt die Trusted-Sender-Liste nicht.
  if (options.isNewSender) {
    signals.push({ key: "new-sender", label: "Neuer Absender", tone: "warning" });
  }
  return signals;
}

export function SecuritySignalBadges({
  security,
  isNewSender = false,
  compact = false,
  onTrustSender,
}: {
  security: Pick<SecurityResult, "displayNameSpoofingDetected" | "replyToMismatchDetected" | "ibanChangedInThread">;
  isNewSender?: boolean;
  compact?: boolean;
  /** [2026-09-21] WEB_INBOX.md 21.09. "KLEINE VERKNUEPFUNG - Neuer-
   * Absender-Badge mit Whitelist verbinden": direkt am "Neuer Absender"-
   * Badge zur Whitelist hinzufügen können, statt erst über die
   * Einstellungen suchen zu müssen. Nur sichtbar/relevant, wenn dieses
   * Badge auch tatsächlich gerendert wird (isNewSender=true) -- sonst kein
   * totes UI-Element. Nicht in `compact`-Ansichten (Listenzeilen), nur in
   * der Detailansicht, wo genug Platz für die Aktion ist. */
  onTrustSender?: () => void;
}) {
  const signals = securitySignalsFor(security, { isNewSender });
  if (signals.length === 0) return null;
  return (
    <>
      {signals.map((s) => (
        <span key={s.key} className={`security-badge tone-${s.tone}${compact ? " compact" : ""}`}>
          <ShieldExclamationIcon width={compact ? 12 : 14} height={compact ? 12 : 14} />
          {s.label}
          {s.key === "new-sender" && !compact && onTrustSender && (
            <button type="button" className="security-badge-action" onClick={onTrustSender}>
              Absender vertrauen
            </button>
          )}
        </span>
      ))}
    </>
  );
}

const LABEL: Record<Classification, string> = {
  safe: "Sicher",
  unclear: "Unklar",
  spam: "Spam",
  phishing: "Phishing-Verdacht",
};

export function classificationTone(c: Classification): "success" | "warning" | "danger" {
  if (c === "safe") return "success";
  if (c === "unclear") return "warning";
  return "danger"; // spam | phishing
}

export function SecurityBadge({ classification, compact = false }: { classification: Classification; compact?: boolean }) {
  const tone = classificationTone(classification);
  const Icon = tone === "success" ? CheckShieldIcon : ShieldExclamationIcon;
  return (
    <span className={`security-badge tone-${tone}${compact ? " compact" : ""}`}>
      <Icon width={compact ? 12 : 14} height={compact ? 12 : 14} />
      {LABEL[classification]}
    </span>
  );
}

function statusTone(status: "pass" | "fail" | "none"): "success" | "warning" | "danger" {
  if (status === "pass") return "success";
  if (status === "none") return "warning";
  return "danger";
}

export function SecurityDetails({ security }: { security: SecurityResult }) {
  const rows: Array<{ label: string; value: string; tone?: "success" | "warning" | "danger" }> = [
    { label: "SPF", value: security.spfStatus, tone: statusTone(security.spfStatus) },
    { label: "DKIM", value: security.dkimStatus, tone: statusTone(security.dkimStatus) },
    { label: "DMARC", value: security.dmarcStatus, tone: statusTone(security.dmarcStatus) },
    {
      label: "Domain-Alter",
      value: security.senderDomainAgeDays == null ? "unbekannt" : `${security.senderDomainAgeDays} Tage`,
    },
    {
      label: "Domain-Reputation",
      value: security.domainReputationScore == null ? "unbekannt" : `${Math.round(security.domainReputationScore * 100)} / 100`,
    },
    {
      label: "Homoglyph-Domain",
      value: security.homoglyphDetected ? "erkannt" : "nicht erkannt",
      tone: security.homoglyphDetected ? "danger" : undefined,
    },
    {
      label: "Link-Ziel weicht ab",
      value: security.linkMismatchDetected ? "ja" : "nein",
      tone: security.linkMismatchDetected ? "danger" : undefined,
    },
    {
      label: "Anzeigename-Spoofing",
      value: security.displayNameSpoofingDetected ? "erkannt" : "nicht erkannt",
      tone: security.displayNameSpoofingDetected ? "danger" : undefined,
    },
    {
      label: "Antwort-Adresse (Reply-To) weicht ab",
      value: security.replyToMismatchDetected ? "ja" : "nein",
      tone: security.replyToMismatchDetected ? "danger" : undefined,
    },
    {
      label: "Dringlichkeits-Sprache",
      value: security.urgencyLanguageScore == null ? "unbekannt" : `${Math.round(security.urgencyLanguageScore * 100)} / 100`,
      tone: (security.urgencyLanguageScore ?? 0) > 0.5 ? "danger" : undefined,
    },
    {
      label: "Neue IBAN im Text",
      value: security.containsNewIban ? "ja" : "nein",
      tone: security.containsNewIban ? "danger" : undefined,
    },
    {
      label: "IBAN im Thread geändert",
      value: security.ibanChangedInThread ? "ja" : "nein",
      tone: security.ibanChangedInThread ? "danger" : undefined,
    },
    { label: "Konfidenz der Analyse", value: `${Math.round(security.confidenceScore * 100)} %` },
  ];

  return (
    <dl className="security-details">
      {rows.map((row) => (
        <div className={`security-details-row${row.tone ? ` tone-${row.tone}` : ""}`} key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
