// [2026-09-28] Massimo: "alle Mailserver sollen sich mit der App verbinden
// ... Loesungen, die einfach zu managen sind". Statt beim ersten
// Fehlversuch abzubrechen, probiert die Kontoanlage die typischen
// Abweichungen selbst durch -- ohne Anbieterliste, die jemand pflegen muss,
// nur nach dem, was der Server selbst meldet:
//   - Anmeldung abgelehnt   -> einmal Anmeldename ohne/mit "@domain"
//   - Zertifikat passt nicht zum Servernamen -> Namen aus dem Zertifikat
//     nehmen (wie Thunderbird; z.B. mail.kunde.de -> w0123.kasserver.com)
//   - IMAP-Port zu          -> 993/TLS <-> 143 mit PFLICHT-STARTTLS
//   - Postausgang           -> nach erfolgreichem Empfang pruefen und bei
//     Bedarf 465/587 bzw. smtp./mail. probieren; blockiert die
//     Kontoanlage NIE (Empfangen funktioniert ja schon).
// Sicherheit: jede Variante wird hoechstens einmal probiert (kein
// Passwort-Durchprobieren, keine Sperre beim Anbieter); ausgewichen wird
// nie auf eine unverschluesselte Verbindung; Ausweich-Hosts duerfen nicht
// in ein lokales Netz zeigen (gleiche Regel wie die Testverbindung).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import nodemailer from "nodemailer";
import { isValidDomain } from "./autodiscover";
import { isPrivateAddress, probeMailServer } from "./probe";

export interface AssistableCredentials {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  requireStartTls?: boolean;
  smtpRequireTls?: boolean;
}

export interface AssistDeps {
  /** Antwortet der Server auf host:port (Begruessung lesen, ohne Login)? */
  reachable(host: string, port: number, secure: boolean): Promise<boolean>;
  /** Zeigt der Name auf eine oeffentliche Adresse (nicht ins lokale Netz)? */
  isPublicHost(host: string): Promise<boolean>;
  /** Hostnamen aus dem TLS-Zertifikat von host:port (ohne Wildcards). */
  certNames(host: string, port: number): Promise<string[]>;
  /** SMTP-Anmeldung pruefen (nodemailer verify). */
  verifySmtp(c: AssistableCredentials): Promise<boolean>;
}

export interface AssistResult<C> {
  credentials: C;
  /** Was automatisch angepasst wurde, fuers Log/den Client. */
  adjustments: string[];
}

const MAX_ATTEMPTS = 4;

export async function connectWithAssist<C extends AssistableCredentials>(
  protocol: "imap" | "pop3",
  initial: C,
  emailAddress: string,
  test: (c: C) => Promise<void>,
  deps: AssistDeps = defaultDeps,
): Promise<AssistResult<C>> {
  let current = initial;
  const adjustments: string[] = [];
  const tried = new Set<"user" | "host" | "port">();

  for (let attempt = 1; ; attempt++) {
    try {
      await test(current);
      break;
    } catch (err) {
      const next = attempt < MAX_ATTEMPTS ? await nextVariant(protocol, current, err, emailAddress, tried, deps) : null;
      if (!next) throw err;
      adjustments.push(next.note);
      current = next.credentials;
    }
  }

  const smtp = await tuneSmtp(current, emailAddress, deps);
  if (smtp) {
    adjustments.push(smtp.note);
    current = smtp.credentials;
  }
  return { credentials: current, adjustments };
}

async function nextVariant<C extends AssistableCredentials>(
  protocol: "imap" | "pop3",
  c: C,
  err: unknown,
  emailAddress: string,
  tried: Set<"user" | "host" | "port">,
  deps: AssistDeps,
): Promise<{ credentials: C; note: string } | null> {
  if (isAuthError(err) && !tried.has("user")) {
    tried.add("user");
    const localpart = emailAddress.split("@")[0];
    if (c.user.toLowerCase() === emailAddress.toLowerCase() && localpart) {
      return { credentials: { ...c, user: localpart }, note: "Anmeldename ohne @domain" };
    }
    if (!c.user.includes("@")) {
      return { credentials: { ...c, user: emailAddress }, note: "Anmeldename mit @domain" };
    }
    return null;
  }

  if (isCertNameError(err) && c.secure && !tried.has("host")) {
    tried.add("host");
    // Viele Zertifikate nennen alle Dienste (mail./smtp./imap./pop.) --
    // den passenden zuerst, es wird nur EIN Name probiert.
    const prefix = protocol === "imap" ? "imap." : "pop";
    const rank = (n: string) => (n.startsWith(prefix) ? 0 : n.startsWith("mail.") ? 1 : 2);
    const names = (await deps.certNames(c.host, c.port)).sort((x, y) => rank(x) - rank(y));
    for (const name of names) {
      if (name === c.host || !(await deps.isPublicHost(name))) continue;
      const smtpHost = c.smtpHost === c.host ? name : c.smtpHost;
      return { credentials: { ...c, host: name, smtpHost }, note: `Servername laut Zertifikat: ${name}` };
    }
    return null;
  }

  // POP3 ohne TLS ab Verbindungsbeginn kann node-pop3 nicht sicher (kein
  // erzwungenes STARTTLS) -- dort deshalb kein Port-Ausweichen.
  if (isUnreachableError(err) && protocol === "imap" && !tried.has("port")) {
    tried.add("port");
    if (c.secure && c.port === 993 && (await deps.reachable(c.host, 143, false))) {
      return { credentials: { ...c, port: 143, secure: false, requireStartTls: true }, note: "IMAP über Port 143 (STARTTLS)" };
    }
    if (!c.secure && c.port === 143 && (await deps.reachable(c.host, 993, true))) {
      return { credentials: { ...c, port: 993, secure: true, requireStartTls: undefined }, note: "IMAP über Port 993 (TLS)" };
    }
  }
  return null;
}

async function tuneSmtp<C extends AssistableCredentials>(
  c: C,
  emailAddress: string,
  deps: AssistDeps,
): Promise<{ credentials: C; note: string } | null> {
  if (await deps.verifySmtp(c)) return null;

  const base = baseDomain(c.host);
  const emailDomain = emailAddress.split("@")[1]?.toLowerCase();
  const hosts = [...new Set([c.smtpHost, `smtp.${base}`, `mail.${base}`, emailDomain ? `smtp.${emailDomain}` : ""])].filter(
    (h) => h && isValidDomain(h),
  );
  const candidates = hosts.flatMap((host) => [
    { smtpHost: host, smtpPort: 465, smtpSecure: true, smtpRequireTls: undefined },
    { smtpHost: host, smtpPort: 587, smtpSecure: false, smtpRequireTls: true },
  ]).filter((v) => !(v.smtpHost === c.smtpHost && v.smtpPort === c.smtpPort && v.smtpSecure === c.smtpSecure));

  // Erst parallel schauen, wer ueberhaupt antwortet (schnell, ohne Login),
  // dann nur dort die echte Anmeldung versuchen.
  const up = await Promise.all(candidates.map((v) => deps.reachable(v.smtpHost, v.smtpPort, v.smtpSecure)));
  for (const [i, v] of candidates.entries()) {
    if (!up[i]) continue;
    const tuned = { ...c, ...v };
    if (await deps.verifySmtp(tuned)) {
      return { credentials: tuned, note: `Postausgang: ${v.smtpHost}:${v.smtpPort}` };
    }
  }
  console.warn(`[connect-assist] Postausgang fuer ${c.smtpHost}:${c.smtpPort} nicht bestaetigt -- Einstellungen bleiben unveraendert.`);
  return null;
}

// imap.gmx.net -> gmx.net; mail.kunde.de -> kunde.de; kunde.de -> kunde.de
function baseDomain(host: string): string {
  const labels = host.toLowerCase().split(".");
  return labels.length > 2 ? labels.slice(1).join(".") : labels.join(".");
}

// --- Fehlerarten ---------------------------------------------------------

function errText(err: unknown): string {
  const e = (err ?? {}) as { responseText?: string; message?: string };
  return `${e.responseText ?? ""} ${e.message ?? ""}`;
}

export function isAuthError(err: unknown): boolean {
  if ((err as { authenticationFailed?: boolean })?.authenticationFailed === true) return true;
  return /authenticat\w* failed|invalid credentials|login failed|AUTHENTICATIONFAILED|\[AUTH\]|-ERR.*(password|passwort|login|auth|credentials|user)/i.test(
    errText(err),
  );
}

export function isCertNameError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "ERR_TLS_CERT_ALTNAME_INVALID" || /Hostname\/IP does not match certificate/i.test(errText(err));
}

export function isUnreachableError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  return (
    ["ECONNREFUSED", "ETIMEDOUT", "ETIMEOUT", "EHOSTUNREACH", "ECONNRESET", "CONNECT_TIMEOUT", "GREETING_TIMEOUT"].includes(code) ||
    /timed? ?out|wrong version number|ECONNREFUSED/i.test(errText(err))
  );
}

// --- echte Netzwerk-Implementierung ---------------------------------------

async function isPublicHost(host: string): Promise<boolean> {
  try {
    const address = isIP(host) ? host : (await lookup(host)).address;
    return !isPrivateAddress(address);
  } catch {
    return false;
  }
}

const TIMEOUT_MS = 6000;

export const defaultDeps: AssistDeps = {
  isPublicHost,

  async reachable(host, port, secure) {
    return (await probeMailServer(host, port, secure)).ok;
  },

  async certNames(host, port) {
    let address: string;
    try {
      address = isIP(host) ? host : (await lookup(host)).address;
    } catch {
      return [];
    }
    if (isPrivateAddress(address)) return [];
    // Nur das Zertifikat LESEN (deshalb ohne Pruefung); der naechste echte
    // Verbindungsversuch mit dem neuen Namen prueft es wieder vollstaendig.
    return new Promise<string[]>((resolve) => {
      const socket = tlsConnect({ host: address, port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false });
      const done = (names: string[]) => {
        socket.destroy();
        resolve(names);
      };
      socket.setTimeout(TIMEOUT_MS, () => done([]));
      socket.once("error", () => done([]));
      socket.once("secureConnect", () => {
        const cert = socket.getPeerCertificate();
        const alt = (cert?.subjectaltname ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.startsWith("DNS:"))
          .map((s) => s.slice(4).toLowerCase());
        const cn = typeof cert?.subject?.CN === "string" ? [cert.subject.CN.toLowerCase()] : [];
        done([...new Set([...alt, ...cn])].filter((n) => !n.includes("*") && isValidDomain(n)));
      });
    });
  },

  async verifySmtp(c) {
    if (!(await isPublicHost(c.smtpHost))) return false;
    const transport = nodemailer.createTransport({
      host: c.smtpHost,
      port: c.smtpPort,
      secure: c.smtpSecure,
      requireTLS: c.smtpRequireTls ?? false,
      auth: { user: c.user, pass: c.password },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: 2 * TIMEOUT_MS,
    });
    try {
      await transport.verify();
      return true;
    } catch {
      return false;
    } finally {
      transport.close();
    }
  },
};
