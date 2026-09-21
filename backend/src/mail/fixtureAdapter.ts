// Fixture-Adapter: liefert feste Beispiel-Mails statt echter Provider-Calls.
// Wird verwendet, wenn für ein mail_accounts-Konto keine echten Zugangsdaten
// hinterlegt sind (Standardfall in diesem ersten Durchstich — siehe README).
// So bleibt `npm run dev` ohne jede Konfiguration lauffähig und der
// Kernfluss (Sync -> Security-Analyse -> Ordner -> Vertrag -> Summary)
// end-to-end sichtbar.

import { randomUUID } from "node:crypto";
import type { FetchedMail, MailAdapter, SendMailInput, SendMailResult } from "./types";

const now = () => new Date();
const daysAgo = (n: number) => new Date(now().getTime() - n * 24 * 3600 * 1000).toISOString();

// [2026-09-19] Fund beim Bauen der Anzeigename-Spoofing-/Reply-To-Mismatch-
// Erkennung (WEB_INBOX.md 15.09.): rawHeaders hatte bisher bei KEINER
// Fixture einen echten "From"-Header, obwohl mehrere Erkennungsfunktionen
// (detectHomoglyphs' From-Domain-Check, heloMismatch.ts extractSenderDomain,
// jetzt auch displayNameSpoofing.ts/replyToMismatch.ts) genau den erwarten
// -- nur `fromAddress`/`fromDisplayName` waren als strukturierte Felder
// gesetzt. Gmail-/IMAP-Adapter kopieren bei echten Mails alle Header 1:1
// (siehe gmailAdapter.ts), nur die FixtureMailAdapter-Testdaten hatten diese
// Lücke. Ab hier nachgezogen: jede Fixture bekommt einen zu
// fromDisplayName/fromAddress passenden "From"-Header (Fixture 2 zusätzlich
// "Reply-To", passend zu ihrem bereits vorhandenen replyToAddress-Feld).

const FIXTURES: FetchedMail[] = [
  {
    messageIdHeader: "<fixture-1@beispiel-versicherung.de>",
    providerMessageId: null,
    fromAddress: "vertrag@beispiel-versicherung.de",
    fromDisplayName: "Beispiel Versicherung",
    replyToAddress: null,
    subject: "Ihr Vertrag: Verlängerung und Kündigungsfrist",
    bodyText:
      "Sehr geehrte Kundin, sehr geehrter Kunde,\n\nIhr Vertrag (Laufzeit 12 Monate) verlängert sich automatisch. " +
      "Die Kündigungsfrist beträgt 30 Tage vor Vertragsende. Bitte prüfen Sie Ihre Daten.\n\nMit freundlichen Grüßen",
    receivedAt: daysAgo(1),
    // "X-Originating-IP" hier nur als Beispiel für einen unauffälligen
    // Absender gesetzt (Grundlage für den IP-Reputations-Lookup, siehe
    // src/lookups/ipReputationMock.ts) -- kein echter Header eines echten
    // Versanddienstes.
    rawHeaders: {
      From: "Beispiel Versicherung <vertrag@beispiel-versicherung.de>",
      "Received-SPF": "pass",
      "Content-Type": "text/plain",
      "X-Originating-IP": "[203.0.113.10]",
    },
    attachments: [],
  },
  {
    messageIdHeader: "<fixture-2@sicherheit-konto-check.tk>",
    providerMessageId: null,
    fromAddress: "service@sicherheit-konto-check.tk",
    fromDisplayName: "Kundenservice",
    replyToAddress: "reply@andere-domain.ru",
    subject: "Wichtig: Konto gesperrt — jetzt Passwort bestätigen",
    bodyText:
      "Ihr Konto wurde vorübergehend gesperrt. Klicken Sie sofort auf den Link und bestätigen Sie Ihr Passwort, " +
      // integration (09.09.): Track B's echte IBAN-Erkennung validiert per
      // Mod-97-Prüfsumme (ibanDetection.ts) statt nur das Format zu prüfen
      // wie der alte Mock -- die ursprüngliche Platzhalter-IBAN
      // "DE00 1234 5678 9012 3456 00" hatte eine ungültige Prüfsumme und
      // wurde deshalb nicht mehr erkannt, was die Phishing-Klassifikation
      // unter die 0.5-Schwelle drückte (nur Auth-Fail + Dringlichkeit,
      // ohne den IBAN-Kombinationsbonus). Jetzt eine gültige Beispiel-IBAN.
      "sonst wird Ihr Konto endgültig gelöscht. Neue IBAN für Rückerstattung: DE68 2105 0170 0012 3456 78.",
    receivedAt: daysAgo(0),
    // "Received" enthält hier absichtlich eine IP aus der Beispiel-
    // "Botnetz"-Liste im IP-Reputations-Mock (siehe ipReputationMock.ts),
    // damit der "known_botnet"-Fall im Smoketest ohne echten Blocklist-
    // Zugriff durchgetestet werden kann. "List-Unsubscribe" ist hier
    // absichtlich vorhanden (WEB_INBOX.md 09.09. "Automatisches Abmelden
    // bei Spam"): beweist im Smoketest, dass die automatische Abmeldung
    // bei Phishing NICHT auslöst, obwohl ein syntaktisch gültiger Header
    // vorliegt -- gilt laut Auftrag ausschließlich für classification='spam'.
    rawHeaders: {
      From: "Kundenservice <service@sicherheit-konto-check.tk>",
      "Reply-To": "reply@andere-domain.ru",
      "Received-SPF": "fail",
      "Content-Type": "text/plain",
      "List-Unsubscribe": "<mailto:fake-unsubscribe@sicherheit-konto-check.tk>",
      Received: "from unknown (unknown [185.220.101.7]) by mx.example.com",
    },
    attachments: [],
  },
  {
    messageIdHeader: "<fixture-3@newsletter-deals.example>",
    providerMessageId: null,
    fromAddress: "deals@newsletter-deals.example",
    fromDisplayName: "Deals Newsletter",
    replyToAddress: null,
    subject: "Gewinnspiel: Jetzt gratis Preise sichern!",
    bodyText: "Nehmen Sie an unserem Gewinnspiel teil und sichern Sie sich 50% Rabatt — einmalige Chance, jetzt kaufen!",
    receivedAt: daysAgo(2),
    // integration (09.09.): Track B's echte classify() (siehe
    // classification.ts) bewertet nur phishing-artige Signale
    // (Auth-Fail/Homoglyph/Link-Mismatch/Dringlichkeitssprache), nicht
    // Werbe-Inhalte selbst -- reiner Marketing-Text allein landet dort bei
    // "unclear", nicht "spam" (anders als beim alten Mock, der direkt auf
    // SPAM_KEYWORDS matchte). `Received-SPF: fail` ist auch hier nicht
    // künstlich: ein häufiger, ganz realer Grund, warum Marketing-/
    // Newsletter-Mails im echten Leben im Spam-Ordner landen, ist ein
    // falsch konfigurierter SPF-Eintrag beim Massenversender, nicht der
    // Inhalt selbst. Ergibt classification "spam" + spamSubcategory
    // "marketing" (nicht adult/gambling, landet also regulär im
    // Spam-Ordner statt automatisch gelöscht zu werden, siehe Fixture 5).
    rawHeaders: {
      From: "Deals Newsletter <deals@newsletter-deals.example>",
      "List-Unsubscribe": "<mailto:unsubscribe@newsletter-deals.example>",
      "Content-Type": "text/plain",
      "Received-SPF": "fail",
    },
    attachments: [],
  },
  {
    messageIdHeader: "<fixture-4@kollegin.example.com>",
    providerMessageId: null,
    fromAddress: "kollegin@example.com",
    fromDisplayName: "Anna Kollegin",
    replyToAddress: null,
    subject: "Projektupdate Q3",
    bodyText: "Hi, anbei das Update zum Projekt. Bitte antworten bis Freitag mit deinem Feedback. Danke!",
    receivedAt: daysAgo(0),
    rawHeaders: { From: "Anna Kollegin <kollegin@example.com>", "Received-SPF": "pass", "Content-Type": "text/plain" },
    // [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan":
    // absichtlich EIN infizierter Anhang bei einem sonst voellig
    // unauffaelligen, vertrauenswuerdigen Absender -- genau der im Auftrag
    // beschriebene Fall ("koennte z.B. ein legitimer Absender mit einem
    // versehentlich infizierten Anhang sein"), der Auslöser dafür, dass
    // eine als malicious erkannte eingehende Mail NICHT automatisch
    // verworfen wird (anders als beim spam/gambling-Auto-Delete-Pfad),
    // sondern sichtbar bleibt und nur der Anhang selbst gesperrt wird.
    // EICAR-Test-Signatur (offizieller, ungefaehrlicher AV-Test-String,
    // von jedem echten Virenscanner inkl. ClamAV als "Virus" erkannt).
    attachments: [
      {
        filename: "projektplan.txt",
        mimeType: "text/plain",
        content: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"),
      },
    ],
  },
  {
    // Auto-Delete-Pfad (WEB_INBOX.md 08.09.): eindeutiger Glücksspiel-Spam
    // -> classification "spam" + spamSubcategory "gambling" -> wird von der
    // Sync-Pipeline NICHT persistiert, siehe mail/sync.ts.
    //
    // integration (09.09.): kein Auth-Signal nötig -- Track B's
    // `classification.ts` erhebt "adult"/"gambling"-Inhalt seit der
    // Integrations-Antwort von Web (SYNC.md 09.09., "eigenständiger
    // Klassifikations-Trigger", security-classification/src/index.ts) selbst
    // zu "spam", auch ohne begleitendes technisches Signal (Auth-Fail/
    // Homoglyph/Link-Mismatch). Realistisch: gerade Sex-/Glücksspiel-Spam ist
    // technisch meist "sauber" versendet, kein SPF-Fail nötig für diese
    // Fixture (anders als zwischenzeitlich, siehe Git-Historie dieser Zeile).
    messageIdHeader: "<fixture-5@casino-bonus-express.example>",
    providerMessageId: null,
    fromAddress: "bonus@casino-bonus-express.example",
    fromDisplayName: "Casino Bonus Express",
    replyToAddress: null,
    subject: "Jackpot wartet: Jetzt gratis Casino-Bonus sichern!",
    bodyText:
      "Spielen Sie jetzt im Online-Casino und sichern Sie sich Ihren Jackpot-Bonus — " +
      "einmalige Chance, jetzt kaufen!",
    receivedAt: daysAgo(3),
    // "List-Unsubscribe" (WEB_INBOX.md 09.09. "Automatisches Abmelden bei
    // Spam", Punkt "Verhalten bei adult/gambling"): beweist im Smoketest,
    // dass die automatische Abmeldung VOR dem Auto-Delete-Verwerfen läuft
    // (messageId=null, da diese Mail nie eine messages-Zeile bekommt).
    rawHeaders: {
      From: "Casino Bonus Express <bonus@casino-bonus-express.example>",
      "Content-Type": "text/plain",
      "Received-SPF": "pass",
      "List-Unsubscribe": "<https://casino-bonus-express.example/unsubscribe?id=42>",
    },
    attachments: [],
  },
  {
    // integration (09.09.): demonstriert echte (nicht Mock-)Klassifikation
    // von Track B -- Homoglyph-Erkennung gab es im alten Mock-KI-Adapter
    // (mockAdapter.ts) gar nicht (homoglyphDetected war dort fest `false`,
    // egal was im Text stand). Der Link-Text unten enthält bewusst ein
    // kyrillisches "а" (U+0430) statt des lateinischen "a" in "apple.com" --
    // für das menschliche Auge nahezu identisch, von
    // security-classification/src/homoglyph.ts aber zuverlässig als
    // Skript-Mix erkannt (siehe detectHomoglyphs()/isHomoglyphDomain()).
    messageIdHeader: "<fixture-6@apple-id-verify.example>",
    providerMessageId: null,
    fromAddress: "support@apple-id-verify.example",
    fromDisplayName: "Apple Support",
    replyToAddress: null,
    subject: "Apple-ID: Verdächtige Aktivität festgestellt",
    bodyText:
      "Wir haben eine verdächtige Aktivität in Ihrem Konto festgestellt. Bitte bestätigen Sie sofort Ihre " +
      "Identität unter http://аpple.com/verify, sonst wird Ihr Konto gesperrt.",
    receivedAt: daysAgo(0),
    // "From" hier zusaetzlich bewusst mit einem Markennamen-Anzeigenamen
    // ueber einer fremden Domain (WEB_INBOX.md 15.09., "Anzeigename-
    // Spoofing-Erkennung") -- dieselbe Fixture demonstriert damit jetzt
    // BEIDE unabhaengigen Phishing-Signale (Homoglyph im Body-Link UND
    // Anzeigename-Spoofing im Header), siehe smoketest.ts.
    rawHeaders: {
      From: "Apple Support <support@apple-id-verify.example>",
      "Received-SPF": "none",
      "Content-Type": "text/plain",
    },
    attachments: [],
  },
  {
    // Auto-Delete-Pfad (WEB_INBOX.md 15.09., "Neue Auto-Loesch-Kategorie:
    // klassischer Vorschussbetrug"): klassisches "Prinz aus Nigeria"-Muster
    // -> classification "spam" + spamSubcategory "advance_fee_scam" -> wird
    // von der Sync-Pipeline NICHT persistiert (gleiche Behandlung wie
    // adult/gambling, siehe mail/sync.ts). Kein Auth-Signal nötig -- der
    // Content-Trigger in security-classification/src/index.ts erhebt
    // eindeutigen Inhalt selbst zu "spam", auch ohne technisches Signal
    // (dieses Muster kommt fast immer als reiner Fließtext ohne Link).
    messageIdHeader: "<fixture-7@erbschaft-mitteilung.example>",
    providerMessageId: null,
    fromAddress: "kanzlei@erbschaft-mitteilung.example",
    fromDisplayName: "Rechtsanwaltskanzlei Dubois",
    replyToAddress: null,
    subject: "Vertrauliche Mitteilung: Erbschaft in Millionenhöhe",
    bodyText:
      "Sehr geehrte Damen und Herren, ich bin der Anwalt eines verstorbenen Geschäftsmann, der Ihnen als " +
      "next of kin ein Vermögen von mehreren Millionen US-Dollar hinterlassen hat. Bitte antworten Sie unter " +
      "strengster Geheimhaltung, damit wir die Übertragung einleiten können.",
    receivedAt: daysAgo(4),
    rawHeaders: {
      From: "Rechtsanwaltskanzlei Dubois <kanzlei@erbschaft-mitteilung.example>",
      "Content-Type": "text/plain",
      "Received-SPF": "pass",
    },
    attachments: [],
  },
  {
    // IBAN-Wechsel im selben Thread (WEB_INBOX.md 15.09., "6 Sicherheits-
    // Ergaenzungen" Punkt 3) -- Teil 1 eines zweiteiligen Rechnungs-Threads:
    // die urspruengliche, unauffaellige Rechnung mit der ERSTEN IBAN. Fixture
    // 9 (direkt danach) ist die Thread-Antwort mit einer ANDEREN IBAN --
    // klassischer Rechnungsbetrug-Trick. Muss VOR Fixture 9 in diesem Array
    // stehen, damit sie beim sequenziellen Sync bereits als Thread-
    // Vorgaenger auffindbar ist (siehe mail/sync.ts, store.findMessageByHeader).
    messageIdHeader: "<fixture-8@lieferant-beispiel.de>",
    providerMessageId: null,
    fromAddress: "buchhaltung@lieferant-beispiel.de",
    fromDisplayName: "Lieferant Beispiel GmbH",
    replyToAddress: null,
    subject: "Rechnung Nr. 2026-0917",
    bodyText:
      "Anbei unsere Rechnung für die letzte Lieferung. Bitte überweisen Sie den Betrag auf unser Konto: " +
      "DE89 3704 0044 0532 0130 00. Vielen Dank.",
    receivedAt: daysAgo(5),
    rawHeaders: {
      From: "Lieferant Beispiel GmbH <buchhaltung@lieferant-beispiel.de>",
      "Received-SPF": "pass",
      "Content-Type": "text/plain",
    },
    attachments: [],
  },
  {
    // Thread-Antwort auf Fixture 8 (siehe "In-Reply-To") mit einer ANDEREN
    // IBAN als der Original-Rechnung -- der eigentliche Testfall fuer
    // ibanChangedInThread. Bewusst technisch "sauber" (SPF pass, kein
    // Homoglyph/Link-Mismatch/Reply-To-Mismatch, keine starke
    // Dringlichkeitssprache) -- genau das macht den IBAN-Wechsel-im-Thread-
    // Check wertvoll: die anderen Signale allein wuerden diesen Betrugsfall
    // nicht auffangen.
    messageIdHeader: "<fixture-9@lieferant-beispiel.de>",
    providerMessageId: null,
    fromAddress: "buchhaltung@lieferant-beispiel.de",
    fromDisplayName: "Lieferant Beispiel GmbH",
    replyToAddress: null,
    subject: "Re: Rechnung Nr. 2026-0917",
    bodyText:
      "Kurzes Update: bitte nutzen Sie ab sofort unser neues Konto für die Überweisung: " +
      "DE68 2105 0170 0012 3456 78. Vielen Dank für Ihr Verständnis.",
    receivedAt: daysAgo(4),
    rawHeaders: {
      From: "Lieferant Beispiel GmbH <buchhaltung@lieferant-beispiel.de>",
      "In-Reply-To": "<fixture-8@lieferant-beispiel.de>",
      "Received-SPF": "pass",
      "Content-Type": "text/plain",
    },
    // [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan", Punkt 3
    // ("Magic-Bytes-Pruefung"): eine als "rechnung.pdf" getarnte, aber
    // tatsaechlich ausfuehrbare Datei (echter PE-"MZ"-Header) -- der
    // klassische Verschleierungstrick, den die reine Endungs-/ClamAV-Pruefung
    // allein nicht zuverlaessig faengt, siehe magicBytes.ts.
    attachments: [
      {
        filename: "rechnung.pdf",
        mimeType: "application/pdf",
        content: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]),
      },
    ],
  },
];

export class FixtureMailAdapter implements MailAdapter {
  async testConnection(): Promise<void> {
    // immer erfolgreich
  }

  async fetchRecentMessages(limit: number): Promise<FetchedMail[]> {
    return FIXTURES.slice(0, limit);
  }

  // Provider-Spiegelung (WEB_INBOX.md 08.09. Punkt 3): Fixtures sind kein
  // echtes Postfach, es gibt nichts zu spiegeln -- bewusstes No-Op, kein
  // Platzhalter-TODO wie zuvor bei Gmail/IMAP.
  async trashMessage(): Promise<void> {}
  async permanentlyDeleteMessage(): Promise<void> {}

  // POST /messages/send (WEB_INBOX.md 09.09.): kein echtes Postfach dahinter
  // -- simuliert einen erfolgreichen Versand mit einer eindeutigen, aber
  // erfundenen providerMessageId, damit der Rest der Pipeline (Smoketest,
  // `npm run dev` ohne jede Konfiguration) end-to-end durchläuft.
  async sendMail(_input: SendMailInput): Promise<SendMailResult> {
    return { providerMessageId: `fixture-sent-${randomUUID()}` };
  }
}
