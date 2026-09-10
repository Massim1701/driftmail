// driftmail — Mock-Daten für den lokalen Mock-Server (Track F)
//
// Form der Objekte folgt exakt contracts/api-spec.yaml (camelCase Feldnamen).
// Die IDs sind stabile fixe UUIDs, damit Deep-Links beim Neustart stabil bleiben.

export const accounts = [
  {
    id: "a1000000-0000-0000-0000-000000000001",
    provider: "gmail",
    emailAddress: "massimo@example.com",
    syncStatus: "ok",
  },
];

// ---- Ordner ----
// 7 System-Ordner (is_system=true, system_key gesetzt, wie contracts/db-schema.sql
// "folders" + contracts/design-tokens.json "systemFolders.defaults") plus zwei
// Beispiel-Ordner, die der User selbst angelegt hat (is_system=false,
// system_key=null), um zu zeigen dass eigene Ordner unterstützt werden.
//
// [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
// Ordner-Umbau-Eintrags"): "wichtig" -> "eingang" (echte automatische
// Landezone statt "sonstiges"), "rechnungen" ist jetzt ein normaler
// benutzerdefinierter Ordner (kein System-Ordner mehr, User kann sowas
// selbst anlegen), "entwuerfe"/"gesendet" sind neu.
export const folders = [
  {
    id: "f1000000-0000-0000-0000-000000000001",
    name: "Eingang",
    icon: "inbox",
    is_system: true,
    system_key: "eingang",
    sort_order: 0,
  },
  {
    id: "f1000000-0000-0000-0000-000000000007",
    name: "Entwürfe",
    icon: "file-pencil",
    is_system: true,
    system_key: "entwuerfe",
    sort_order: 1,
  },
  {
    id: "f1000000-0000-0000-0000-000000000008",
    name: "Gesendet",
    icon: "send",
    is_system: true,
    system_key: "gesendet",
    sort_order: 2,
  },
  {
    id: "f1000000-0000-0000-0000-000000000002",
    name: "Sonstiges",
    icon: "folder",
    is_system: true,
    system_key: "sonstiges",
    sort_order: 3,
  },
  {
    id: "f1000000-0000-0000-0000-000000000004",
    name: "Quarantäne",
    icon: "shield-exclamation",
    is_system: true,
    system_key: "quarantaene",
    sort_order: 4,
  },
  {
    id: "f1000000-0000-0000-0000-000000000005",
    name: "Spam",
    icon: "trash",
    is_system: true,
    system_key: "spam",
    sort_order: 5,
  },
  // Nachtrag 08.09. (WEB_INBOX.md "Fehlende Basis-Funktion entdeckt", Contract-Commit
  // 156f0fd): System-Ordner für manuelles Löschen (soft delete), analog zu Gmail --
  // nicht umbenennbar/löschbar wie quarantaene/spam.
  {
    id: "f1000000-0000-0000-0000-000000000006",
    name: "Papierkorb",
    icon: "trash-2",
    is_system: true,
    system_key: "papierkorb",
    sort_order: 6,
  },
  // Beispiel für einen benutzerdefinierten Ordner (icon = customFolder.defaultIcon
  // aus design-tokens.json, weil der User beim Anlegen kein eigenes Icon gewählt hat).
  {
    id: "f2000000-0000-0000-0000-000000000001",
    name: "Familie",
    icon: "folder",
    is_system: false,
    system_key: null,
    sort_order: 7,
  },
  // War bis zum Ordner-Umbau (09.09.) ein System-Ordner -- jetzt ein
  // normaler benutzerdefinierter, id bewusst unverändert (bestehende
  // Nachrichten bleiben unter derselben folderId auffindbar).
  {
    id: "f1000000-0000-0000-0000-000000000003",
    name: "Rechnungen",
    icon: "receipt",
    is_system: false,
    system_key: null,
    sort_order: 8,
  },
];

export function folderSummary(f) {
  return {
    id: f.id,
    name: f.name,
    icon: f.icon,
    isSystem: f.is_system,
    systemKey: f.system_key,
    sortOrder: f.sort_order,
  };
}

export function folderById(id) {
  return folders.find((f) => f.id === id);
}

export function folderBySystemKey(key) {
  return folders.find((f) => f.system_key === key);
}

// System-Ordner, bei denen Umbenennen/Icon-Ändern/Löschen serverseitig
// abgelehnt wird (1:1 "renamable": false in design-tokens.json "systemFolders.defaults").
const NOT_RENAMABLE_SYSTEM_KEYS = new Set(["quarantaene", "spam", "papierkorb", "entwuerfe", "gesendet"]);

export function isRenamable(folder) {
  if (!folder.is_system) return true;
  return !NOT_RENAMABLE_SYSTEM_KEYS.has(folder.system_key);
}

function securityOk() {
  return {
    spfStatus: "pass",
    dkimStatus: "pass",
    dmarcStatus: "pass",
    senderDomainAgeDays: 3210,
    domainReputationScore: 0.94,
    homoglyphDetected: false,
    linkMismatchDetected: false,
    urgencyLanguageScore: 0.05,
    containsNewIban: false,
    classification: "safe",
    confidenceScore: 0.97,
  };
}

function securityUnclear() {
  return {
    spfStatus: "pass",
    dkimStatus: "none",
    dmarcStatus: "none",
    senderDomainAgeDays: 412,
    domainReputationScore: 0.58,
    homoglyphDetected: false,
    linkMismatchDetected: false,
    urgencyLanguageScore: 0.31,
    containsNewIban: false,
    classification: "unclear",
    confidenceScore: 0.52,
  };
}

function securitySpam() {
  return {
    spfStatus: "fail",
    dkimStatus: "none",
    dmarcStatus: "fail",
    senderDomainAgeDays: 44,
    domainReputationScore: 0.12,
    homoglyphDetected: false,
    linkMismatchDetected: true,
    urgencyLanguageScore: 0.72,
    containsNewIban: false,
    classification: "spam",
    confidenceScore: 0.88,
  };
}

function securityPhishing() {
  return {
    spfStatus: "fail",
    dkimStatus: "fail",
    dmarcStatus: "fail",
    senderDomainAgeDays: 6,
    domainReputationScore: 0.03,
    homoglyphDetected: true,
    linkMismatchDetected: true,
    urgencyLanguageScore: 0.93,
    containsNewIban: true,
    classification: "phishing",
    confidenceScore: 0.96,
  };
}

const EINGANG = folderBySystemKey("eingang").id;
const SONSTIGES = folderBySystemKey("sonstiges").id;
// Kein System-Ordner mehr seit dem Ordner-Umbau (09.09.) -- deshalb fester
// id-String statt folderBySystemKey("rechnungen") (liefert jetzt undefined).
const RECHNUNGEN = "f1000000-0000-0000-0000-000000000003";
const QUARANTAENE = folderBySystemKey("quarantaene").id;
const SPAM = folderBySystemKey("spam").id;
const PAPIERKORB = folderBySystemKey("papierkorb").id;
const FAMILIE = "f2000000-0000-0000-0000-000000000001";

// message: { id, fromAddress, fromDisplayName, subject, receivedAt, folderId, classification, bodyText, security }
export const messages = [
  // ---- eingang ----
  {
    id: "b1000000-0000-0000-0000-000000000001",
    fromAddress: "hr@arbeitgeber-gmbh.de",
    fromDisplayName: "Arbeitgeber GmbH – Personal",
    subject: "Ihre Gehaltsabrechnung für August",
    receivedAt: "2026-09-07T08:12:00Z",
    folderId: EINGANG,
    security: securityOk(),
    bodyText:
      "Hallo Massimo,\n\nanbei Ihre Gehaltsabrechnung für August. Bei Rückfragen wenden Sie sich gerne an die Personalabteilung.\n\nViele Grüße\nIhre Personalabteilung",
  },
  {
    id: "b1000000-0000-0000-0000-000000000002",
    fromAddress: "termine@zahnarzt-mueller.de",
    fromDisplayName: "Zahnarztpraxis Müller",
    subject: "Terminerinnerung: 12.09. 10:30 Uhr",
    receivedAt: "2026-09-06T17:40:00Z",
    folderId: EINGANG,
    security: securityOk(),
    bodyText:
      "Guten Tag,\n\nwir erinnern Sie an Ihren Termin am 12.09.2026 um 10:30 Uhr. Bitte kommen Sie 10 Minuten früher.\n\nIhre Praxis Müller",
  },
  {
    id: "b1000000-0000-0000-0000-000000000003",
    fromAddress: "notar.weber@notariat-weber.de",
    fromDisplayName: "Notariat Weber",
    subject: "Unterlagen zur Unterschrift bereit",
    receivedAt: "2026-09-05T09:03:00Z",
    folderId: EINGANG,
    security: securityOk(),
    bodyText:
      "Sehr geehrter Herr Manca,\n\ndie besprochenen Unterlagen liegen zur Unterschrift bereit. Bitte vereinbaren Sie einen Termin in unserer Kanzlei.\n\nMit freundlichen Grüßen\nNotariat Weber",
  },

  // ---- sonstiges ----
  {
    id: "b2000000-0000-0000-0000-000000000001",
    fromAddress: "newsletter@techblog.io",
    fromDisplayName: "Techblog Weekly",
    subject: "5 Dinge, die diese Woche in der Tech-Welt passiert sind",
    receivedAt: "2026-09-07T06:00:00Z",
    folderId: SONSTIGES,
    security: securityUnclear(),
    bodyText:
      "Diese Woche: neue Browser-APIs, ein Update zu WASM-GC und mehr. Viel Spaß beim Lesen!",
  },
  {
    id: "b2000000-0000-0000-0000-000000000002",
    fromAddress: "no-reply@meetup.com",
    fromDisplayName: "Meetup",
    subject: "Neue Events in deiner Nähe",
    receivedAt: "2026-09-06T12:00:00Z",
    folderId: SONSTIGES,
    security: securityUnclear(),
    bodyText: "Es gibt neue Meetups in deiner Region, die dich interessieren könnten.",
  },
  {
    id: "b2000000-0000-0000-0000-000000000003",
    fromAddress: "kontakt@nachbarschaft-forum.de",
    fromDisplayName: "Nachbarschaftsforum",
    subject: "Neue Antwort auf deinen Beitrag",
    receivedAt: "2026-09-04T19:22:00Z",
    folderId: SONSTIGES,
    security: securityOk(),
    bodyText: "Jemand hat auf deinen Beitrag 'Kompost-Tipps gesucht' geantwortet.",
  },

  // ---- rechnungen ----
  {
    id: "b3000000-0000-0000-0000-000000000001",
    fromAddress: "billing@streaming-plus.com",
    fromDisplayName: "Streaming Plus",
    subject: "Ihre Rechnung für September ist verfügbar",
    receivedAt: "2026-09-07T03:00:00Z",
    folderId: RECHNUNGEN,
    security: securityOk(),
    bodyText:
      "Ihre monatliche Rechnung über 12,99 € für den Zeitraum 01.09.–30.09. steht zum Download bereit. Vertragslaufzeit verlängert sich automatisch, sofern nicht bis 15.09. gekündigt wird.",
  },
  {
    id: "b3000000-0000-0000-0000-000000000002",
    fromAddress: "rechnung@stadtwerke-musterstadt.de",
    fromDisplayName: "Stadtwerke Musterstadt",
    subject: "Jahresabrechnung Strom 2025/2026",
    receivedAt: "2026-09-03T11:15:00Z",
    folderId: RECHNUNGEN,
    security: securityOk(),
    bodyText:
      "Anbei Ihre Jahresabrechnung für Strom. Guthaben: 34,20 €, wird mit der nächsten Abschlagszahlung verrechnet.",
  },
  {
    id: "b3000000-0000-0000-0000-000000000003",
    fromAddress: "billing@fitnessclub-aktiv.de",
    fromDisplayName: "Fitnessclub Aktiv",
    subject: "Mitgliedsbeitrag September abgebucht",
    receivedAt: "2026-09-01T07:30:00Z",
    folderId: RECHNUNGEN,
    security: securityUnclear(),
    bodyText:
      "Wir haben Ihren Mitgliedsbeitrag in Höhe von 39,90 € abgebucht. Ihr Vertrag verlängert sich automatisch um 12 Monate, Kündigungsfrist 3 Monate zum Laufzeitende.",
  },

  // ---- quarantaene (phishing/spam, für Security-Badge & Quarantäne-Ansicht) ----
  {
    id: "b4000000-0000-0000-0000-000000000001",
    fromAddress: "service@paypaI-secure-login.com",
    fromDisplayName: "PayPal Sicherheitsteam",
    subject: "Dringend: Ihr Konto wird gesperrt – jetzt verifizieren",
    receivedAt: "2026-09-07T22:41:00Z",
    folderId: QUARANTAENE,
    security: securityPhishing(),
    bodyText:
      "Wir haben ungewöhnliche Aktivitäten festgestellt. Bestätigen Sie sofort Ihre Daten über den folgenden Link, sonst wird Ihr Konto innerhalb von 24 Stunden gesperrt.\n\nNeue IBAN zur Rückerstattung: DE00 1234 5678 9000 0000 00",
  },
  {
    id: "b4000000-0000-0000-0000-000000000002",
    fromAddress: "support@amaz0n-kundenservice.net",
    fromDisplayName: "Amazon Kundenservice",
    subject: "Problem mit Ihrer letzten Bestellung – Handlung erforderlich",
    receivedAt: "2026-09-06T14:05:00Z",
    folderId: QUARANTAENE,
    security: securityPhishing(),
    bodyText:
      "Ihre Zahlungsmethode konnte nicht verifiziert werden. Klicken Sie hier, um Ihre Zahlungsdaten innerhalb von 12 Stunden zu aktualisieren, sonst wird Ihre Bestellung storniert.",
  },
  {
    id: "b4000000-0000-0000-0000-000000000003",
    fromAddress: "info@gewinn-benachrichtigung.top",
    fromDisplayName: "Gewinnbenachrichtigung",
    subject: "Sie haben 950.000 € gewonnen!!!",
    receivedAt: "2026-09-05T02:17:00Z",
    folderId: QUARANTAENE,
    security: securityPhishing(),
    bodyText:
      "Herzlichen Glückwunsch! Um Ihren Gewinn zu erhalten, senden Sie uns umgehend Ihre Bankverbindung und eine Kopie Ihres Ausweises.",
  },

  // ---- spam ----
  {
    id: "b5000000-0000-0000-0000-000000000001",
    fromAddress: "deals@mega-sonderangebote.biz",
    fromDisplayName: "Mega Sonderangebote",
    subject: "NUR HEUTE: -70% auf alles",
    receivedAt: "2026-09-07T05:00:00Z",
    folderId: SPAM,
    security: securitySpam(),
    bodyText: "Riesenrabatte nur für kurze Zeit. Jetzt zuschlagen, bevor es zu spät ist!",
    // Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09.): Mock für den
    // List-Unsubscribe-Header, den das echte Backend syntaktisch auswertet
    // (backend/src/mail/listUnsubscribe.ts) -- hier nur ein einfaches Flag,
    // da der Mock-Server keine echten rawHeaders modelliert.
    hasListUnsubscribe: true,
  },
  {
    id: "b5000000-0000-0000-0000-000000000002",
    fromAddress: "noreply@wundermittel-shop.ru",
    fromDisplayName: "Wundermittel Shop",
    subject: "Ärzte hassen diesen einen Trick",
    receivedAt: "2026-09-06T23:59:00Z",
    folderId: SPAM,
    security: securitySpam(),
    bodyText: "Verlieren Sie 10kg in einer Woche mit diesem einfachen Trick.",
    hasListUnsubscribe: true,
  },
  {
    id: "b5000000-0000-0000-0000-000000000003",
    fromAddress: "promo@krypto-verdopplung.io",
    fromDisplayName: "Krypto Verdopplung",
    subject: "Verdoppeln Sie Ihr Krypto-Investment in 24 Stunden",
    receivedAt: "2026-09-04T08:00:00Z",
    folderId: SPAM,
    security: securitySpam(),
    bodyText: "Senden Sie uns Bitcoin und erhalten Sie garantiert das Doppelte zurück.",
  },

  // ---- papierkorb (Beispiele für manuell gelöschte Mails, soft delete) ----
  {
    id: "b7000000-0000-0000-0000-000000000001",
    fromAddress: "newsletter@altes-abo.de",
    fromDisplayName: "Altes Abo Newsletter",
    subject: "Unser Angebot der Woche",
    receivedAt: "2026-09-02T09:10:00Z",
    folderId: PAPIERKORB,
    security: securityOk(),
    bodyText: "Diese Woche mit dabei: neue Produkte im Sortiment. Diese Mail wurde vom User manuell gelöscht.",
  },
  {
    id: "b7000000-0000-0000-0000-000000000002",
    fromAddress: "kontakt@alter-kontakt.de",
    fromDisplayName: "Alter Kontakt",
    subject: "Re: Kurze Frage",
    receivedAt: "2026-08-30T15:45:00Z",
    folderId: PAPIERKORB,
    security: securityOk(),
    bodyText: "Danke für die schnelle Antwort, hat sich erledigt. Diese Mail wurde vom User manuell gelöscht.",
  },

  // ---- Familie (Beispiel für einen benutzerdefinierten Ordner) ----
  {
    id: "b6000000-0000-0000-0000-000000000001",
    fromAddress: "mama@example.com",
    fromDisplayName: "Mama",
    subject: "Sonntag Mittagessen?",
    receivedAt: "2026-09-07T18:00:00Z",
    folderId: FAMILIE,
    security: securityOk(),
    bodyText: "Hallo Schatz,\n\nkommst du am Sonntag zum Mittagessen? Es gibt deine Lieblingspasta.\n\nLiebe Grüße,\nMama",
  },
];

function classificationOf(msg) {
  return msg.security.classification;
}

export function messageSummary(msg) {
  // Message-Schema (ohne bodyText/security)
  return {
    id: msg.id,
    fromAddress: msg.fromAddress,
    fromDisplayName: msg.fromDisplayName,
    subject: msg.subject,
    receivedAt: msg.receivedAt,
    folderId: msg.folderId,
    classification: classificationOf(msg),
  };
}

export function messageDetail(msg) {
  return {
    ...messageSummary(msg),
    bodyText: msg.bodyText,
    security: msg.security,
    canUnsubscribe: msg.hasListUnsubscribe === true,
  };
}

// Liefert den system_key des Ordners, in dem eine Nachricht aktuell liegt
// (null bei eigenen Ordnern oder falls der Ordner inzwischen gelöscht wurde).
export function systemKeyOfMessage(msg) {
  const folder = folderById(msg.folderId);
  return folder ? folder.system_key : null;
}

// Contract-Objekte tragen intern "messageId" zur Verknüpfung mit der
// auslösenden Mail (nicht Teil des api-spec.yaml Contract-Schemas) -
// beim Serialisieren nach außen strikt auf die Contract-Felder reduzieren.
export function contractSummary(c) {
  return {
    id: c.id,
    providerName: c.providerName,
    contractStart: c.contractStart,
    contractEnd: c.contractEnd,
    cancellationDeadline: c.cancellationDeadline,
    cancellationPeriodDays: c.cancellationPeriodDays,
    status: c.status,
    extractedConfidence: c.extractedConfidence,
  };
}

// contract: id, providerName, contractStart, contractEnd, cancellationDeadline,
// cancellationPeriodDays, status, extractedConfidence
export const contracts = [
  {
    id: "c1000000-0000-0000-0000-000000000001",
    messageId: "b3000000-0000-0000-0000-000000000001",
    providerName: "Streaming Plus",
    contractStart: "2025-09-01",
    contractEnd: "2026-09-30",
    cancellationDeadline: "2026-09-15",
    cancellationPeriodDays: 30,
    status: "active",
    extractedConfidence: 0.91,
  },
  {
    id: "c1000000-0000-0000-0000-000000000002",
    messageId: "b3000000-0000-0000-0000-000000000003",
    providerName: "Fitnessclub Aktiv",
    contractStart: "2025-09-01",
    contractEnd: "2026-09-01",
    cancellationDeadline: "2026-06-01",
    cancellationPeriodDays: 90,
    status: "needs_review",
    extractedConfidence: 0.63,
  },
];

// "Rechnungen" ist seit dem Ordner-Umbau (09.09.) kein System-Ordner mehr
// (systemKeyOfMessage() liefert dafür null) -- die Demo-Sonderbehandlung
// (Deadline/actionRequired) prüft deshalb direkt gegen die feste folderId
// statt gegen einen system_key.
export function summaryFor(msg) {
  const isRechnung = msg.folderId === RECHNUNGEN;
  const actionRequired =
    msg.security.classification === "phishing" || msg.security.classification === "spam" ? false : isRechnung;
  return {
    summaryText: shortSummary(msg),
    actionRequired,
    actionDescription: actionRequired
      ? "Prüfen, ob eine Kündigungsfrist läuft oder eine Zahlung fällig ist."
      : null,
    deadline: isRechnung ? "2026-09-15" : null,
    source: "cloud_fallback",
  };
}

function shortSummary(msg) {
  if (msg.folderId === RECHNUNGEN) {
    return "Rechnung bzw. Abbuchung, ggf. mit automatischer Vertragsverlängerung.";
  }
  switch (systemKeyOfMessage(msg)) {
    case "quarantaene":
      return "Verdächtige Mail mit Aufforderung, sofort persönliche oder Bankdaten preiszugeben.";
    case "spam":
      return "Werbe-/Massenmail ohne relevanten Inhalt für dich.";
    default:
      return msg.subject;
  }
}
