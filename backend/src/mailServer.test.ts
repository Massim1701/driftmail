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
import { ImapAdapter, type ImapCredentials } from "./mail/imapAdapter";

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
          Gesendet: {},
          Papierkorb: {},
          Entwürfe: {},
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
    assert((await count("INBOX.Papierkorb")) === 1, "die Mail sollte im Papierkorb des Anbieters liegen");
    console.log("✔ Papierkorb: Mail beim Anbieter in 'INBOX.Papierkorb' verschoben");

    // 4. Endgueltig loeschen: per Message-ID im Papierkorb gefunden
    await adapter.permanentlyDeleteMessage(first.providerMessageId!, first.messageIdHeader);
    assert((await count("INBOX.Papierkorb")) === 0, "Papierkorb sollte nach dem endgueltigen Loeschen leer sein");
    console.log("✔ Endgültig löschen: im Papierkorb per Message-ID gefunden und entfernt");

    // 5. Versand: Absender = Kontoadresse, Kopie im Gesendet-Ordner
    await adapter.sendMail({
      to: ["anna@example.org"],
      cc: [],
      bcc: [],
      subject: "Antwort",
      bodyText: "Danke!",
      inReplyToMessageIdHeader: mails[0].messageIdHeader,
      attachments: [],
    });
    assert(received.length === 1, "SMTP-Server sollte genau eine Mail bekommen");
    assert(/^From: max\.mustermann@kunde\.de/m.test(received[0]), "Absender sollte die Kontoadresse sein, nicht der Anmeldename");
    assert((await count("INBOX.Gesendet")) === 1, "Kopie sollte im Gesendet-Ordner liegen");
    console.log("✔ Versand: Absender korrekt, Kopie in 'INBOX.Gesendet'");

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
