import type { Classification, SecurityResult } from "../types";
import { CheckShieldIcon, ShieldExclamationIcon } from "../icons";
import "./SecurityBadge.css";

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
      label: "Dringlichkeits-Sprache",
      value: security.urgencyLanguageScore == null ? "unbekannt" : `${Math.round(security.urgencyLanguageScore * 100)} / 100`,
      tone: (security.urgencyLanguageScore ?? 0) > 0.5 ? "danger" : undefined,
    },
    {
      label: "Neue IBAN im Text",
      value: security.containsNewIban ? "ja" : "nein",
      tone: security.containsNewIban ? "danger" : undefined,
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
