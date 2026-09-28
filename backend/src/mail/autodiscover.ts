// [2026-09-28] Automatische Erkennung der Servereinstellungen fuer Adressen,
// deren Domain in contracts/mail-providers.json nicht vorkommt (eigene
// Domains, kleinere Anbieter). Reihenfolge wie bei Thunderbird:
//   1. Thunderbird-ISPDB (autoconfig.thunderbird.net) fuer die Domain
//   2. MX-Eintrag: bekannter Anbieter dahinter (z.B. Google Workspace ->
//      Gmail-Preset), sonst ISPDB fuer die Domain des Mailservers
//   3. DNS-SRV-Eintraege nach RFC 6186 (_imaps/_imap/_pop3s/_submission)
// Datenschutz: nach aussen geht nur die Domain (an die ISPDB und an DNS),
// nie die volle Adresse. Bewusst KEIN Abruf von autoconfig.<domain> oder
// anderen Hosts, die der Aufrufer bestimmt -- der Server soll nicht als
// Werkzeug fuer Anfragen an beliebige (auch interne) Adressen dienen.

import { resolveMx, resolveSrv } from "node:dns/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface DiscoveredSettings {
  found: boolean;
  source: "ispdb" | "mx" | "srv" | null;
  /** Gesetzt, wenn die Domain zu einem bekannten Preset gehoert (z.B.
   * Google Workspace -> "gmail"); der Client nimmt dann dieses Preset. */
  providerId: string | null;
  protocol: "imap" | "pop3" | null;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: boolean | null;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  /** "localpart": Anmeldename ist nur der Teil vor dem "@". */
  username: "email" | "localpart" | null;
}

const NOT_FOUND: DiscoveredSettings = {
  found: false,
  source: null,
  providerId: null,
  protocol: null,
  imapHost: null,
  imapPort: null,
  imapSecure: null,
  smtpHost: null,
  smtpPort: null,
  smtpSecure: null,
  username: null,
};

const ISPDB_BASE = "https://autoconfig.thunderbird.net/v1.1/";
const LOOKUP_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 24 * 3600 * 1000;
const CACHE_MAX = 500;

// Mailserver-Endungen -> Preset-ID aus mail-providers.json. Deckt eigene
// Domains ab, die bei einem bekannten Anbieter gehostet sind.
const MX_PROVIDER_SUFFIXES: [string, string][] = [
  ["google.com", "gmail"],
  ["googlemail.com", "gmail"],
  ["outlook.com", "outlook"],
  ["icloud.com", "icloud"],
  ["gmx.net", "gmx"],
  ["web.de", "web_de"],
  ["yahoodns.net", "yahoo"],
  ["t-online.de", "t_online"],
  ["freenet.de", "freenet"],
  ["ionos.de", "ionos"],
  ["kundenserver.de", "ionos"],
  ["posteo.de", "posteo"],
  ["mailbox.org", "mailbox_org"],
  ["aol.com", "aol"],
];

const DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function isValidDomain(domain: string): boolean {
  return DOMAIN_PATTERN.test(domain);
}

const PROVIDER_IDS = new Set<string>(
  (JSON.parse(readFileSync(join(__dirname, "../../../contracts/mail-providers.json"), "utf-8")).providers as { id: string }[]).map(
    (p) => p.id,
  ),
);

const cache = new Map<string, { value: DiscoveredSettings; expires: number }>();

export async function discoverMailSettings(domain: string): Promise<DiscoveredSettings> {
  const hit = cache.get(domain);
  if (hit && hit.expires > Date.now()) return hit.value;

  const value = await discoverUncached(domain);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(domain, { value, expires: Date.now() + CACHE_TTL_MS });
  return value;
}

async function discoverUncached(domain: string): Promise<DiscoveredSettings> {
  const fromIspdb = await lookupIspdb(domain, domain);
  if (fromIspdb) return fromIspdb;

  const mxHost = await primaryMx(domain);
  if (mxHost) {
    const providerId = MX_PROVIDER_SUFFIXES.find(([suffix]) => mxHost === suffix || mxHost.endsWith(`.${suffix}`))?.[1];
    if (providerId && PROVIDER_IDS.has(providerId)) {
      return { ...NOT_FOUND, found: true, source: "mx", providerId };
    }
    const mxDomain = mxHost.split(".").slice(-2).join(".");
    if (mxDomain !== domain && isValidDomain(mxDomain)) {
      const viaMx = await lookupIspdb(mxDomain, domain);
      if (viaMx) return { ...viaMx, source: "mx" };
    }
  }

  return (await lookupSrv(domain)) ?? NOT_FOUND;
}

async function primaryMx(domain: string): Promise<string | null> {
  try {
    const records = await withTimeout(resolveMx(domain));
    records.sort((a, b) => a.priority - b.priority);
    return records[0]?.exchange.toLowerCase().replace(/\.$/, "") ?? null;
  } catch {
    return null;
  }
}

// --- Thunderbird-ISPDB ---------------------------------------------------

async function lookupIspdb(lookupDomain: string, emailDomain: string): Promise<DiscoveredSettings | null> {
  let xml: string;
  try {
    const res = await fetch(ISPDB_BASE + encodeURIComponent(lookupDomain), {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) return null;
    xml = await res.text();
  } catch {
    return null;
  }
  return parseAutoconfigXml(xml, emailDomain);
}

interface XmlServer {
  type: string;
  hostname: string;
  port: number;
  socketType: string;
  username: string;
}

function serversIn(xml: string, tag: "incomingServer" | "outgoingServer"): XmlServer[] {
  const out: XmlServer[] = [];
  const re = new RegExp(`<${tag}\\s+type="([a-z0-9]+)"[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  for (const m of xml.matchAll(re)) {
    const field = (name: string) => m[2].match(new RegExp(`<${name}>([^<]*)</${name}>`, "i"))?.[1].trim() ?? "";
    const port = Number(field("port"));
    const hostname = field("hostname");
    if (!hostname || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
    out.push({ type: m[1].toLowerCase(), hostname, port, socketType: field("socketType").toUpperCase(), username: field("username") });
  }
  return out;
}

// Exportiert fuer den Smoketest (ohne Netzwerk pruefbar).
export function parseAutoconfigXml(xml: string, emailDomain: string): DiscoveredSettings | null {
  const incoming = serversIn(xml, "incomingServer").filter((s) => s.socketType !== "PLAIN");
  const outgoing = serversIn(xml, "outgoingServer").filter((s) => s.type === "smtp" && s.socketType !== "PLAIN");
  // IMAP vor POP3 (Ordner, Gelesen-Status), SSL vor STARTTLS.
  const pick = <T extends XmlServer>(list: T[]) => list.find((s) => s.socketType === "SSL") ?? list[0];
  const imap = pick(incoming.filter((s) => s.type === "imap"));
  const incomingServer = imap ?? pick(incoming.filter((s) => s.type === "pop3"));
  if (!incomingServer) return null;
  const smtp = pick(outgoing);
  const host = (h: string) => h.replace(/%EMAILDOMAIN%/g, emailDomain).toLowerCase();
  return {
    found: true,
    source: "ispdb",
    providerId: null,
    protocol: imap ? "imap" : "pop3",
    imapHost: host(incomingServer.hostname),
    imapPort: incomingServer.port,
    imapSecure: incomingServer.socketType === "SSL",
    smtpHost: smtp ? host(smtp.hostname) : null,
    smtpPort: smtp?.port ?? null,
    smtpSecure: smtp ? smtp.socketType === "SSL" : null,
    username: incomingServer.username.includes("%EMAILLOCALPART%") ? "localpart" : "email",
  };
}

// --- RFC 6186 (DNS-SRV) ----------------------------------------------------

async function srv(name: string): Promise<{ name: string; port: number } | null> {
  try {
    const records = await withTimeout(resolveSrv(name));
    records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
    const r = records[0];
    // Ziel "." heisst laut RFC "Dienst hier nicht angeboten".
    if (!r || r.name === "." || r.name === "") return null;
    return { name: r.name.toLowerCase().replace(/\.$/, ""), port: r.port };
  } catch {
    return null;
  }
}

async function lookupSrv(domain: string): Promise<DiscoveredSettings | null> {
  const [imaps, imap, pop3s, submissions, submission] = await Promise.all([
    srv(`_imaps._tcp.${domain}`),
    srv(`_imap._tcp.${domain}`),
    srv(`_pop3s._tcp.${domain}`),
    srv(`_submissions._tcp.${domain}`),
    srv(`_submission._tcp.${domain}`),
  ]);
  const incoming = imaps ?? imap ?? pop3s;
  if (!incoming) return null;
  const outgoing = submissions ?? submission;
  return {
    found: true,
    source: "srv",
    providerId: null,
    protocol: imaps || imap ? "imap" : "pop3",
    imapHost: incoming.name,
    imapPort: incoming.port,
    // _imap (ohne s) heisst STARTTLS auf dem Port -- imapflow schaltet das
    // automatisch ein, secure=false ist hier also trotzdem verschluesselt.
    imapSecure: incoming !== imap,
    smtpHost: outgoing?.name ?? null,
    smtpPort: outgoing?.port ?? null,
    smtpSecure: outgoing ? outgoing === submissions : null,
    username: "email",
  };
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), LOOKUP_TIMEOUT_MS)),
  ]);
}
