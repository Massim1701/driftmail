import "./loadEnv"; // muss vor jedem anderen Import stehen, siehe loadEnv.ts

// [2026-09-28] Test mit ECHTEN Mailkonten (WEB_INBOX.md 28.09. "HOHE
// PRIORITAET - Mailanbieter-Anbindung"). Anleitung: anleitungen/testkonten.md.
// Liest bis zu 9 Konten aus backend/.env:
//   TEST_KONTO_1_ADRESSE=...      Mailadresse
//   TEST_KONTO_1_PASSWORT=...     (App-)Passwort
//   TEST_KONTO_1_ANMELDENAME=...  optional, nur wenn nicht die Adresse
// Pro Konto: Servereinstellungen finden wie die App (Anbieterliste, sonst
// automatische Erkennung), verbinden, Posteingang abrufen, eine Testmail an
// sich selbst schicken, auf Kopie im Gesendet-Ordner und Eingang warten,
// Testmail in den Papierkorb und endgueltig loeschen. Passwoerter erscheinen
// nie in der Ausgabe.
// Aufruf: npm run test:echt

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImapFlow } from "imapflow";
import { discoverMailSettings } from "./mail/autodiscover";
import { connectWithAssist } from "./mail/connectAssist";
import { ImapAdapter, type ImapCredentials } from "./mail/imapAdapter";

interface Preset {
  id: string;
  label: string;
  authType: string;
  comingSoon?: boolean;
  domains: string[];
  imapHost?: string | null;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string | null;
  smtpPort?: number;
  smtpSecure?: boolean;
}

const presets = (JSON.parse(readFileSync(join(__dirname, "../../contracts/mail-providers.json"), "utf-8")) as { providers: Preset[] })
  .providers;

type Result = "ok" | "fehler" | "—";
interface Row {
  konto: string;
  quelle: string;
  verbinden: Result;
  abruf: Result;
  senden: Result;
  gesendet: Result;
  eingang: Result;
  papierkorb: Result;
  hinweis: string;
}

function mask(address: string): string {
  const [local, domain] = address.split("@");
  return `${local.slice(0, 2)}…@${domain}`;
}

function reason(err: unknown): string {
  const e = err as { responseText?: string; message?: string; code?: string };
  return (e?.responseText || e?.message || e?.code || String(err)).replace(/\s+/g, " ").slice(0, 120);
}

async function settingsFor(address: string, password: string, login?: string): Promise<{ creds: ImapCredentials; quelle: string } | { skip: string }> {
  const domain = address.split("@")[1].toLowerCase();
  const preset = presets.find((p) => p.domains.includes(domain));
  if (preset?.comingSoon) return { skip: `${preset.label}: noch nicht unterstützt (braucht Anmeldung beim Anbieter, siehe anleitungen/)` };
  const user = login || address;
  if (preset?.imapHost) {
    return {
      quelle: `Anbieterliste (${preset.id})`,
      creds: {
        host: preset.imapHost, port: preset.imapPort ?? 993, secure: preset.imapSecure ?? true, user, password,
        smtpHost: preset.smtpHost ?? preset.imapHost, smtpPort: preset.smtpPort ?? 587, smtpSecure: preset.smtpSecure ?? false,
      },
    };
  }
  const found = await discoverMailSettings(domain);
  if (!found.found || !found.imapHost) return { skip: "Servereinstellungen nicht gefunden (manuell eintragen nötig)" };
  if (found.protocol !== "imap") return { skip: "nur POP3 gefunden -- dieser Test prüft IMAP" };
  return {
    quelle: `Erkennung (${found.source})`,
    creds: {
      host: found.imapHost, port: found.imapPort ?? 993, secure: found.imapSecure ?? true,
      user: login || (found.username === "localpart" ? address.split("@")[0] : address), password,
      smtpHost: found.smtpHost ?? found.imapHost, smtpPort: found.smtpPort ?? 587, smtpSecure: found.smtpSecure ?? false,
    },
  };
}

async function withClient<T>(c: ImapCredentials, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: c.host, port: c.port, secure: c.secure,
    ...(c.requireStartTls && !c.secure ? { doSTARTTLS: true } : {}),
    auth: { user: c.user, pass: c.password }, logger: false,
  });
  client.on("error", () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

async function findIn(c: ImapCredentials, use: "\\Sent" | "\\Trash" | "INBOX", messageId: string): Promise<boolean> {
  return withClient(c, async (client) => {
    const path = use === "INBOX" ? "INBOX" : (await client.list()).find((b) => b.specialUse === use)?.path;
    if (!path) return false;
    const lock = await client.getMailboxLock(path);
    try {
      const hits = await client.search({ header: { "message-id": messageId } }, { uid: true });
      return !!hits && hits.length > 0;
    } finally {
      lock.release();
    }
  });
}

async function waitFor(check: () => Promise<boolean>, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds / 5; i++) {
    if (await check().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function testAccount(address: string, password: string, login?: string): Promise<Row> {
  const row: Row = { konto: mask(address), quelle: "—", verbinden: "—", abruf: "—", senden: "—", gesendet: "—", eingang: "—", papierkorb: "—", hinweis: "" };
  const s = await settingsFor(address, password, login);
  if ("skip" in s) {
    row.hinweis = s.skip;
    return row;
  }
  row.quelle = s.quelle;

  let creds: ImapCredentials;
  try {
    const r = await connectWithAssist("imap", s.creds, address, (c) => new ImapAdapter(c).testConnection());
    creds = r.credentials;
    row.verbinden = "ok";
    if (r.adjustments.length) row.hinweis = `angepasst: ${r.adjustments.join("; ")}`;
  } catch (err) {
    row.verbinden = "fehler";
    row.hinweis = reason(err);
    return row;
  }
  const adapter = new ImapAdapter({ ...creds, emailAddress: address });

  try {
    const mails = await adapter.fetchRecentMessages(5);
    row.abruf = "ok";
    row.hinweis = [row.hinweis, `${mails.length} Mails abgerufen`].filter(Boolean).join("; ");
  } catch (err) {
    row.abruf = "fehler";
    row.hinweis = reason(err);
    return row;
  }

  let messageId: string;
  try {
    const sent = await adapter.sendMail({
      to: [address], cc: [], bcc: [], subject: `driftmail-Test ${new Date().toISOString()}`,
      bodyText: "Automatischer Verbindungstest von driftmail. Kann gelöscht werden.", inReplyToMessageIdHeader: null, attachments: [],
    });
    messageId = sent.providerMessageId;
    row.senden = "ok";
  } catch (err) {
    row.senden = "fehler";
    row.hinweis = `Senden: ${reason(err)}`;
    return row;
  }

  row.gesendet = (await waitFor(() => findIn(creds, "\\Sent", messageId), 30)) ? "ok" : "fehler";
  const arrived = await waitFor(() => findIn(creds, "INBOX", messageId), 90);
  row.eingang = arrived ? "ok" : "fehler";
  if (!arrived) {
    row.hinweis += "; Testmail nach 90 s nicht im Eingang (Spamfilter?)";
    return row;
  }

  try {
    const uid = await withClient(creds, async (client) => {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const hits = await client.search({ header: { "message-id": messageId } }, { uid: true });
        return hits && hits.length > 0 ? String(hits[0]) : null;
      } finally {
        lock.release();
      }
    });
    if (!uid) throw new Error("Testmail im Eingang nicht mehr gefunden");
    await adapter.trashMessage(uid);
    const inTrash = await findIn(creds, "\\Trash", messageId);
    await adapter.permanentlyDeleteMessage(uid, messageId);
    const gone = !(await findIn(creds, "\\Trash", messageId));
    row.papierkorb = inTrash && gone ? "ok" : "fehler";
    if (!inTrash) row.hinweis += "; kein Papierkorb-Ordner erkannt";
  } catch (err) {
    row.papierkorb = "fehler";
    row.hinweis += `; Papierkorb: ${reason(err)}`;
  }
  return row;
}

async function main() {
  const accounts: { address: string; password: string; login?: string }[] = [];
  for (let i = 1; i <= 9; i++) {
    const address = process.env[`TEST_KONTO_${i}_ADRESSE`]?.trim();
    const password = process.env[`TEST_KONTO_${i}_PASSWORT`];
    if (address && password) accounts.push({ address, password, login: process.env[`TEST_KONTO_${i}_ANMELDENAME`]?.trim() || undefined });
  }
  if (accounts.length === 0) {
    console.log("Keine Testkonten in backend/.env eingetragen -- siehe anleitungen/testkonten.md.");
    return;
  }

  const rows: Row[] = [];
  for (const a of accounts) {
    console.log(`… teste ${mask(a.address)}`);
    rows.push(await testAccount(a.address, a.password, a.login));
  }

  console.log("\n| Konto | Einstellungen | Verbinden | Abruf | Senden | Gesendet-Ordner | Eingang | Papierkorb | Hinweis |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    console.log(`| ${r.konto} | ${r.quelle} | ${r.verbinden} | ${r.abruf} | ${r.senden} | ${r.gesendet} | ${r.eingang} | ${r.papierkorb} | ${r.hinweis} |`);
  }
  if (rows.some((r) => Object.values(r).includes("fehler"))) process.exitCode = 1;
}

main().catch((err) => {
  console.error(reason(err));
  process.exit(1);
});
