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
    rawHeaders: { "List-Unsubscribe": "<mailto:unsubscribe@newsletter-deals.example>", "Content-Type": "text/plain", "Received-SPF": "fail" },
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
    fromAddress: "bonus@casino-bonus-express.example",
    fromDisplayName: "Casino Bonus Express",
    replyToAddress: null,
    subject: "Jackpot wartet: Jetzt gratis Casino-Bonus sichern!",
    bodyText:
      "Spielen Sie jetzt im Online-Casino und sichern Sie sich Ihren Jackpot-Bonus — " +
      "einmalige Chance, jetzt kaufen!",
    receivedAt: daysAgo(3),
    rawHeaders: { "Content-Type": "text/plain", "Received-SPF": "pass" },
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
    fromAddress: "support@apple-id-verify.example",
    fromDisplayName: "Apple Support",
    replyToAddress: null,
    subject: "Apple-ID: Verdächtige Aktivität festgestellt",
    bodyText:
      "Wir haben eine verdächtige Aktivität in Ihrem Konto festgestellt. Bitte bestätigen Sie sofort Ihre " +
      "Identität unter http://аpple.com/verify, sonst wird Ihr Konto gesperrt.",
    receivedAt: daysAgo(0),
    rawHeaders: { "Received-SPF": "none", "Content-Type": "text/plain" },
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
