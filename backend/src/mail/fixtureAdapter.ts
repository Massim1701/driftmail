// Fixture-Adapter: liefert feste Beispiel-Mails statt echter Provider-Calls.
// Wird verwendet, wenn für ein mail_accounts-Konto keine echten Zugangsdaten
// hinterlegt sind (Standardfall in diesem ersten Durchstich — siehe README).
// So bleibt `npm run dev` ohne jede Konfiguration lauffähig und der
// Kernfluss (Sync -> Security-Analyse -> Ordner -> Vertrag -> Summary)
// end-to-end sichtbar.

import type { FetchedMail, MailAdapter } from "./types";

const now = () => new Date();
const daysAgo = (n: number) => new Date(now().getTime() - n * 24 * 3600 * 1000).toISOString();

const FIXTURES: FetchedMail[] = [
  {
    messageIdHeader: "<fixture-1@beispiel-versicherung.de>",
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
    rawHeaders: { "Received-SPF": "pass", "Content-Type": "text/plain", "X-Originating-IP": "[203.0.113.10]" },
  },
  {
    messageIdHeader: "<fixture-2@sicherheit-konto-check.tk>",
    fromAddress: "service@sicherheit-konto-check.tk",
    fromDisplayName: "Kundenservice",
    replyToAddress: "reply@andere-domain.ru",
    subject: "Wichtig: Konto gesperrt — jetzt Passwort bestätigen",
    bodyText:
      "Ihr Konto wurde vorübergehend gesperrt. Klicken Sie sofort auf den Link und bestätigen Sie Ihr Passwort, " +
      "sonst wird Ihr Konto endgültig gelöscht. Neue IBAN für Rückerstattung: DE00 1234 5678 9012 3456 00.",
    receivedAt: daysAgo(0),
    // "Received" enthält hier absichtlich eine IP aus der Beispiel-
    // "Botnetz"-Liste im IP-Reputations-Mock (siehe ipReputationMock.ts),
    // damit der "known_botnet"-Fall im Smoketest ohne echten Blocklist-
    // Zugriff durchgetestet werden kann.
    rawHeaders: {
      "Received-SPF": "fail",
      "Content-Type": "text/plain",
      Received: "from unknown (unknown [185.220.101.7]) by mx.example.com",
    },
  },
  {
    messageIdHeader: "<fixture-3@newsletter-deals.example>",
    fromAddress: "deals@newsletter-deals.example",
    fromDisplayName: "Deals Newsletter",
    replyToAddress: null,
    subject: "Gewinnspiel: Jetzt gratis Preise sichern!",
    bodyText: "Nehmen Sie an unserem Gewinnspiel teil und sichern Sie sich 50% Rabatt — einmalige Chance, jetzt kaufen!",
    receivedAt: daysAgo(2),
    rawHeaders: { "List-Unsubscribe": "<mailto:unsubscribe@newsletter-deals.example>", "Content-Type": "text/plain" },
  },
  {
    messageIdHeader: "<fixture-4@kollegin.example.com>",
    fromAddress: "kollegin@example.com",
    fromDisplayName: "Anna Kollegin",
    replyToAddress: null,
    subject: "Projektupdate Q3",
    bodyText: "Hi, anbei das Update zum Projekt. Bitte antworten bis Freitag mit deinem Feedback. Danke!",
    receivedAt: daysAgo(0),
    rawHeaders: { "Received-SPF": "pass", "Content-Type": "text/plain" },
  },
  {
    // Auto-Delete-Pfad (WEB_INBOX.md 08.09.): eindeutiger Glücksspiel-Spam
    // -> classification "spam" + spamSubcategory "gambling" (Mock-Heuristik,
    // siehe ai/mockAdapter.ts) -> wird von der Sync-Pipeline NICHT
    // persistiert, siehe mail/sync.ts.
    messageIdHeader: "<fixture-5@casino-bonus-express.example>",
    fromAddress: "bonus@casino-bonus-express.example",
    fromDisplayName: "Casino Bonus Express",
    replyToAddress: null,
    subject: "Jackpot wartet: Jetzt gratis Casino-Bonus sichern!",
    bodyText:
      "Spielen Sie jetzt im Online-Casino und sichern Sie sich Ihren Jackpot-Bonus — " +
      "einmalige Chance, jetzt kaufen!",
    receivedAt: daysAgo(3),
    rawHeaders: { "Content-Type": "text/plain" },
  },
];

export class FixtureMailAdapter implements MailAdapter {
  async testConnection(): Promise<void> {
    // immer erfolgreich
  }

  async fetchRecentMessages(limit: number): Promise<FetchedMail[]> {
    return FIXTURES.slice(0, limit);
  }
}
