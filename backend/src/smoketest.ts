// Einfacher End-to-End-Smoketest ohne Testframework: startet die App
// in-process, spielt den Kernfluss durch und prüft grob die Response-Form
// gegen contracts/api-spec.yaml. `npm test` führt das aus.

import { createApp } from "./app";
import { ensureDemoUser, initStore, store } from "./db/store";
import { syncAccount } from "./mail/sync";
import { aiAdapter } from "./ai";
import { domainReputationLookup, extractIbanCandidates, ibanHistoryCheck } from "./lookups";
import type { Server } from "node:http";
import type { SystemFolderKey } from "./types";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Smoketest fehlgeschlagen: ${msg}`);
}

async function main() {
  await initStore();
  const { account } = await ensureDemoUser();
  const { imported, autoDeleted } = await syncAccount(account, aiAdapter);
  assert(imported > 0, "Fixture-Sync sollte Nachrichten importieren");

  // Auto-Delete-Pfad (WEB_INBOX.md 08.09., siehe mail/sync.ts): Fixture 5
  // ist eindeutiger Glücksspiel-Spam und darf NICHT als Nachricht landen.
  assert(autoDeleted === 1, "genau 1 adult/gambling-Spam-Mail sollte automatisch gelöscht worden sein (Fixture 5)");
  assert(
    (await store.findMessageByHeader(account.id, "<fixture-5@casino-bonus-express.example>")) === undefined,
    "auto-gelöschte Mail darf keine messages-Zeile bekommen",
  );
  assert(
    (await store.listSecurityAuditLog({ userId: account.userId, action: "auto_deleted_adult_gambling_spam" })).some(
      (e) => e.messageId === null,
    ),
    "Auto-Delete sollte einen security_audit_log-Eintrag hinterlassen (messageId=null, da nie angelegt)",
  );

  // Erneuter Sync darf dieselbe Mail nicht nochmal löschen/loggen (Dedupe
  // über store.wasAutoDeleted(), siehe store.ts-Kommentar).
  const second = await syncAccount(account, aiAdapter);
  assert(second.autoDeleted === 0, "wiederholter Sync sollte dieselbe auto-gelöschte Mail nicht erneut zählen");
  assert(
    (await store.listSecurityAuditLog({ action: "auto_deleted_adult_gambling_spam" })).length === 1,
    "wiederholter Sync sollte keinen zweiten Audit-Log-Eintrag für dieselbe Mail erzeugen",
  );

  // Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09. "Automatische
  // Abmeldung bei Spam"): List-Unsubscribe-Header wird bei spam-Klassifikation
  // automatisch ausgewertet und als 'confirmed' in unsubscribe_actions
  // protokolliert -- rein syntaktische Auswertung, kein echter Netzwerk-Call
  // (siehe mail/listUnsubscribe.ts). Direkt nach dem Sync geprüft, bevor die
  // spätere Papierkorb-Sektion Fixture 3 löscht.
  const fixture3ForUnsub = await store.findMessageByHeader(account.id, "<fixture-3@newsletter-deals.example>");
  assert(fixture3ForUnsub !== undefined, "Fixture 3 sollte importiert worden sein (Abmelde-Test)");
  const fixture3UnsubActions = await store.listUnsubscribeActions({ messageId: fixture3ForUnsub!.id });
  assert(
    fixture3UnsubActions.some((a) => a.status === "confirmed" && a.method === "list_unsubscribe_header"),
    "Fixture 3 (Marketing-Spam mit List-Unsubscribe-Header) sollte automatisch abgemeldet worden sein",
  );

  // Fixture 5 (adult/gambling, auto-gelöscht): Abmeldung muss VOR dem
  // Verwerfen laufen, messageId=null, da nie eine messages-Zeile angelegt wird.
  const fixture5UnsubActions = await store.listUnsubscribeActions({ messageId: null });
  assert(
    fixture5UnsubActions.some(
      (a) =>
        a.status === "confirmed" &&
        a.method === "list_unsubscribe_header" &&
        (a.listUnsubscribeHeaderValue ?? "").includes("casino-bonus-express"),
    ),
    "Fixture 5 (adult/gambling-Spam) sollte VOR dem Auto-Delete automatisch abgemeldet worden sein (messageId=null)",
  );

  // Fixture 2 (Phishing mit gefälschtem List-Unsubscribe-Header): automatische
  // Abmeldung gilt laut Auftrag NUR für classification='spam', nicht 'phishing'.
  const fixture2ForUnsub = await store.findMessageByHeader(account.id, "<fixture-2@sicherheit-konto-check.tk>");
  assert(fixture2ForUnsub !== undefined, "Fixture 2 sollte importiert worden sein (Abmelde-Test)");
  const fixture2UnsubActionsAuto = await store.listUnsubscribeActions({ messageId: fixture2ForUnsub!.id });
  assert(
    fixture2UnsubActionsAuto.length === 0,
    "Fixture 2 (Phishing) darf trotz vorhandenem Header NICHT automatisch abgemeldet werden",
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

    // Ordner: 7 System-Ordner müssen für den Demo-User existieren
    // (Contract-Änderung "benutzerdefinierte Ordner", SYNC.md Commit 734781e;
    // "papierkorb" kam per Nachtrag dazu, WEB_INBOX.md 08.09. "Fehlende
    // Basis-Funktion entdeckt", Commit 156f0fd; Ordner-Umbau 09.09.
    // "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags": wichtig/rechnungen
    // entfallen, eingang/entwuerfe/gesendet neu).
    const foldersRes = await fetch(`${base}/v1/folders`);
    assert(foldersRes.status === 200, "GET /v1/folders sollte 200 liefern");
    const folders = (await foldersRes.json()) as Array<Record<string, unknown>>;
    assert(Array.isArray(folders) && folders.length === 7, "genau 7 System-Ordner erwartet");
    const eingangFolder = folders.find((f) => f.systemKey === "eingang");
    const entwuerfeFolder = folders.find((f) => f.systemKey === "entwuerfe");
    const gesendetFolder = folders.find((f) => f.systemKey === "gesendet") as Record<string, unknown>;
    const spamFolder = folders.find((f) => f.systemKey === "spam");
    const sonstigesFolder = folders.find((f) => f.systemKey === "sonstiges");
    const papierkorbFolder = folders.find((f) => f.systemKey === "papierkorb") as Record<string, unknown>;
    assert(
      !!eingangFolder && !!entwuerfeFolder && !!gesendetFolder && !!spamFolder && !!sonstigesFolder && !!papierkorbFolder,
      "System-Ordner 'eingang', 'entwuerfe', 'gesendet', 'spam', 'sonstiges' und 'papierkorb' erwartet",
    );
    assert(
      !folders.some((f) => f.systemKey === "wichtig" || f.systemKey === "rechnungen"),
      "'wichtig'/'rechnungen' sollten nach dem Ordner-Umbau nicht mehr als System-Ordner existieren",
    );

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

    const renamePapierkorbRes = await fetch(`${base}/v1/folders/${papierkorbFolder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nicht erlaubt" }),
    });
    assert(renamePapierkorbRes.status === 400, "Umbenennen von 'papierkorb' sollte 400 liefern (design-tokens.json: renamable=false)");

    const deletePapierkorbFolderRes = await fetch(`${base}/v1/folders/${papierkorbFolder.id}`, { method: "DELETE" });
    assert(deletePapierkorbFolderRes.status === 400, "Löschen des System-Ordners 'papierkorb' sollte 400 liefern");

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

    // WEB_INBOX.md 08.09. (Track F) + contracts/api-spec.yaml `QuarantineInfo`:
    // reason/autoDeleteAt waren in der quarantine-Tabelle vorhanden, aber
    // ohne Lese-Weg über die API -- jetzt über MessageDetail.quarantine.
    const detailAfterQuarantineRes = await fetch(`${base}/v1/messages/${first.id}`);
    const detailAfterQuarantine = (await detailAfterQuarantineRes.json()) as Record<string, unknown>;
    const quarantineInfo = detailAfterQuarantine.quarantine as Record<string, unknown> | null;
    assert(quarantineInfo !== null, "MessageDetail.quarantine sollte nach POST .../quarantine gesetzt sein");
    assert(typeof quarantineInfo!.reason === "string" && quarantineInfo!.reason.length > 0, "quarantine.reason erwartet");
    assert(typeof quarantineInfo!.autoDeleteAt === "string", "quarantine.autoDeleteAt erwartet");
    assert(quarantineInfo!.userReviewed === false, "quarantine.userReviewed sollte direkt nach dem Anlegen false sein");

    // ----- Papierkorb / Löschen (WEB_INBOX.md 08.09. "Fehlende
    // Basis-Funktion entdeckt", Commit 156f0fd) -----
    // Eigene Fixture (3, Newsletter/generic-Spam) statt `first`/fixture1/2/4:
    // die spätere Lookup-Adapter-Sektion prüft fixture1/2/4 noch per
    // findMessageByHeader() nach Sync-Werten -- die dürfen hier nicht schon
    // aus dem Store verschwunden sein.
    const fixture3 = await store.findMessageByHeader(account.id, "<fixture-3@newsletter-deals.example>");
    assert(fixture3 !== undefined, "Fixture 3 sollte importiert worden sein");
    const trashTarget = fixture3!;

    // Fall 1: permanent delete NICHT aus einem anderen Ordner als dem
    // Papierkorb erlaubt (Design-Entscheidung, siehe messages.ts-Kommentar
    // + README) -- Fixture 3 liegt laut Sync-Pipeline im normalen
    // Spam-Ordner, nicht im Papierkorb.
    const permanentFromSpamRes = await fetch(`${base}/v1/messages/${trashTarget.id}/permanent`, { method: "DELETE" });
    assert(
      permanentFromSpamRes.status === 400,
      "DELETE .../permanent aus dem Spam-Ordner (nicht Papierkorb) sollte 400 liefern",
    );
    assert((await store.getMessage(trashTarget.id)) !== undefined, "Nachricht darf nach abgelehntem permanent-delete weiterhin existieren");

    // Fall 2: soft delete -- Nachricht landet im Papierkorb-Ordner.
    const softDeleteRes = await fetch(`${base}/v1/messages/${trashTarget.id}`, { method: "DELETE" });
    assert(softDeleteRes.status === 200, "DELETE /v1/messages/:id (soft delete) sollte 200 liefern");
    const softDeleted = (await softDeleteRes.json()) as Record<string, unknown>;
    assert(softDeleted.folderId === papierkorbFolder.id, "Nachricht sollte nach DELETE im Papierkorb-Ordner sein");
    const afterSoftDeleteDetail = (await (await fetch(`${base}/v1/messages/${trashTarget.id}`)).json()) as Record<string, unknown>;
    assert(afterSoftDeleteDetail.folderId === papierkorbFolder.id, "GET nach soft delete sollte folderId=Papierkorb zeigen");

    // Fall 3: permanent delete AUS dem Papierkorb heraus -- Nachricht ist danach weg.
    const permanentDeleteRes = await fetch(`${base}/v1/messages/${trashTarget.id}/permanent`, { method: "DELETE" });
    assert(permanentDeleteRes.status === 200, "DELETE .../permanent aus dem Papierkorb sollte 200 liefern");
    assert((await store.getMessage(trashTarget.id)) === undefined, "Nachricht sollte nach permanent delete nicht mehr im Store existieren");
    const afterPermanentDeleteRes = await fetch(`${base}/v1/messages/${trashTarget.id}`);
    assert(afterPermanentDeleteRes.status === 404, "GET nach permanent delete sollte 404 liefern");

    // Fall 4: DELETE auf eine nicht existierende Nachricht -> 404 (Edge Case).
    const deleteMissingRes = await fetch(`${base}/v1/messages/00000000-0000-0000-0000-000000000000`, { method: "DELETE" });
    assert(deleteMissingRes.status === 404, "DELETE /v1/messages/:id für unbekannte id sollte 404 liefern");

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

    // POST /messages/draft/phishing-check (WEB_INBOX.md 08.09., seit 09.09.
    // echte Erkennungslogik von Track B, @driftmail/security-classification)
    // — Block-Fall: Link-Mismatch (Anzeigetext behauptet paypal.com, Ziel
    // zeigt auf andere Domain).
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
      "ohne recipientAddress im Request sollte recipientReputation weiterhin 'unknown' sein (siehe lookups/recipientReputationMock.ts)",
    );

    // POST /messages/send (WEB_INBOX.md 09.09. "Fehlender Senden-Endpunkt")
    // -- Fall 1: neue Mail (kein inReplyToMessageId), muss durchgehen und
    // einen outgoing_send_log-Eintrag hinterlassen (Grundlage für
    // recipientReputation, siehe lookups/recipientReputationMock.ts).
    const sendRes = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        to: ["kollegin@example.com"],
        subject: "Testmail",
        bodyText: "Hallo, das ist eine Testmail.",
      }),
    });
    assert(sendRes.status === 200, "POST /v1/messages/send sollte 200 liefern");
    const sent = (await sendRes.json()) as Record<string, unknown>;
    assert(typeof sent.sentMessageId === "string" && (sent.sentMessageId as string).length > 0, "sentMessageId erwartet");
    assert(
      await store.hasSentTo(account.userId, "kollegin@example.com"),
      "outgoing_send_log sollte den Empfänger nach dem Versand kennen",
    );

    // Fall 2: weder accountId noch inReplyToMessageId angegeben -> 400
    // (Edge Case, siehe Kommentar in routes/messages.ts).
    const sendMissingAccountRes = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ["jemand@example.com"], bodyText: "Text ohne Konto-Bezug" }),
    });
    assert(sendMissingAccountRes.status === 400, "POST /v1/messages/send ohne accountId/inReplyToMessageId sollte 400 liefern");

    // Fall 3: harter Phishing-Block (Dringlichkeit + Zugangsdaten-Anfrage,
    // dieselbe Testphrase wie security-classification/tests/
    // draftPhishingCheck.test.ts) verhindert den Versand serverseitig --
    // end-to-end derselbe Mechanismus wie POST /messages/draft/phishing-check
    // oben, jetzt über den Send-Endpunkt selbst ausgelöst.
    const sendBlockedRes = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        to: ["opfer@example.com"],
        bodyText: "DRINGEND: Ihr Konto wird gesperrt! Bitte umgehend Passwort bestätigen, sonst wird Ihr Konto endgültig gesperrt!!!",
      }),
    });
    assert(sendBlockedRes.status === 422, "phishing-blockierter Versand sollte 422 liefern");
    const sendBlocked = (await sendBlockedRes.json()) as Record<string, unknown>;
    assert(sendBlocked.blocked === true, "geblockter Versand sollte blocked=true liefern");
    assert(
      !(await store.hasSentTo(account.userId, "opfer@example.com")),
      "ein blockierter Versand darf keinen outgoing_send_log-Eintrag hinterlassen",
    );

    // Fall 4: Antwort (inReplyToMessageId gesetzt, kein accountId nötig) --
    // Konto wird aus der Ursprungsnachricht abgeleitet (siehe
    // routes/messages.ts-Kommentar), In-Reply-To/References-Header werden
    // aus deren messageIdHeader gesetzt (nicht direkt über die API prüfbar,
    // aber der Erfolgsfall selbst beweist, dass die Ableitung funktioniert).
    const replyTarget = (await store.findMessageByHeader(account.id, "<fixture-4@kollegin.example.com>"))!;
    assert(!!replyTarget, "Fixture 4 sollte für den Antwort-Testfall noch existieren");
    const sendReplyRes = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inReplyToMessageId: replyTarget.id, to: ["kollegin@example.com"], bodyText: "Danke für das Update!" }),
    });
    assert(sendReplyRes.status === 200, "POST /v1/messages/send als Antwort (nur inReplyToMessageId) sollte 200 liefern");

    // Fall 5: unbekannte inReplyToMessageId -> 404 (Edge Case).
    const sendReplyMissingRes = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inReplyToMessageId: "00000000-0000-0000-0000-000000000000",
        to: ["kollegin@example.com"],
        bodyText: "Text",
      }),
    });
    assert(sendReplyMissingRes.status === 404, "POST /v1/messages/send mit unbekannter inReplyToMessageId sollte 404 liefern");

    // POST /attachments + Anhang-Gate bei POST /messages/send (WEB_INBOX.md
    // 09.09. "Erweiterung des Send-Endpunkt-Eintrags von eben"). Fall 1:
    // unauffällige Datei -> 200, scanStatus 'clean'.
    async function uploadAttachment(filename: string, content: string): Promise<{ status: number; attachmentId?: string; scanStatus?: string }> {
      const form = new FormData();
      form.append("file", new Blob([content], { type: "text/plain" }), filename);
      const res = await fetch(`${base}/v1/attachments`, { method: "POST", body: form });
      const json = res.status === 200 ? ((await res.json()) as Record<string, unknown>) : undefined;
      return { status: res.status, attachmentId: json?.attachmentId as string | undefined, scanStatus: json?.scanStatus as string | undefined };
    }

    const cleanUpload = await uploadAttachment("rechnung.pdf", "Beispielinhalt, keine echte PDF-Struktur nötig für den Mock-Scan.");
    assert(cleanUpload.status === 200, "POST /v1/attachments (unauffällige Datei) sollte 200 liefern");
    assert(cleanUpload.scanStatus === "clean", "unauffällige Datei sollte scanStatus 'clean' liefern");

    // Fall 2: gefährliche Dateiendung -> 'blocked_type' (Dateityp-Prüfung,
    // siehe attachmentScanMock.ts).
    const blockedTypeUpload = await uploadAttachment("installer.exe", "fake-binary-content");
    assert(blockedTypeUpload.status === 200, "POST /v1/attachments (gefährliche Endung) sollte trotzdem 200 liefern (Scan-Ergebnis im Body, kein HTTP-Fehler)");
    assert(blockedTypeUpload.scanStatus === "blocked_type", "installer.exe sollte scanStatus 'blocked_type' liefern");

    // Fall 3: deterministischer 'malicious'-Test-Trigger (Dateiname enthält
    // 'virus', siehe attachmentScanMock.ts -- kein echter Signatur-Scan).
    const maliciousUpload = await uploadAttachment("rechnung-virus.pdf", "content");
    assert(maliciousUpload.scanStatus === "malicious", "Dateiname mit 'virus' sollte scanStatus 'malicious' liefern");

    // Fall 4: kein Datei-Feld -> 400 (Edge Case).
    const noFileRes = await fetch(`${base}/v1/attachments`, { method: "POST", body: new FormData() });
    assert(noFileRes.status === 400, "POST /v1/attachments ohne Datei sollte 400 liefern");

    // Fall 5: Versand MIT einem 'clean' Anhang -> 200 (Anhang erlaubt).
    const sendWithCleanAttachmentRes = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        to: ["kollegin@example.com"],
        bodyText: "Anbei die Rechnung.",
        attachmentIds: [cleanUpload.attachmentId],
      }),
    });
    assert(sendWithCleanAttachmentRes.status === 200, "POST /v1/messages/send mit 'clean' Anhang sollte 200 liefern");

    // Fall 6: Versand MIT einem NICHT 'clean' Anhang -> 422, blocked=true,
    // kein Versand (gleiche Fehlerform wie der Phishing-Block).
    const sendWithBlockedAttachmentRes = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        to: ["kollegin@example.com"],
        bodyText: "Anbei die Installationsdatei.",
        attachmentIds: [blockedTypeUpload.attachmentId],
      }),
    });
    assert(sendWithBlockedAttachmentRes.status === 422, "POST /v1/messages/send mit nicht-'clean' Anhang sollte 422 liefern");
    const sendWithBlockedAttachmentBody = (await sendWithBlockedAttachmentRes.json()) as Record<string, unknown>;
    assert(sendWithBlockedAttachmentBody.blocked === true, "geblockter Anhang-Versand sollte blocked=true liefern");

    // Fall 7: unbekannte attachmentId -> 400 (Edge Case).
    const sendWithUnknownAttachmentRes = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        to: ["kollegin@example.com"],
        bodyText: "Text",
        attachmentIds: ["00000000-0000-0000-0000-000000000000"],
      }),
    });
    assert(sendWithUnknownAttachmentRes.status === 400, "POST /v1/messages/send mit unbekannter attachmentId sollte 400 liefern");

    // "Gesendet"-Ordner (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
    // Ordner-Umbau-Eintrags"): jeder erfolgreiche Versand oben (sendRes,
    // sendReplyRes, sendWithCleanAttachmentRes) sollte eine lokale
    // messages-Zeile dort hinterlassen haben.
    const gesendetMessagesRes = await fetch(`${base}/v1/messages?folderId=${gesendetFolder.id}`);
    const gesendetMessages = (await gesendetMessagesRes.json()) as Array<Record<string, unknown>>;
    assert(gesendetMessages.length >= 3, "mindestens 3 lokale Nachrichten im 'gesendet'-Ordner erwartet (3 erfolgreiche Sends oben)");

    // ----- Entwürfe (POST/GET /drafts, PATCH/DELETE /drafts/{id}, WEB_INBOX.md
    // 09.09. "KORREKTUR/ERWEITERUNG des Ordner-Umbau-Eintrags") -----
    const createDraftRes = await fetch(`${base}/v1/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: ["neuer-kontakt@example.com"], subject: "Testentwurf", bodyText: "Erster Satz." }),
    });
    assert(createDraftRes.status === 200, "POST /v1/drafts sollte 200 liefern");
    const draftRecord = (await createDraftRes.json()) as Record<string, unknown>;
    assert(typeof draftRecord.id === "string", "Draft sollte eine id haben");
    assert(draftRecord.subject === "Testentwurf", "Draft sollte den gesendeten subject übernehmen");

    const patchDraftRes = await fetch(`${base}/v1/drafts/${draftRecord.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodyText: "Erster Satz. Zweiter Satz." }),
    });
    assert(patchDraftRes.status === 200, "PATCH /v1/drafts/:id sollte 200 liefern");
    const patchedDraft = (await patchDraftRes.json()) as Record<string, unknown>;
    assert(patchedDraft.bodyText === "Erster Satz. Zweiter Satz.", "PATCH sollte bodyText aktualisieren");
    assert(patchedDraft.subject === "Testentwurf", "PATCH ohne subject-Feld sollte subject unverändert lassen");

    const listDraftsRes = await fetch(`${base}/v1/drafts`);
    const draftsList = (await listDraftsRes.json()) as Array<Record<string, unknown>>;
    assert(draftsList.some((d) => d.id === draftRecord.id), "GET /v1/drafts sollte den angelegten Entwurf enthalten");

    // Versand mit draftId -- der Entwurf muss danach automatisch verworfen sein.
    const sendFromDraftRes = await fetch(`${base}/v1/messages/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: account.id,
        draftId: draftRecord.id,
        to: ["neuer-kontakt@example.com"],
        subject: "Testentwurf",
        bodyText: "Erster Satz. Zweiter Satz. Fertig.",
      }),
    });
    assert(sendFromDraftRes.status === 200, "POST /v1/messages/send mit draftId sollte 200 liefern");
    const patchDeletedDraftRes = await fetch(`${base}/v1/drafts/${draftRecord.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert(patchDeletedDraftRes.status === 404, "Entwurf sollte nach erfolgreichem Versand (draftId) automatisch gelöscht sein");

    // Edge Cases: PATCH/DELETE auf unbekannte draftId -> 404.
    const patchUnknownDraftRes = await fetch(`${base}/v1/drafts/00000000-0000-0000-0000-000000000000`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bodyText: "x" }),
    });
    assert(patchUnknownDraftRes.status === 404, "PATCH /v1/drafts/:id für unbekannte id sollte 404 liefern");
    const deleteUnknownDraftRes = await fetch(`${base}/v1/drafts/00000000-0000-0000-0000-000000000000`, { method: "DELETE" });
    assert(deleteUnknownDraftRes.status === 404, "DELETE /v1/drafts/:id für unbekannte id sollte 404 liefern");

    // ----- Ordner-Umbau-Migration (migrateLegacySystemFolders(), WEB_INBOX.md
    // 09.09.): simuliert einen Bestandsuser von VOR dem Umbau (eigene
    // "wichtig"-Systemordner-Zeile + eine Nachricht darin) und prüft, dass
    // der nächste ensureDemoUser()-Aufruf (wie er bei jedem Request passiert)
    // die Nachricht nach "eingang" verschiebt und den Ordner entfernt. Cast
    // auf SystemFolderKey nötig, weil "wichtig" laut aktuellem Contract kein
    // gültiger Wert mehr ist -- genau das simuliert hier echte Altdaten.
    const legacyWichtigFolder = await store.createFolder({
      userId: account.userId,
      name: "Wichtig",
      icon: "star",
      isSystem: true,
      systemKey: "wichtig" as unknown as SystemFolderKey,
      sortOrder: 99,
    });
    const legacyMessage = await store.insertMessage({
      mailAccountId: account.id,
      messageIdHeader: "<legacy-migration-test@example.com>",
      providerMessageId: null,
      fromAddress: "alt@example.com",
      fromDisplayName: null,
      replyToAddress: null,
      subject: "Alte Mail im wichtig-Ordner",
      bodyText: "Text",
      receivedAt: new Date().toISOString(),
      folderId: legacyWichtigFolder.id,
      rawHeaders: null,
    });
    await ensureDemoUser(); // triggert migrateLegacySystemFolders() (Store hat bereits Ordner -> else-Zweig)
    const migratedMessage = await store.getMessage(legacyMessage.id);
    assert(migratedMessage !== undefined, "Nachricht aus dem alten 'wichtig'-Ordner darf nicht verloren gehen");
    assert(migratedMessage!.folderId === eingangFolder!.id, "Nachricht aus 'wichtig' sollte nach der Migration in 'eingang' liegen");
    const foldersAfterMigrationRes = await fetch(`${base}/v1/folders`);
    const foldersAfterMigration = (await foldersAfterMigrationRes.json()) as Array<Record<string, unknown>>;
    assert(!foldersAfterMigration.some((f) => f.systemKey === "wichtig"), "'wichtig'-Ordner sollte nach der Migration entfernt sein");

    // ----- Externe Lookup-Adapter (SYNC.md 08.09., Web-Antwort auf die vier
    // "wer macht den externen Lookup"-Fragen): src/lookups/*. Jeder der vier
    // Lookups läuft als Nachbearbeitungsschritt NACH analyzeMail() (Sync) bzw.
    // checkDraftForPhishing() (Composer-Endpoint) -- geprüft wird hier,
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
    const fixture1 = await store.findMessageByHeader(account.id, "<fixture-1@beispiel-versicherung.de>");
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

    const fixture2 = await store.findMessageByHeader(account.id, "<fixture-2@sicherheit-konto-check.tk>");
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

    const fixture4 = await store.findMessageByHeader(account.id, "<fixture-4@kollegin.example.com>");
    assert(fixture4 !== undefined, "Fixture 4 sollte importiert worden sein");
    const fixture4Detail = (await (await fetch(`${base}/v1/messages/${fixture4!.id}`)).json()) as Record<string, unknown>;
    const fixture4Security = fixture4Detail.security as Record<string, unknown>;
    assert(fixture4Detail.quarantine === null, "MessageDetail.quarantine sollte null sein, solange die Nachricht nicht in Quarantäne ist");
    assert(
      fixture4Security.ipReputationFlag === "unknown",
      "ohne ermittelbare IP in den Headern sollte ipReputationFlag weiterhin 'unknown' sein, nie geraten",
    );

    // Track A + Track B Integration (09.09., WEB_INBOX.md "Track A + Track B
    // Integration"): Fixture 6 beweist, dass analyzeMail() jetzt echte
    // Track-B-Logik läuft, nicht mehr den alten Mock -- Homoglyph-Erkennung
    // gab es im Mock-Adapter gar nicht (dort war homoglyphDetected fest
    // `false`, egal was im Text stand).
    const fixture6 = await store.findMessageByHeader(account.id, "<fixture-6@apple-id-verify.example>");
    assert(fixture6 !== undefined, "Fixture 6 sollte importiert worden sein");
    const fixture6Detail = (await (await fetch(`${base}/v1/messages/${fixture6!.id}`)).json()) as Record<string, unknown>;
    const fixture6Security = fixture6Detail.security as Record<string, unknown>;
    assert(
      fixture6Security.homoglyphDetected === true,
      "Fixture 6 (kyrillisches 'а' in 'аpple.com') sollte von der echten Track-B-Logik als Homoglyph-Domain erkannt werden -- der alte Mock konnte das nicht",
    );
    assert(
      fixture6Security.classification === "phishing",
      "Fixture 6 sollte durch die Homoglyph-Domain als phishing klassifiziert werden",
    );

    // 3) IBAN-Historie: eine wiederholte IBAN vom selben Absender gilt NICHT
    // mehr als neu (der Sync-Lauf oben hat die IBAN aus Fixture 2 bereits
    // einmal gesehen/gespeichert), eine ANDERE IBAN vom selben Absender
    // weiterhin schon.
    const ibanFromFixture2 = fixture2!.bodyText ?? "";
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

    // POST /messages/:messageId/unsubscribe (WEB_INBOX.md 09.09. "Automatische
    // Abmeldung bei Spam", manueller Pfad): prüft nur, ob der Header
    // syntaktisch vorhanden ist -- unabhängig von der Klassifikation. Fixture 2
    // (Phishing mit gefälschtem Header) liefert deshalb hier bewusst 200, im
    // Gegensatz zum automatischen Pfad oben, der Phishing ausschließt.
    // MessageDetail.canUnsubscribe (kleine Contract-Ergänzung, siehe README
    // "Automatische Abmeldung bei Spam"): steuert die Sichtbarkeit des
    // Abmelden-Buttons in der Client-UI, unabhängig von der Klassifikation.
    assert(fixture2Detail.canUnsubscribe === true, "Fixture 2 (mit List-Unsubscribe-Header) sollte canUnsubscribe=true liefern");
    assert(fixture4Detail.canUnsubscribe === false, "Fixture 4 (ohne List-Unsubscribe-Header) sollte canUnsubscribe=false liefern");

    const manualUnsubRes = await fetch(`${base}/v1/messages/${fixture2!.id}/unsubscribe`, { method: "POST" });
    assert(manualUnsubRes.status === 200, "POST .../unsubscribe auf eine Nachricht mit List-Unsubscribe-Header sollte 200 liefern");
    const manualUnsub = (await manualUnsubRes.json()) as Record<string, unknown>;
    assert(manualUnsub.status === "pending_confirmation", "manuelle Abmeldung sollte status 'pending_confirmation' liefern");

    // Edge Case: Nachricht ohne List-Unsubscribe-Header -> 400.
    const manualUnsubNoHeaderRes = await fetch(`${base}/v1/messages/${fixture1!.id}/unsubscribe`, { method: "POST" });
    assert(manualUnsubNoHeaderRes.status === 400, "POST .../unsubscribe ohne List-Unsubscribe-Header sollte 400 liefern");

    // Edge Case: unbekannte messageId -> 404.
    const manualUnsubMissingRes = await fetch(`${base}/v1/messages/00000000-0000-0000-0000-000000000000/unsubscribe`, { method: "POST" });
    assert(manualUnsubMissingRes.status === 404, "POST .../unsubscribe für unbekannte messageId sollte 404 liefern");

    console.log("✔ Smoketest erfolgreich: Kernfluss (Sync -> Messages -> Summary -> Reply-Draft -> Quarantäne -> Papierkorb/Löschen -> Contracts -> Capability -> Draft-Phishing-Check -> Versand -> Anhang-Upload/Scan -> Entwürfe -> Ordner-Umbau-Migration -> Externe Lookup-Adapter -> Automatische/Manuelle Abmeldung bei Spam) end-to-end grün.");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
