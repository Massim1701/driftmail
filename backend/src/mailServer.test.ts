// [2026-09-28] Test gegen echte, lokal gestartete Mailserver (im Speicher,
// kein Docker, kein Netzwerk nach aussen): IMAP ueber hoodiecrow-imap, SMTP
// ueber smtp-server. Sichert die Anbieter-Anbindung ab (WEB_INBOX.md 28.09.
// "HOHE PRIORITAET - Mailanbieter-Anbindung", Punkt "Absicherung"):
//   - Firmenserver-typisch: Anmeldename ist NICHT die Mailadresse,
//     Ordner mit Namensraum-Praefix "INBOX." und deutschen Namen, ohne
//     Special-Use-Kennzeichen
//   - Abruf, Papierkorb beim Anbieter, endgueltig Loeschen, Versand mit
//     Kopie im Gesendet-Ordner, automatisches Durchprobieren beim Verbinden
// Aufruf: npm run test:mailserver

import type { AddressInfo } from "node:net";
import { ImapFlow } from "imapflow";
import { SMTPServer } from "smtp-server";
import { connectWithAssist, defaultDeps } from "./mail/connectAssist";
import { ImapAdapter, folderDisplayName, type ImapCredentials } from "./mail/imapAdapter";
import { importedFolderName, syncAccount } from "./mail/sync";
import { createSystemFoldersForAccount, store } from "./db/store";
import { encryptCredentials } from "./auth/credentialsEncryption";
import { aiAdapter } from "./ai";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const hoodiecrow = require("hoodiecrow-imap") as (options: unknown) => {
  listen(port: number, cb?: () => void): void;
  close(cb?: () => void): void;
  server: { address(): AddressInfo };
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FEHLER: ${msg}`);
}

const rawMail = (id: string, subject: string) =>
  `From: Anna <anna@example.org>\r\nTo: max@kunde.de\r\nSubject: ${subject}\r\nMessage-ID: <${id}@example.org>\r\nDate: Mon, 28 Sep 2026 10:00:00 +0200\r\n\r\nHallo Max, ${subject}.\r\n`;

async function main() {
  // --- IMAP: Cyrus-/Firmenserver-Stil ------------------------------------
  const imapServer = hoodiecrow({
    plugins: ["ID", "NAMESPACE", "UNSELECT", "UIDPLUS", "MOVE", "SPECIAL-USE", "LITERALPLUS", "ENABLE"],
    users: { "max.mustermann": { password: "geheim" } },
    storage: {
      INBOX: {
        messages: [
          { raw: rawMail("m1", "Erste Mail"), flags: [] },
          { raw: rawMail("m2", "Zweite Mail"), flags: [] },
          { raw: rawMail("m3", "Dritte Mail"), flags: [] },
        ],
      },
      "INBOX.": {
        separator: ".",
        folders: {
          Gesendet: { messages: [{ raw: rawMail("s1", "Meine alte Antwort").replace("From: Anna <anna@example.org>", "From: max.mustermann@kunde.de"), flags: ["\\Seen"] }] },
          Papierkorb: { messages: [{ raw: rawMail("t1", "Weggeworfen"), flags: [] }] },
          Entwürfe: {},
          Rechnungen: {
            messages: [
              { raw: rawMail("r1", "Rechnung Strom"), flags: ["\\Seen"] },
              { raw: rawMail("r2", "Rechnung Handy"), flags: ["\\Seen"] },
              { raw: rawMail("m2", "Zweite Mail"), flags: [] }, // liegt auch im Posteingang
            ],
          },
        },
      },
    },
  });
  await new Promise<void>((r) => imapServer.listen(0, r));
  const imapPort = imapServer.server.address().port;

  // --- SMTP ---------------------------------------------------------------
  const received: string[] = [];
  const smtpServer = new SMTPServer({
    authOptional: false,
    disabledCommands: ["STARTTLS"],
    onAuth(auth, _session, cb) {
      if (auth.username === "max.mustermann" && auth.password === "geheim") cb(null, { user: auth.username });
      else cb(new Error("Invalid credentials"));
    },
    onData(stream, _session, cb) {
      let data = "";
      stream.on("data", (c: Buffer) => (data += c.toString()));
      stream.on("end", () => {
        received.push(data);
        cb();
      });
    },
  });
  await new Promise<void>((r) => smtpServer.listen(0, "127.0.0.1", r));
  const smtpPort = (smtpServer.server.address() as AddressInfo).port;

  const creds: ImapCredentials = {
    host: "127.0.0.1",
    port: imapPort,
    secure: false,
    user: "max.mustermann@kunde.de", // falsch: Server kennt nur "max.mustermann"
    password: "geheim",
    smtpHost: "127.0.0.1",
    smtpPort,
    smtpSecure: false,
  };

  try {
    // 1. Verbinden: Assist findet den abweichenden Anmeldenamen selbst.
    const assisted = await connectWithAssist("imap", creds, "max.mustermann@kunde.de", (c) => new ImapAdapter(c).testConnection(), {
      ...defaultDeps,
      verifySmtp: async () => true,
    });
    assert(assisted.credentials.user === "max.mustermann", `Anmeldename sollte angepasst sein: ${assisted.credentials.user}`);
    console.log("✔ Verbinden: abweichender Anmeldename automatisch gefunden");

    const adapter = new ImapAdapter({ ...assisted.credentials, emailAddress: "max.mustermann@kunde.de" });

    // 2. Abruf
    const mails = await adapter.fetchRecentMessages(50);
    assert(mails.length === 3, `3 Mails erwartet, ${mails.length} bekommen`);
    assert(mails[0].subject === "Dritte Mail", `neueste zuerst erwartet, bekam ${mails[0].subject}`);
    console.log("✔ Abruf: 3 Mails, neueste zuerst");

    // 3. Papierkorb: landet im Anbieter-Ordner "INBOX.Papierkorb"
    const first = mails.find((m) => m.subject === "Erste Mail")!;
    await adapter.trashMessage(first.providerMessageId!);
    const count = async (path: string) => {
      const c = new ImapFlow({ host: "127.0.0.1", port: imapPort, secure: false, auth: { user: "max.mustermann", pass: "geheim" }, logger: false });
      await c.connect();
      const status = await c.status(path, { messages: true });
      await c.logout();
      return status.messages ?? 0;
    };
    assert((await count("INBOX")) === 2, "nach dem Papierkorb sollten 2 Mails im Posteingang sein");
    assert((await count("INBOX.Papierkorb")) === 2, "die Mail sollte im Papierkorb des Anbieters liegen (dort lag schon eine)");
    console.log("✔ Papierkorb: Mail beim Anbieter in 'INBOX.Papierkorb' verschoben");

    // 4. Endgueltig loeschen: per Message-ID im Papierkorb gefunden
    await adapter.permanentlyDeleteMessage(first.providerMessageId!, first.messageIdHeader);
    assert((await count("INBOX.Papierkorb")) === 1, "nach dem endgueltigen Loeschen sollte nur die alte Mail im Papierkorb liegen");
    console.log("✔ Endgültig löschen: im Papierkorb per Message-ID gefunden und entfernt");

    // 5. Versand: Absender = Kontoadresse, Kopie im Gesendet-Ordner
    await adapter.sendMail({
      fromName: "Max Mustermann",
      to: ["anna@example.org"],
      cc: [],
      bcc: [],
      subject: "Antwort",
      bodyText: "Danke!",
      inReplyToMessageIdHeader: mails[0].messageIdHeader,
      attachments: [],
    });
    assert(received.length === 1, "SMTP-Server sollte genau eine Mail bekommen");
    assert(
      /^From: Max Mustermann <max\.mustermann@kunde\.de>/m.test(received[0]),
      "Absender sollte 'Name <Kontoadresse>' sein, nicht der Anmeldename",
    );
    assert((await count("INBOX.Gesendet")) === 2, "Kopie sollte im Gesendet-Ordner liegen (neben der alten gesendeten Mail)");
    console.log("✔ Versand: Absender mit Name korrekt, Kopie in 'INBOX.Gesendet'");

    // 6. Gmail-/Anbieter-Ordner als Kopien (Massimo 28.09.): ganzer Abruf
    //    ueber syncAccount mit einem echten Konto im (In-Memory-)Store.
    assert(folderDisplayName("INBOX.Rechnungen", ".") === "Rechnungen", "Namensraum-Praefix sollte wegfallen");
    assert(folderDisplayName("Arbeit/Projekt", "/") === "Arbeit / Projekt", "verschachtelte Ordner lesbar");
    assert(folderDisplayName("[Google Mail]/Amazon", "/") === "Amazon", "Gmail-Praefix sollte wegfallen");
    assert(folderDisplayName("[Google Mail]Amazon", "/") === "Amazon", "Gmail-Praefix ohne Trenner sollte wegfallen");
    assert(folderDisplayName("[Gmail]", "/") === "Google Mail", "allein stehendes Gmail-Praefix lesbar");
    assert(
      importedFolderName("Sonstiges", [{ name: "Sonstiges", isSystem: true }], "Gmail") === "Sonstiges (Gmail)",
      "Namensgleichheit mit Systemordner sollte den Anbieter anhaengen",
    );
    assert(importedFolderName("Rechnungen", [{ name: "Sonstiges", isSystem: true }], "Gmail") === "Rechnungen", "sonst Name unveraendert");
    const user = await store.createUser("max.mustermann@kunde.de");
    const account = await store.createMailAccount({
      userId: user.id,
      provider: "imap",
      emailAddress: "max.mustermann@kunde.de",
      encryptedOauthToken: null,
      encryptedImapCredentials: encryptCredentials(JSON.stringify(assisted.credentials)),
      syncStatus: "pending",
      lastSyncedAt: null,
    });
    await createSystemFoldersForAccount(account.id);
    const inboxBefore = await count("INBOX");
    await syncAccount(account, aiAdapter);
    const folders = await store.listFolders(account.id);
    const rechnungen = folders.find((f) => !f.isSystem && f.name === "Rechnungen");
    const gesendet = folders.find((f) => f.systemKey === "gesendet")!;
    const papierkorb = folders.find((f) => f.systemKey === "papierkorb")!;
    assert(rechnungen, `eigener Ordner "Rechnungen" sollte angelegt sein: ${folders.map((f) => f.name).join(", ")}`);
    const inFolder = async (folderId: string) => (await store.listMessages({ folderId })).map((m) => m.subject);
    const rechnungenSubjects = await inFolder(rechnungen.id);
    assert(
      rechnungenSubjects.length === 2 && rechnungenSubjects.includes("Rechnung Strom") && rechnungenSubjects.includes("Rechnung Handy"),
      `Rechnungen sollte 2 Kopien enthalten (die Posteingangs-Mail nicht doppelt): ${rechnungenSubjects.join(", ")}`,
    );
    assert((await inFolder(gesendet.id)).includes("Meine alte Antwort"), "alte gesendete Mail sollte in 'gesendet' liegen");
    assert(!(await inFolder(papierkorb.id)).includes("Weggeworfen"), "Papierkorb des Anbieters wird nicht importiert");
    assert(!folders.some((f) => f.name === "Papierkorb" && !f.isSystem), "kein eigener Ordner fuer den Anbieter-Papierkorb");
    const copies = (await store.listMessages({ folderId: rechnungen.id })) as { providerMessageId: string | null }[];
    assert(copies.every((m) => m.providerMessageId === null), "Kopien duerfen keine Anbieter-ID haben (Loeschen bleibt lokal)");
    assert((await count("INBOX")) === inboxBefore && (await count("INBOX.Rechnungen")) === 3, "Postfach beim Anbieter bleibt unveraendert");
    // Zweiter Abruf: nichts doppelt.
    await syncAccount(account, aiAdapter);
    assert((await inFolder(rechnungen.id)).length === 2, "zweiter Abruf darf nichts doppelt importieren");
    assert((await store.listFolders(account.id)).filter((f) => f.name === "Rechnungen").length === 1, "Ordner nicht doppelt anlegen");
    console.log("✔ Ordner-Import: 'Rechnungen' + Gesendet als Kopien, Papierkorb ausgelassen, nichts doppelt, Postfach unverändert");

    console.log("✔ Mailserver-Test erfolgreich");
  } finally {
    imapServer.close();
    smtpServer.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
