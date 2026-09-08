// Einfacher End-to-End-Smoketest ohne Testframework: startet die App
// in-process, spielt den Kernfluss durch und prüft grob die Response-Form
// gegen contracts/api-spec.yaml. `npm test` führt das aus.

import { createApp } from "./app";
import { ensureDemoUser, store } from "./db/store";
import { syncAccount } from "./mail/sync";
import { aiAdapter } from "./ai";
import { domainReputationLookup, extractIbanCandidates, ibanHistoryCheck } from "./lookups";
import type { Server } from "node:http";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Smoketest fehlgeschlagen: ${msg}`);
}

async function main() {
  const { account } = ensureDemoUser();
  const { imported, autoDeleted } = await syncAccount(account, aiAdapter);
  assert(imported > 0, "Fixture-Sync sollte Nachrichten importieren");

  // Auto-Delete-Pfad (WEB_INBOX.md 08.09., siehe mail/sync.ts): Fixture 5
  // ist eindeutiger Glücksspiel-Spam und darf NICHT als Nachricht landen.
  assert(autoDeleted === 1, "genau 1 adult/gambling-Spam-Mail sollte automatisch gelöscht worden sein (Fixture 5)");
  assert(
    store.findMessageByHeader(account.id, "<fixture-5@casino-bonus-express.example>") === undefined,
    "auto-gelöschte Mail darf keine messages-Zeile bekommen",
  );
  assert(
    store.securityAuditLog.some(
      (e) => e.action === "auto_deleted_adult_gambling_spam" && e.userId === account.userId && e.messageId === null,
    ),
    "Auto-Delete sollte einen security_audit_log-Eintrag hinterlassen (messageId=null, da nie angelegt)",
  );

  // Erneuter Sync darf dieselbe Mail nicht nochmal löschen/loggen (Dedupe
  // über store.autoDeletedHeaders, siehe store.ts-Kommentar).
  const second = await syncAccount(account, aiAdapter);
  assert(second.autoDeleted === 0, "wiederholter Sync sollte dieselbe auto-gelöschte Mail nicht erneut zählen");
  assert(
    store.securityAuditLog.filter((e) => e.action === "auto_deleted_adult_gambling_spam").length === 1,
    "wiederholter Sync sollte keinen zweiten Audit-Log-Eintrag für dieselbe Mail erzeugen",
  );

  const app = createApp();
  const server: Server = app.listen(0);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("kein Port");
  const base = `http://localhost:${address.port}`;

  try {
    const accountsRes = await fetch(`${base}/v1/accounts`);
    assert(accountsRes.status === 200, "GET /v1/accounts sollte 200 liefern");
    const accounts = await accountsRes.json();
    assert(Array.isArray(accounts) && accounts.length > 0, "mind. 1 Konto erwartet");

    // Ordner: 5 System-Ordner müssen für den Demo-User existieren
    // (Contract-Änderung "benutzerdefinierte Ordner", SYNC.md Commit 734781e).
    const foldersRes = await fetch(`${base}/v1/folders`);
    assert(foldersRes.status === 200, "GET /v1/folders sollte 200 liefern");
    const folders = (await foldersRes.json()) as Array<Record<string, unknown>>;
    assert(Array.isArray(folders) && folders.length === 5, "genau 5 System-Ordner erwartet");
    const spamFolder = folders.find((f) => f.systemKey === "spam");
    const sonstigesFolder = folders.find((f) => f.systemKey === "sonstiges");
    assert(!!spamFolder && !!sonstigesFolder, "System-Ordner 'spam' und 'sonstiges' erwartet");

    const messagesRes = await fetch(`${base}/v1/messages`);
    const messages = await messagesRes.json();
    assert(Array.isArray(messages) && messages.length >= imported, "Nachrichtenliste erwartet");

    const spamRes = await fetch(`${base}/v1/messages?folderId=${(spamFolder as Record<string, unknown>).id}`);
    const spamMessages = await spamRes.json();
    assert(Array.isArray(spamMessages) && spamMessages.length > 0, "mind. 1 Mock-Phishing/Spam-Mail erwartet (Fixtures)");

    // Eigenen Ordner anlegen, umbenennen, Nachricht dorthin verschieben,
    // dann wieder löschen (Nachricht muss dabei zurück nach "sonstiges" fallen).
    const createFolderRes = await fetch(`${base}/v1/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test-Ordner" }),
    });
    assert(createFolderRes.status === 201, "POST /v1/folders sollte 201 liefern");
    const customFolder = (await createFolderRes.json()) as Record<string, unknown>;
    assert(customFolder.isSystem === false, "eigener Ordner sollte isSystem=false haben");

    const renameRes = await fetch(`${base}/v1/folders/${customFolder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Umbenannt" }),
    });
    assert(renameRes.status === 200, "PATCH /v1/folders/:id sollte 200 liefern");

    const renameSpamRes = await fetch(`${base}/v1/folders/${(spamFolder as Record<string, unknown>).id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nicht erlaubt" }),
    });
    assert(renameSpamRes.status === 400, "Umbenennen von 'spam' sollte 400 liefern");

    const first = messages[0];

    const moveRes = await fetch(`${base}/v1/messages/${first.id}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folderId: customFolder.id }),
    });
    assert(moveRes.status === 200, "POST /v1/messages/:id/move sollte 200 liefern");
    const moved = (await moveRes.json()) as Record<string, unknown>;
    assert(moved.folderId === customFolder.id, "Nachricht sollte im Zielordner sein");

    const deleteFolderRes = await fetch(`${base}/v1/folders/${customFolder.id}`, { method: "DELETE" });
    assert(deleteFolderRes.status === 204, "DELETE /v1/folders/:id sollte 204 liefern");

    const movedDetailRes = await fetch(`${base}/v1/messages/${first.id}`);
    const movedDetail = (await movedDetailRes.json()) as Record<string, unknown>;
    assert(
      movedDetail.folderId === (sonstigesFolder as Record<string, unknown>).id,
      "Nachricht sollte nach Löschen des Ordners zurück in 'sonstiges' sein",
    );

    const deleteSystemFolderRes = await fetch(`${base}/v1/folders/${(sonstigesFolder as Record<string, unknown>).id}`, {
      method: "DELETE",
    });
    assert(deleteSystemFolderRes.status === 400, "Löschen eines System-Ordners sollte 400 liefern");
    const detailRes = await fetch(`${base}/v1/messages/${first.id}`);
    assert(detailRes.status === 200, "GET /v1/messages/:id sollte 200 liefern");
    const detail = (await detailRes.json()) as Record<string, unknown>;
    assert(detail.security !== undefined, "MessageDetail sollte security enthalten");

    const summaryRes = await fetch(`${base}/v1/messages/${first.id}/summary`);
    assert(summaryRes.status === 200, "GET .../summary sollte 200 liefern");
    const summary = (await summaryRes.json()) as Record<string, unknown>;
    assert(typeof summary.summaryText === "string", "summaryText erwartet");

    const draftRes = await fetch(`${base}/v1/messages/${first.id}/reply-draft`, { method: "POST" });
    assert(draftRes.status === 200, "POST .../reply-draft sollte 200 liefern");
    const draft = (await draftRes.json()) as Record<string, unknown>;
    assert(typeof draft.draftText === "string", "draftText erwartet");

    const quarantineRes = await fetch(`${base}/v1/messages/${first.id}/quarantine`, { method: "POST" });
    assert(quarantineRes.status === 200, "POST .../quarantine sollte 200 liefern");

    const contractsRes = await fetch(`${base}/v1/contracts`);
    const contracts = await contractsRes.json();
    assert(Array.isArray(contracts) && contracts.length > 0, "mind. 1 Mock-Vertrag erwartet (Fixture 'vertrag/kündigungsfrist')");

    const confirmRes = await fetch(`${base}/v1/contracts/${contracts[0].id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerName: "Bestätigt GmbH" }),
    });
    assert(confirmRes.status === 200, "POST .../confirm sollte 200 liefern");
    const confirmed = (await confirmRes.json()) as Record<string, unknown>;
    assert(confirmed.status === "active", "Vertragsstatus sollte nach confirm 'active' sein");

    const capRes = await fetch(`${base}/v1/capability-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform: "web", onDeviceSupported: false, activeMode: "cloud_fallback" }),
    });
    assert(capRes.status === 200, "POST /v1/capability-check sollte 200 liefern");

    // POST /messages/draft/phishing-check (WEB_INBOX.md 08.09., Mock-Logik
    // siehe src/ai/draftPhishingCheckMock.ts) — Block-Fall: Link-Mismatch
    // (Anzeigetext behauptet paypal.com, Ziel zeigt auf andere Domain).
    const blockedCheckRes = await fetch(`${base}/v1/messages/draft/phishing-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bodyText: "Bitte bestätigen Sie Ihre Daten.",
        links: [{ displayText: "www.paypal.com", actualUrl: "https://paypal-secure-login.example.net/confirm" }],
      }),
    });
    assert(blockedCheckRes.status === 200, "POST .../draft/phishing-check sollte 200 liefern");
    const blockedCheck = (await blockedCheckRes.json()) as Record<string, unknown>;
    assert(blockedCheck.blocked === true, "Link-Mismatch sollte blocked=true liefern");
    assert(typeof blockedCheck.reason === "string" && (blockedCheck.reason as string).length > 0, "blocked sollte einen reason liefern");
    assert(Array.isArray(blockedCheck.riskyLinks) && (blockedCheck.riskyLinks as unknown[]).length === 1, "genau 1 riskyLink erwartet");

    // Nicht-Block-Fall: eigene IBAN mitteilen ist NICHT per se Phishing
    // (siehe WEB_INBOX.md 08.09.) — nur ein nicht-blockierender Warnhinweis
    // über containsSensitiveData, blocked bleibt false.
    const sensitiveCheckRes = await fetch(`${base}/v1/messages/draft/phishing-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bodyText: "Bitte überweisen Sie den Betrag auf meine IBAN DE89 3704 0044 0532 0130 00. Danke!",
        links: [],
      }),
    });
    assert(sensitiveCheckRes.status === 200, "POST .../draft/phishing-check (sensible Daten) sollte 200 liefern");
    const sensitiveCheck = (await sensitiveCheckRes.json()) as Record<string, unknown>;
    assert(sensitiveCheck.blocked === false, "eigene IBAN allein darf NICHT blockieren");
    assert(
      Array.isArray(sensitiveCheck.containsSensitiveData) && (sensitiveCheck.containsSensitiveData as string[]).includes("iban"),
      "containsSensitiveData sollte 'iban' enthalten",
    );
    assert(
      sensitiveCheck.recipientReputation === "unknown",
      "ohne recipientAddress im Request sollte recipientReputation weiterhin 'unknown' sein (siehe draftPhishingCheckMock.ts + lookups/recipientReputationMock.ts)",
    );

    // ----- Externe Lookup-Adapter (SYNC.md 08.09., Web-Antwort auf die vier
    // "wer macht den externen Lookup"-Fragen): src/lookups/*. Jeder der vier
    // Lookups läuft als Nachbearbeitungsschritt NACH analyzeMail() (Sync) bzw.
    // checkDraftForPhishingMock() (Composer-Endpoint) -- geprüft wird hier,
    // dass die entsprechenden SecurityResult-/phishing-check-Felder jetzt
    // tatsächlich befüllt werden statt fest auf dem alten Platzhalter zu
    // stehen (senderDomainAgeDays/domainReputationScore: vorher immer vom
    // Mock-KI-Adapter geraten, jetzt vom Domain-Lookup; ipReputationFlag:
    // vorher immer "unknown"; containsNewIban: vorher nur eine naive
    // Substring-Prüfung auf "iban"; recipientReputation: vorher immer
    // "unknown"). -----

    // 1) Domain-Reputation-Lookup direkt: verdächtige TLD/Schlüsselwort ->
    // junge Domain + niedrige Reputation, unauffällige Domain -> altes Domain
    // + hohe Reputation (deterministische Mock-Heuristik, siehe
    // domainReputationMock.ts).
    const suspiciousDomainRep = await domainReputationLookup.lookup("sicherheit-konto-check.tk");
    assert(
      suspiciousDomainRep.senderDomainAgeDays < 100 && suspiciousDomainRep.domainReputationScore < 0.3,
      "verdächtige Domain sollte laut Mock-Lookup ein junges Alter + niedrige Reputation liefern",
    );
    const trustedDomainRep = await domainReputationLookup.lookup("beispiel-versicherung.de");
    assert(
      trustedDomainRep.senderDomainAgeDays >= 400 && trustedDomainRep.domainReputationScore >= 0.5,
      "unauffällige Domain sollte laut Mock-Lookup ein hohes Alter + hohe Reputation liefern",
    );

    // 2) Domain-Reputation-Lookup + IP-Reputation-Lookup + IBAN-Historie
    // end-to-end über den Sync-Pfad (mail/sync.ts reichert MessageSecurity
    // NACH analyzeMail() an) -- geprüft über die echte HTTP-Response von
    // GET /messages/:id, nicht nur den direkten Lookup-Aufruf.
    const fixture1 = store.findMessageByHeader(account.id, "<fixture-1@beispiel-versicherung.de>");
    assert(fixture1 !== undefined, "Fixture 1 sollte importiert worden sein");
    const fixture1Detail = (await (await fetch(`${base}/v1/messages/${fixture1!.id}`)).json()) as Record<string, unknown>;
    const fixture1Security = fixture1Detail.security as Record<string, unknown>;
    assert(
      typeof fixture1Security.senderDomainAgeDays === "number" && (fixture1Security.senderDomainAgeDays as number) >= 400,
      "Fixture 1 (unauffällige Domain) sollte laut Domain-Reputation-Lookup ein hohes Domain-Alter liefern",
    );
    assert(
      fixture1Security.ipReputationFlag === "clean",
      "Fixture 1 (Beispiel-IP außerhalb der Mock-Botnetz-Liste im X-Originating-IP-Header) sollte ipReputationFlag='clean' liefern",
    );

    const fixture2 = store.findMessageByHeader(account.id, "<fixture-2@sicherheit-konto-check.tk>");
    assert(fixture2 !== undefined, "Fixture 2 sollte importiert worden sein");
    const fixture2Detail = (await (await fetch(`${base}/v1/messages/${fixture2!.id}`)).json()) as Record<string, unknown>;
    const fixture2Security = fixture2Detail.security as Record<string, unknown>;
    assert(
      typeof fixture2Security.domainReputationScore === "number" && (fixture2Security.domainReputationScore as number) < 0.3,
      "Fixture 2 (verdächtige TLD) sollte laut Domain-Reputation-Lookup eine niedrige Reputation liefern",
    );
    assert(
      fixture2Security.ipReputationFlag === "known_botnet",
      "Fixture 2 (Beispiel-Botnetz-IP im Received-Header) sollte laut IP-Reputations-Lookup 'known_botnet' liefern",
    );
    assert(
      fixture2Security.containsNewIban === true,
      "erste eingehende IBAN dieses Absenders sollte containsNewIban=true liefern (IBAN-Historie-Check)",
    );

    const fixture4 = store.findMessageByHeader(account.id, "<fixture-4@kollegin.example.com>");
    assert(fixture4 !== undefined, "Fixture 4 sollte importiert worden sein");
    const fixture4Detail = (await (await fetch(`${base}/v1/messages/${fixture4!.id}`)).json()) as Record<string, unknown>;
    const fixture4Security = fixture4Detail.security as Record<string, unknown>;
    assert(
      fixture4Security.ipReputationFlag === "unknown",
      "ohne ermittelbare IP in den Headern sollte ipReputationFlag weiterhin 'unknown' sein, nie geraten",
    );

    // 3) IBAN-Historie: eine wiederholte IBAN vom selben Absender gilt NICHT
    // mehr als neu (der Sync-Lauf oben hat die IBAN aus Fixture 2 bereits
    // einmal gesehen/gespeichert), eine ANDERE IBAN vom selben Absender
    // weiterhin schon.
    const ibanFromFixture2 = store.messages.find((m) => m.id === fixture2!.id)?.bodyText ?? "";
    const ibanCandidates = extractIbanCandidates(ibanFromFixture2);
    assert(ibanCandidates.length > 0, "Fixture 2 sollte mind. eine IBAN-Kandidatin enthalten");
    const repeatedIbanCheck = await ibanHistoryCheck.checkAndRecord(account.userId, fixture2!.fromAddress, ibanCandidates);
    assert(repeatedIbanCheck === false, "eine bereits gesehene IBAN vom selben Absender sollte NICHT mehr als neu gelten");
    const newIbanCheck = await ibanHistoryCheck.checkAndRecord(account.userId, fixture2!.fromAddress, ["DE99999999999999999999"]);
    assert(newIbanCheck === true, "eine bisher nicht gesehene IBAN vom selben Absender sollte weiterhin als neu gelten");

    // 4) Recipient-Reputation-Lookup über POST /messages/draft/phishing-check
    // (recipientAddress, kleine Contract-Ergänzung siehe api-spec.yaml):
    // bereits erfolgreich angeschriebener Kontakt -> "safe" (Demo-Seed in
    // ensureDemoUser()), Empfänger-Domain die schon als Phishing-Absender
    // aufgefallen ist -> "flagged".
    const safeRecipientRes = await fetch(`${base}/v1/messages/draft/phishing-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodyText: "Kurze Rückfrage zum Projekt.", links: [], recipientAddress: "kollegin@example.com" }),
    });
    const safeRecipient = (await safeRecipientRes.json()) as Record<string, unknown>;
    assert(safeRecipient.recipientReputation === "safe", "bereits erfolgreich angeschriebener Empfänger sollte recipientReputation='safe' liefern");

    const flaggedRecipientRes = await fetch(`${base}/v1/messages/draft/phishing-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodyText: "Text ohne eigene Warnsignale.", links: [], recipientAddress: "andere-adresse@sicherheit-konto-check.tk" }),
    });
    const flaggedRecipient = (await flaggedRecipientRes.json()) as Record<string, unknown>;
    assert(
      flaggedRecipient.recipientReputation === "flagged",
      "Empfänger-Domain, die schon als Phishing-Absender aufgefallen ist, sollte recipientReputation='flagged' liefern",
    );

    console.log("✔ Smoketest erfolgreich: Kernfluss (Sync -> Messages -> Summary -> Reply-Draft -> Quarantäne -> Contracts -> Capability -> Draft-Phishing-Check -> Externe Lookup-Adapter) end-to-end grün.");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
