// Einfacher End-to-End-Smoketest ohne Testframework: startet die App
// in-process, spielt den Kernfluss durch und prüft grob die Response-Form
// gegen contracts/api-spec.yaml. `npm test` führt das aus.

import { createApp } from "./app";
import { ensureDemoUser, initStore, store } from "./db/store";
import { PostgresStore } from "./db/postgresStore";
import { syncAccount } from "./mail/sync";
import { runSyncForAllAccounts } from "./mail/scheduler";
import { aiAdapter } from "./ai";
import { domainReputationLookup, extractIbanCandidates, ibanHistoryCheck } from "./lookups";
import { ocrAdapter } from "./attachments";
import { decryptCredentials, encryptCredentials } from "./auth/credentialsEncryption";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Server } from "node:http";
import type { SystemFolderKey } from "./types";

const FIXTURES_DIR = join(__dirname, "..", "test-fixtures");

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Smoketest fehlgeschlagen: ${msg}`);
}

async function main() {
  await initStore();
  const { account } = await ensureDemoUser();
  const { imported, autoDeleted } = await syncAccount(account, aiAdapter);
  assert(imported > 0, "Fixture-Sync sollte Nachrichten importieren");

  // Auto-Delete-Pfad (WEB_INBOX.md 08.09., siehe mail/sync.ts): Fixture 5
  // ist eindeutiger Glücksspiel-Spam, Fixture 7 (WEB_INBOX.md 15.09.)
  // klassischer Vorschussbetrug -- beide dürfen NICHT als Nachricht landen.
  assert(autoDeleted === 2, "genau 2 auto-lösch-pflichtige Spam-Mails erwartet (Fixture 5 + Fixture 7)");
  assert(
    (await store.findMessageByHeader(account.id, "<fixture-5@casino-bonus-express.example>")) === undefined,
    "auto-gelöschte Mail darf keine messages-Zeile bekommen",
  );
  assert(
    (await store.findMessageByHeader(account.id, "<fixture-7@erbschaft-mitteilung.example>")) === undefined,
    "auto-gelöschte Vorschussbetrug-Mail (Fixture 7) darf keine messages-Zeile bekommen",
  );
  assert(
    (await store.listSecurityAuditLog({ userId: account.userId, action: "auto_deleted_adult_gambling_spam" })).some(
      (e) => e.messageId === null,
    ),
    "Auto-Delete sollte einen security_audit_log-Eintrag hinterlassen (messageId=null, da nie angelegt)",
  );
  assert(
    (await store.listSecurityAuditLog({ userId: account.userId, action: "auto_deleted_advance_fee_scam" })).some(
      (e) => e.messageId === null,
    ),
    "Auto-Delete von Fixture 7 sollte einen eigenen security_audit_log-Eintrag hinterlassen (action 'auto_deleted_advance_fee_scam')",
  );

  // Erneuter Sync darf dieselbe Mail nicht nochmal löschen/loggen (Dedupe
  // über store.wasAutoDeleted(), siehe store.ts-Kommentar).
  const second = await syncAccount(account, aiAdapter);
  assert(second.autoDeleted === 0, "wiederholter Sync sollte dieselbe auto-gelöschte Mail nicht erneut zählen");
  assert(
    (await store.listSecurityAuditLog({ action: "auto_deleted_adult_gambling_spam" })).length === 1,
    "wiederholter Sync sollte keinen zweiten Audit-Log-Eintrag für dieselbe Mail erzeugen",
  );
  assert(
    (await store.listSecurityAuditLog({ action: "auto_deleted_advance_fee_scam" })).length === 1,
    "wiederholter Sync sollte keinen zweiten Audit-Log-Eintrag für Fixture 7 erzeugen",
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
    // [2026-09-10] echte Auth (TERMINAL_INBOX.md 09.09.): jede Route außer
    // POST /accounts/POST /auth/session verlangt jetzt einen gültigen
    // Bearer-Token (requireAuth, siehe middleware/auth.ts) statt wie vorher
    // implizit den Demo-User anzunehmen. Erst die 401-Fälle ohne Token
    // prüfen, DANACH einloggen (POST /accounts) und für den Rest des
    // Smoketests ein lokales `fetch` verwenden, das den Header automatisch
    // mitschickt -- vermeidet, an über 30 Call-Sites einzeln einen Header
    // nachzutragen.
    const noTokenRes = await globalThis.fetch(`${base}/v1/accounts`);
    assert(noTokenRes.status === 401, "GET /v1/accounts ohne Authorization-Header sollte 401 liefern");
    const noTokenBadRes = await globalThis.fetch(`${base}/v1/accounts`, { headers: { Authorization: "Bearer offensichtlich-ungueltig" } });
    assert(noTokenBadRes.status === 401, "GET /v1/accounts mit ungültigem Token sollte 401 liefern");

    // POST /accounts (Login/Registrierung, routes/auth.ts) -- Contract-Lücke
    // war seit Track 0 unimplementiert (/auth/session verwies bereits
    // darauf, siehe api-spec.yaml). Gleiche E-Mail wie ensureDemoUser() oben
    // -> find-or-create liefert denselben User/dasselbe Konto zurück.
    const connectRes = await globalThis.fetch(`${base}/v1/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "gmail", emailAddress: account.emailAddress }),
    });
    assert(connectRes.status === 200, "POST /v1/accounts (Login) sollte 200 liefern");
    const connected = (await connectRes.json()) as { account: Record<string, unknown>; token: string };
    assert(typeof connected.token === "string" && connected.token.length > 0, "POST /v1/accounts sollte einen token liefern");
    assert(connected.account.id === account.id, "POST /v1/accounts sollte das bestehende Demo-Konto wiederverwenden, kein zweites anlegen");
    let authToken = connected.token;

    // Zweiter Login mit derselben E-Mail -- find-or-create, kein zweiter User/Konto.
    const secondConnectRes = await globalThis.fetch(`${base}/v1/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "gmail", emailAddress: account.emailAddress }),
    });
    const secondConnected = (await secondConnectRes.json()) as { account: Record<string, unknown>; token: string };
    assert(secondConnected.account.id === connected.account.id, "wiederholter Login mit derselben E-Mail sollte dasselbe Konto liefern");
    assert(secondConnected.token !== connected.token, "wiederholter Login sollte eine neue, eigene Session ausstellen");

    // POST /accounts ohne emailAddress -> 400 (Edge Case).
    const connectMissingEmailRes = await globalThis.fetch(`${base}/v1/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "gmail" }),
    });
    assert(connectMissingEmailRes.status === 400, "POST /v1/accounts ohne emailAddress sollte 400 liefern");

    // POST /auth/session -- Token-Erneuerung. Rotiert den Token, alter Token
    // danach ungültig (echte Rotation, keine bloße Verlängerung).
    const refreshRes = await globalThis.fetch(`${base}/v1/auth/session`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(refreshRes.status === 200, "POST /v1/auth/session mit gültigem Token sollte 200 liefern");
    const refreshed = (await refreshRes.json()) as { token: string };
    assert(typeof refreshed.token === "string" && refreshed.token !== authToken, "POST /v1/auth/session sollte einen neuen, anderen token liefern");
    const oldTokenRes = await globalThis.fetch(`${base}/v1/accounts`, { headers: { Authorization: `Bearer ${authToken}` } });
    assert(oldTokenRes.status === 401, "der alte Token sollte nach POST /v1/auth/session nicht mehr gültig sein (Rotation)");
    authToken = refreshed.token;

    const refreshNoTokenRes = await globalThis.fetch(`${base}/v1/auth/session`, { method: "POST" });
    assert(refreshNoTokenRes.status === 401, "POST /v1/auth/session ohne Authorization-Header sollte 401 liefern");

    // Ab hier: lokales `fetch` überschreibt (shadowed) das globale für den
    // Rest von main() -- hängt automatisch den aktuellen Bearer-Token an,
    // ohne jede der folgenden ~30 Fetch-Aufrufstellen einzeln anzufassen.
    // `globalThis.fetch(...)` bleibt weiterhin der unauthentifizierte Weg,
    // falls später noch ein expliziter 401-Fall gebraucht wird.
    const rawFetch = globalThis.fetch.bind(globalThis);
    const fetch = ((input: Parameters<typeof rawFetch>[0], init?: Parameters<typeof rawFetch>[1]) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${authToken}`);
      return rawFetch(input, { ...init, headers });
    }) as typeof rawFetch;

    const accountsRes = await fetch(`${base}/v1/accounts`);
    assert(accountsRes.status === 200, "GET /v1/accounts sollte 200 liefern");
    const accounts = await accountsRes.json();
    assert(Array.isArray(accounts) && accounts.length > 0, "mind. 1 Konto erwartet");

    // Periodischer + manueller Mail-Abruf (WEB_INBOX.md 21.09. "SEHR
    // WICHTIGE LUECKE - HOECHSTE PRIORITAET", Punkt 1, siehe
    // mail/scheduler.ts). Bewusst HIER, ganz am Anfang, VOR jedem Test, der
    // eine Fixture-Nachricht verschiebt/endgültig löscht: der
    // FixtureMailAdapter liefert bei jedem Aufruf dieselben statischen
    // Test-Mails zurück (kein echtes Postfach dahinter, aus dem eine
    // gelöschte Mail auch wirklich verschwindet, anders als bei einem
    // echten Gmail-/IMAP-Konto -- dort spiegelt `mirrorToProvider()` ein
    // permanentes Löschen tatsächlich zum Provider, siehe
    // routes/messages.ts). Ein späterer Sync-Aufruf NACH einem
    // Fixture-Permanent-Delete-Test würde die Nachricht fälschlich als
    // "neu" re-importieren -- ein Artefakt des statischen Test-Fixtures,
    // kein Bug im echten Dedupe (`findMessageByHeader`), deshalb hier vor
    // jeder Mutation getestet statt die Reihenfolge dieses Smoketests
    // umzubauen.
    const manualSyncRes = await fetch(`${base}/v1/accounts/${account.id}/sync`, { method: "POST" });
    assert(manualSyncRes.status === 200, "POST /v1/accounts/{accountId}/sync sollte 200 liefern");
    const manualSyncBody = (await manualSyncRes.json()) as { imported: number; autoDeleted: number; syncStatus: string };
    assert(
      manualSyncBody.imported === 0,
      "erneuter manueller Sync desselben Kontos sollte dank Dedupe (findMessageByHeader/wasAutoDeleted) 0 neu importierte Nachrichten liefern",
    );
    assert(manualSyncBody.syncStatus === "ok", "syncStatus sollte nach erfolgreichem Sync 'ok' sein");

    const foreignAccountSyncRes = await fetch(`${base}/v1/accounts/00000000-0000-0000-0000-000000000000/sync`, { method: "POST" });
    assert(
      foreignAccountSyncRes.status === 404,
      "POST /v1/accounts/{accountId}/sync mit unbekannter/fremder accountId sollte 404 liefern, nicht z.B. 500",
    );

    const unauthSyncRes = await globalThis.fetch(`${base}/v1/accounts/${account.id}/sync`, { method: "POST" });
    assert(unauthSyncRes.status === 401, "POST /v1/accounts/{accountId}/sync ohne Bearer-Token sollte 401 liefern");

    // Der periodische Scheduler ruft exakt dieselbe syncAccount()-Funktion
    // wie oben auf, nur für ALLE Konten statt eines einzelnen -- hier direkt
    // aufgerufen (statt den echten Timer abzuwarten) und geprüft, dass er
    // nicht wirft.
    await runSyncForAllAccounts();

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

    // [2026-09-19] Fund beim Testen gegen echtes Postgres (reproduzierbar,
    // nicht nur einmal beobachtet): "messages[0]" ist NICHT deterministisch
    // -- mehrere Fixtures teilen denselben receivedAt-Wert (daysAgo(0)),
    // "ORDER BY received_at DESC" (postgresStore.ts listMessages()) hat
    // keinen Tiebreaker. Das traf bisher zufällig meist Fixture 2/6 (beide
    // ohnehin schon automatisch in Quarantäne wegen classification=
    // "phishing", daher unauffällig), einmal aber Fixture 4 -- das brachte
    // die weiter unten benannten Fixture-4-Assertions zum Flackern, weil
    // Fixture 4 durch den generischen Quarantäne-Test hier plötzlich nicht
    // mehr unquarantiniert war. Deshalb bewusst auf Fixture 2 fixiert
    // (bereits automatisch quarantiniert, ein zusätzlicher manueller
    // Quarantäne-Aufruf ändert an dessen Zustand nichts strukturell Neues)
    // statt eine mehrdeutige Sortierposition zu verwenden.
    const first = messages.find((m: { id: string }) => m.id === fixture2ForUnsub!.id) ?? messages[0];

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
    async function uploadAttachment(
      filename: string,
      content: string,
    ): Promise<{ status: number; attachmentId?: string; scanStatus?: string; containsSensitiveDocument?: string }> {
      const form = new FormData();
      form.append("file", new Blob([content], { type: "text/plain" }), filename);
      const res = await fetch(`${base}/v1/attachments`, { method: "POST", body: form });
      const json = res.status === 200 ? ((await res.json()) as Record<string, unknown>) : undefined;
      return {
        status: res.status,
        attachmentId: json?.attachmentId as string | undefined,
        scanStatus: json?.scanStatus as string | undefined,
        containsSensitiveDocument: json?.containsSensitiveDocument as string | undefined,
      };
    }

    // Wie uploadAttachment(), aber mit einem echten Bild von der Platte
    // (test-fixtures/, siehe dortige README-Notiz) statt Text-Inhalt --
    // nötig für die Sensible-Dokument-Erkennung unten, die nur für
    // Bild-MIME-Typen überhaupt einen OCR-Versuch macht.
    async function uploadImageFixture(
      fixtureFilename: string,
    ): Promise<{ status: number; attachmentId?: string; scanStatus?: string; containsSensitiveDocument?: string }> {
      const bytes = readFileSync(join(FIXTURES_DIR, fixtureFilename));
      const form = new FormData();
      form.append("file", new Blob([bytes], { type: "image/png" }), fixtureFilename);
      const res = await fetch(`${base}/v1/attachments`, { method: "POST", body: form });
      const json = res.status === 200 ? ((await res.json()) as Record<string, unknown>) : undefined;
      return {
        status: res.status,
        attachmentId: json?.attachmentId as string | undefined,
        scanStatus: json?.scanStatus as string | undefined,
        containsSensitiveDocument: json?.containsSensitiveDocument as string | undefined,
      };
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

    // Sensible-Dokument-Erkennung (WEB_INBOX.md 15.09. "Sensible-Daten-
    // Erkennung um Fotos von Ausweisen/Kreditkarten erweitern"): echte
    // Bild-Fixtures (test-fixtures/, per Chrome gerendert, kein
    // handgezeichnetes Testbild) durch die tatsächliche OCR-Pipeline
    // (tesseract.js) geschickt -- kein Mock, echte Bilderkennung.
    const creditCardUpload = await uploadImageFixture("credit-card-photo.png");
    assert(creditCardUpload.status === 200, "POST /v1/attachments (Kreditkarten-Foto) sollte 200 liefern");
    assert(creditCardUpload.scanStatus === "clean", "Kreditkarten-Foto ist kein gefährlicher Dateityp, scanStatus sollte 'clean' sein");
    assert(
      creditCardUpload.containsSensitiveDocument === "credit_card",
      `Kreditkarten-Foto sollte per OCR+Luhn als 'credit_card' erkannt werden, war '${creditCardUpload.containsSensitiveDocument}'`,
    );

    const idDocumentUpload = await uploadImageFixture("id-document-photo.png");
    assert(idDocumentUpload.status === 200, "POST /v1/attachments (Ausweis-Foto) sollte 200 liefern");
    assert(
      idDocumentUpload.containsSensitiveDocument === "id_document",
      `Ausweis-Foto (MRZ) sollte per OCR+MRZ-Heuristik als 'id_document' erkannt werden, war '${idDocumentUpload.containsSensitiveDocument}'`,
    );

    const innocuousUpload = await uploadImageFixture("innocuous-photo.png");
    assert(innocuousUpload.status === 200, "POST /v1/attachments (unauffälliges Foto) sollte 200 liefern");
    assert(
      innocuousUpload.containsSensitiveDocument === "none",
      `unauffälliges Foto sollte 'none' liefern, war '${innocuousUpload.containsSensitiveDocument}'`,
    );

    // Nicht-Bild-Anhang (das bereits oben hochgeladene cleanUpload, ein
    // "PDF"): kein OCR-Versuch, immer 'none' -- verifiziert die
    // MIME-Type-Weiche in sensitiveDocumentScan.ts, nicht nur den
    // Bild-Pfad.
    assert(
      cleanUpload.containsSensitiveDocument === "none",
      `Nicht-Bild-Anhang sollte 'none' liefern ohne OCR-Versuch, war '${cleanUpload.containsSensitiveDocument}'`,
    );

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
    //
    // [2026-09-15] Bugfix (SYNC.md 10.09., vorbestehender, nie behobener
    // Fund): gegen echtes Postgres verletzte das direkte INSERT unten die
    // `folders_system_key_check`-Constraint, die seit dem Ordner-Umbau nur
    // noch die neue 7er-Liste erlaubt -- auf einer frisch aus
    // contracts/db-schema.sql aufgesetzten Test-DB kann "wichtig" so nie
    // eingefügt werden, obwohl genau das auf einer echten, VOR dem Umbau
    // angelegten Produktions-DB möglich ist (siehe Kommentar an
    // runWithRelaxedSystemKeyConstraint() in postgresStore.ts). Deshalb hier
    // die Constraint für Postgres kurzzeitig entfernt, für InMemoryStore
    // (kein echtes Constraint-Konzept) läuft derselbe Code unverändert direkt.
    const runLegacyFolderMigrationCheck = async () => {
      const legacyWichtigFolder = await store.createFolder({
        mailAccountId: account.id,
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
        inReplyToMessageId: null,
      });
      await ensureDemoUser(); // triggert migrateLegacySystemFolders() (Store hat bereits Ordner -> else-Zweig)
      const migratedMessage = await store.getMessage(legacyMessage.id);
      assert(migratedMessage !== undefined, "Nachricht aus dem alten 'wichtig'-Ordner darf nicht verloren gehen");
      assert(migratedMessage!.folderId === eingangFolder!.id, "Nachricht aus 'wichtig' sollte nach der Migration in 'eingang' liegen");
    };
    if (store instanceof PostgresStore) {
      await store.runWithRelaxedSystemKeyConstraint(runLegacyFolderMigrationCheck);
    } else {
      await runLegacyFolderMigrationCheck();
    }
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

    // Anzeigename-Spoofing / Reply-To-Mismatch (WEB_INBOX.md 15.09., "6
    // Sicherheits-Ergaenzungen" Punkt 1+2). Fixture 6 hat einen "From"-Header
    // mit Markenname "Apple Support" ueber einer fremden Domain -> zweites,
    // unabhaengiges Phishing-Signal on top vom Homoglyph-Fund oben.
    assert(
      fixture6Security.displayNameSpoofingDetected === true,
      "Fixture 6 ('Apple Support' <support@apple-id-verify.example>) sollte als Anzeigename-Spoofing erkannt werden (Markenname, fremde Domain)",
    );
    assert(
      fixture1Security.displayNameSpoofingDetected === false,
      "Fixture 1 (kein bekannter Markenname im Anzeigenamen) sollte NICHT als Anzeigename-Spoofing erkannt werden",
    );

    // Fixture 2 hat einen Reply-To-Header, dessen Domain von der From-Domain
    // abweicht (klassischer BEC-Trick) -- zusaetzliches Signal neben den
    // bereits bestehenden (Auth-Fail, Dringlichkeit, IBAN, Botnetz-IP).
    assert(
      fixture2Security.replyToMismatchDetected === true,
      "Fixture 2 (Reply-To auf andere-domain.ru, From auf sicherheit-konto-check.tk) sollte als Reply-To-Mismatch erkannt werden",
    );
    assert(
      fixture4Security.replyToMismatchDetected === false,
      "Fixture 4 (kein Reply-To-Header) sollte NICHT als Reply-To-Mismatch erkannt werden",
    );

    // "Erster Kontakt"-Kennzeichnung (WEB_INBOX.md 15.09., Punkt 4): jede der
    // sieben Fixtures kommt von einer bisher unbekannten Adresse -> beim
    // JEWEILS ERSTEN Sync-Lauf muss isNewSender=true gelten. Nach einem
    // zweiten Sync desselben Absenders (unten, Fixture 2 erneut simuliert
    // über eine zweite Nachricht) muss es auf false kippen.
    assert(fixture1Detail.isNewSender === true, "Fixture 1 sollte beim ersten Kontakt isNewSender=true liefern");
    assert(fixture4Detail.isNewSender === true, "Fixture 4 sollte beim ersten Kontakt isNewSender=true liefern");

    // Zweite Nachricht von Fixture 4s Absender direkt über den Store
    // eingefügt (kein voller Sync-Durchlauf nötig) -- isNewSender wird zur
    // Laufzeit abgeleitet (siehe store.hasOtherMessageFromAddress()-
    // Kommentar), muss also für BEIDE Nachrichten dieses Absenders jetzt
    // false liefern, sobald eine zweite existiert.
    const secondMessageFromFixture4Sender = await store.insertMessage({
      mailAccountId: account.id,
      messageIdHeader: "<zweite-mail-von-kollegin@example.com>",
      providerMessageId: null,
      fromAddress: fixture4!.fromAddress,
      fromDisplayName: fixture4!.fromDisplayName,
      replyToAddress: null,
      subject: "Re: Projektupdate Q3",
      bodyText: "Kurze Rückfrage dazu.",
      receivedAt: new Date().toISOString(),
      folderId: fixture4!.folderId,
      rawHeaders: { From: "Anna Kollegin <kollegin@example.com>" },
      // Echte Thread-Antwort auf Fixture 4 (Subject "Re: ..." oben) --
      // nebenbei Grundlage für den IBAN-Wechsel-im-Thread-Test unten.
      inReplyToMessageId: fixture4!.id,
    });
    const fixture4DetailAfterSecond = (await (await fetch(`${base}/v1/messages/${fixture4!.id}`)).json()) as Record<string, unknown>;
    assert(
      fixture4DetailAfterSecond.isNewSender === false,
      "sobald eine zweite Nachricht desselben Absenders existiert, sollte auch die ERSTE Nachricht isNewSender=false liefern (zur Laufzeit abgeleitet)",
    );
    const secondMessageDetail = (await (await fetch(`${base}/v1/messages/${secondMessageFromFixture4Sender.id}`)).json()) as Record<
      string,
      unknown
    >;
    assert(
      secondMessageDetail.isNewSender === false,
      "die zweite Nachricht selbst sollte ebenfalls isNewSender=false liefern (die erste existiert bereits)",
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

    // 3b) IBAN-Wechsel im selben Thread (WEB_INBOX.md 15.09., "6 Sicherheits-
    // Ergaenzungen" Punkt 3): Fixture 8 (Original-Rechnung, IBAN A) + Fixture
    // 9 (Thread-Antwort per "In-Reply-To", IBAN B) -- eigenständiges Signal,
    // unabhängig von containsNewIban/ibanHistoryCheck (sender-basiert) oben.
    const fixture8 = await store.findMessageByHeader(account.id, "<fixture-8@lieferant-beispiel.de>");
    assert(fixture8 !== undefined, "Fixture 8 sollte importiert worden sein");
    const fixture9 = await store.findMessageByHeader(account.id, "<fixture-9@lieferant-beispiel.de>");
    assert(fixture9 !== undefined, "Fixture 9 sollte importiert worden sein");
    assert(
      fixture9!.inReplyToMessageId === fixture8!.id,
      "Fixture 9s 'In-Reply-To'-Header sollte auf Fixture 8 aufgelöst werden (messages.in_reply_to_message_id)",
    );

    const fixture8Detail = (await (await fetch(`${base}/v1/messages/${fixture8!.id}`)).json()) as Record<string, unknown>;
    const fixture8Security = fixture8Detail.security as Record<string, unknown>;
    assert(
      fixture8Security.ibanChangedInThread === false,
      "Fixture 8 (erste Nachricht des Threads, kein Vorgänger) sollte ibanChangedInThread=false liefern",
    );

    const fixture9Detail = (await (await fetch(`${base}/v1/messages/${fixture9!.id}`)).json()) as Record<string, unknown>;
    const fixture9Security = fixture9Detail.security as Record<string, unknown>;
    assert(
      fixture9Security.ibanChangedInThread === true,
      "Fixture 9 (andere IBAN als Fixture 8, selber Thread) sollte ibanChangedInThread=true liefern",
    );

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

    // ----- Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): der bereits
    // eingeloggte Demo-User (authToken) verbindet ein ZWEITES, eigenes
    // Konto -- muss am SELBEN User landen (nicht einen neuen User
    // anlegen), eigene System-Ordner bekommen, und beide Konten müssen
    // über GET /accounts + GET /folders sichtbar sein. -----
    const secondAccountEmail = "demo-zweitkonto@driftmail.local";
    const addAccountRes = await fetch(`${base}/v1/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "gmail", emailAddress: secondAccountEmail }),
    });
    assert(addAccountRes.status === 200, "POST /v1/accounts mit bestehendem Token + neuer E-Mail-Adresse sollte 200 liefern");
    const addAccountBody = (await addAccountRes.json()) as { account: { id: string; emailAddress: string }; token: string };
    assert(
      addAccountBody.token === authToken,
      "Konto zu einem bestehenden Login hinzufügen sollte denselben Token zurückgeben, keinen neuen ausstellen",
    );
    assert(addAccountBody.account.emailAddress === secondAccountEmail, "zurückgegebenes Konto sollte die neue E-Mail-Adresse tragen");

    const accountsAfterAdd = await store.listMailAccountsByUserId(account.userId);
    assert(accountsAfterAdd.length === 2, "Demo-User sollte jetzt genau 2 Konten haben");

    // Idempotenz: derselbe Token + dieselbe E-Mail-Adresse ein zweites Mal
    // -> dasselbe Konto, kein drittes.
    const addAccountAgainRes = await fetch(`${base}/v1/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "gmail", emailAddress: secondAccountEmail }),
    });
    const addAccountAgainBody = (await addAccountAgainRes.json()) as { account: { id: string } };
    assert(
      addAccountAgainBody.account.id === addAccountBody.account.id,
      "erneutes Verbinden derselben E-Mail-Adresse unter demselben Login sollte dasselbe Konto liefern, kein drittes anlegen",
    );
    assert((await store.listMailAccountsByUserId(account.userId)).length === 2, "weiterhin genau 2 Konten nach dem idempotenten zweiten Aufruf erwartet");

    // Jedes Konto bekommt seine EIGENEN 7 System-Ordner ("getrennte
    // Ansichten pro Konto", nicht ein gemeinsamer Ordnerbaum).
    const secondAccountFoldersRes = await fetch(`${base}/v1/folders?accountId=${addAccountBody.account.id}`);
    const secondAccountFolders = (await secondAccountFoldersRes.json()) as Array<Record<string, unknown>>;
    assert(secondAccountFolders.length === 7, "zweites Konto sollte 7 eigene System-Ordner haben");
    assert(
      secondAccountFolders.every((f) => f.accountId === addAccountBody.account.id),
      "alle zurückgegebenen Ordner sollten zum angefragten Konto gehören",
    );

    // GET /folders OHNE accountId: Ordner ALLER eigenen Konten zusammen (14 = 7+7).
    const allOwnFoldersRes = await fetch(`${base}/v1/folders`);
    const allOwnFolders = (await allOwnFoldersRes.json()) as Array<Record<string, unknown>>;
    assert(allOwnFolders.length === 14, "GET /folders ohne accountId sollte Ordner beider eigener Konten zusammen liefern (7+7)");

    // Ownership: ein fremdes accountId (z.B. noch gar nicht verbunden) -> 403.
    const foreignAccountFoldersRes = await fetch(`${base}/v1/folders?accountId=00000000-0000-0000-0000-000000000000`);
    assert(foreignAccountFoldersRes.status === 403, "GET /folders?accountId=<fremd/unbekannt> sollte 403 liefern");

    // POST /folders ohne accountId ist jetzt mehrdeutig (2 Konten) -> 400.
    const ambiguousCreateFolderRes = await fetch(`${base}/v1/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Mehrdeutig" }),
    });
    assert(
      ambiguousCreateFolderRes.status === 400,
      "POST /folders ohne accountId sollte bei mehreren verbundenen Konten 400 liefern",
    );

    // Mit explizitem accountId funktioniert das Anlegen weiterhin.
    const explicitCreateFolderRes = await fetch(`${base}/v1/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Zweitkonto-Ordner", accountId: addAccountBody.account.id }),
    });
    assert(explicitCreateFolderRes.status === 201, "POST /folders mit explizitem accountId sollte weiterhin 201 liefern");
    const explicitCreateFolderBody = (await explicitCreateFolderRes.json()) as { accountId: string };
    assert(
      explicitCreateFolderBody.accountId === addAccountBody.account.id,
      "neu angelegter Ordner sollte zum angegebenen Konto gehören",
    );

    // ----- Autorisierung (echte Auth, [2026-09-10]): ein zweiter, echter
    // User darf NICHT auf die Nachrichten/Ordner des ersten zugreifen, nur
    // weil er selbst eingeloggt ist (Authentifizierung allein reicht nicht,
    // siehe requireOwnMessage()/Besitz-Prüfungen in routes/*.ts). -----
    const secondUserConnectRes = await globalThis.fetch(`${base}/v1/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "gmail", emailAddress: "zweiter-user@driftmail.local" }),
    });
    const secondUserConnected = (await secondUserConnectRes.json()) as { token: string };
    const secondUserToken = secondUserConnected.token;
    assert(secondUserToken !== authToken, "zweiter User sollte einen eigenen, anderen Token bekommen");

    const crossUserMessageRes = await globalThis.fetch(`${base}/v1/messages/${fixture1!.id}`, {
      headers: { Authorization: `Bearer ${secondUserToken}` },
    });
    assert(crossUserMessageRes.status === 403, "zweiter User sollte auf die Nachricht des ersten Users mit 403 abgewiesen werden");

    const crossUserFoldersRes = await globalThis.fetch(`${base}/v1/folders`, { headers: { Authorization: `Bearer ${secondUserToken}` } });
    const secondUserFolders = (await crossUserFoldersRes.json()) as Array<Record<string, unknown>>;
    assert(
      !secondUserFolders.some((f) => folders.some((ownFolder) => (ownFolder as Record<string, unknown>).id === f.id)),
      "zweiter User sollte eigene, komplett andere Ordner-IDs bekommen (eigene 7 Standard-Ordner, keine Überschneidung)",
    );
    assert(secondUserFolders.length === 7, "zweiter, frisch angelegter User sollte ebenfalls die 7 Standard-Ordner bekommen");

    // ----- Whitelist (WEB_INBOX.md 15.09., "Whitelist für vertrauenswürdige
    // Absender"): der zweite User (oben angelegt, noch NICHT synchronisiert)
    // markiert Fixture 2s Absender (die Phishing-Fixture) als
    // vertrauenswürdig, BEVOR er zum ersten Mal synchronisiert -- stärkster
    // Beleg für "Vorrang vor der automatischen Erkennung", da hier sogar ein
    // eigentlich als phishing eingestuftes Signal überstimmt wird. -----
    const trustedSenderAddress = "service@sicherheit-konto-check.tk"; // Fixture 2, siehe mail/fixtureAdapter.ts

    const listTrustedEmptyRes = await globalThis.fetch(`${base}/v1/trusted-senders`, {
      headers: { Authorization: `Bearer ${secondUserToken}` },
    });
    const trustedEmpty = (await listTrustedEmptyRes.json()) as unknown[];
    assert(
      listTrustedEmptyRes.status === 200 && trustedEmpty.length === 0,
      "GET /trusted-senders sollte für einen frischen User eine leere Liste liefern",
    );

    const addTrustedRes = await globalThis.fetch(`${base}/v1/trusted-senders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secondUserToken}` },
      body: JSON.stringify({ senderAddress: trustedSenderAddress }),
    });
    assert(addTrustedRes.status === 201, "POST /trusted-senders sollte 201 liefern");
    const addedTrusted = (await addTrustedRes.json()) as { id: string; senderAddress: string };
    assert(
      addedTrusted.senderAddress === trustedSenderAddress,
      "angelegter Whitelist-Eintrag sollte die gesendete Adresse zurückliefern",
    );

    // Idempotenz + Case-Insensitivität: erneutes Hinzufügen derselben (hier
    // GROSSGESCHRIEBENEN) Adresse liefert denselben Eintrag, keinen zweiten.
    const addTrustedAgainRes = await globalThis.fetch(`${base}/v1/trusted-senders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secondUserToken}` },
      body: JSON.stringify({ senderAddress: trustedSenderAddress.toUpperCase() }),
    });
    const addedTrustedAgain = (await addTrustedAgainRes.json()) as { id: string };
    assert(
      addedTrustedAgain.id === addedTrusted.id,
      "erneutes (case-insensitiv gleiches) Hinzufügen sollte denselben Eintrag liefern statt eines zweiten",
    );

    const missingSenderRes = await globalThis.fetch(`${base}/v1/trusted-senders`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secondUserToken}` },
      body: JSON.stringify({}),
    });
    assert(missingSenderRes.status === 400, "POST /trusted-senders ohne senderAddress sollte 400 liefern");

    const secondUserRecord = await store.getUserByEmail("zweiter-user@driftmail.local");
    assert(secondUserRecord !== undefined, "zweiter User sollte im Store auffindbar sein");
    const secondUserAccount = await store.getMailAccountByUserId(secondUserRecord!.id);
    assert(secondUserAccount !== undefined, "zweiter User sollte ein Mail-Konto haben (POST /accounts legt es an)");

    const { imported: secondUserImported, autoDeleted: secondUserAutoDeleted } = await syncAccount(secondUserAccount!, aiAdapter);
    assert(secondUserImported > 0, "Sync des zweiten Users sollte Nachrichten importieren");
    // Whitelist wirkt gezielt NUR auf Fixture 2 -- Fixture 5 (gambling) und
    // Fixture 7 (advance_fee_scam) werden trotzdem automatisch gelöscht,
    // ihre Absender stehen nicht auf der Whitelist dieses Users.
    assert(
      secondUserAutoDeleted === 2,
      "Whitelist betrifft nur Fixture 2 -- Fixture 5/7 werden beim zweiten User trotzdem automatisch gelöscht",
    );

    const secondUserFixture2 = await store.findMessageByHeader(secondUserAccount!.id, "<fixture-2@sicherheit-konto-check.tk>");
    assert(
      secondUserFixture2 !== undefined,
      "Fixture 2 sollte beim zweiten User trotz Phishing-Inhalt als normale Nachricht landen (Whitelist)",
    );
    const secondUserFixture2Security = await store.getMessageSecurity(secondUserFixture2!.id);
    assert(
      secondUserFixture2Security?.classification === "safe",
      "Whitelist sollte die Klassifikation auf 'safe' überschreiben, unabhängig vom Phishing-Signal",
    );
    assert(secondUserFixture2Security?.spamSubcategory === null, "spamSubcategory sollte beim Whitelist-Override null sein");

    const secondUserEingang = await store.getSystemFolder(secondUserAccount!.id, "eingang");
    assert(
      secondUserFixture2!.folderId === secondUserEingang!.id,
      "whitelisted Mail sollte in 'eingang' landen, nicht in Quarantäne/Spam",
    );

    const secondUserQuarantine = await store.getQuarantineForMessage(secondUserFixture2!.id);
    assert(secondUserQuarantine === undefined, "whitelisted, eigentlich phishing-artige Mail darf NICHT in Quarantäne landen");

    // Autorisierung: der ERSTE User darf den Whitelist-Eintrag des zweiten
    // Users weder sehen (eigener GET liefert nur eigene Einträge, hier nicht
    // erneut geprüft) noch löschen dürfen.
    const crossUserDeleteTrustedRes = await globalThis.fetch(`${base}/v1/trusted-senders/${addedTrusted.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert(
      crossUserDeleteTrustedRes.status === 403,
      "erster User sollte den Whitelist-Eintrag des zweiten Users nicht löschen dürfen (403)",
    );

    const deleteTrustedRes = await globalThis.fetch(`${base}/v1/trusted-senders/${addedTrusted.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${secondUserToken}` },
    });
    assert(deleteTrustedRes.status === 204, "DELETE /trusted-senders/:id sollte 204 liefern");

    const listTrustedAfterDeleteRes = await globalThis.fetch(`${base}/v1/trusted-senders`, {
      headers: { Authorization: `Bearer ${secondUserToken}` },
    });
    const trustedAfterDelete = (await listTrustedAfterDeleteRes.json()) as unknown[];
    assert(trustedAfterDelete.length === 0, "nach DELETE sollte die Whitelist wieder leer sein");

    const deleteMissingTrustedRes = await globalThis.fetch(
      `${base}/v1/trusted-senders/00000000-0000-0000-0000-000000000000`,
      { method: "DELETE", headers: { Authorization: `Bearer ${secondUserToken}` } },
    );
    assert(deleteMissingTrustedRes.status === 404, "DELETE /trusted-senders/:id für unbekannte id sollte 404 liefern");

    // ----- Provider-Support (WEB_INBOX.md 15.09., "ECHTE LUECKE
    // ENTDECKT"): Credentials-Verschlüsselung, GET /mail-providers, echter
    // IMAP-Verbindungstest bei POST /accounts. -----

    // Verschlüsselungs-Rundreise (auth/credentialsEncryption.ts) direkt
    // geprüft, unabhängig von HTTP: Klartext muss nach der Rundreise exakt
    // wiederhergestellt werden, UND das Chiffrat darf den Klartext nicht
    // enthalten (sonst wäre es keine echte Verschlüsselung, nur Kodierung).
    const plaintextSecret = "super-geheimes-app-passwort-DE68210501700012345678";
    const encryptedSecret = encryptCredentials(plaintextSecret);
    assert(encryptedSecret !== plaintextSecret, "verschlüsselter Wert darf nicht mit dem Klartext identisch sein");
    assert(!encryptedSecret.includes(plaintextSecret), "verschlüsselter Wert darf den Klartext nicht im Chiffrat enthalten");
    assert(decryptCredentials(encryptedSecret) === plaintextSecret, "Entschlüsseln sollte exakt den ursprünglichen Klartext liefern");
    // Zwei Verschlüsselungen desselben Klartexts müssen sich unterscheiden
    // (zufälliger IV pro Aufruf) -- sonst wäre ein wiederholtes Muster im
    // Chiffrat erkennbar, obwohl der Klartext geheim bleiben soll.
    assert(encryptCredentials(plaintextSecret) !== encryptedSecret, "zwei Verschlüsselungen desselben Klartexts sollten sich unterscheiden (zufälliger IV)");

    // GET /mail-providers -- unauthentifiziert (Onboarding läuft vor dem Login).
    const providersRes = await globalThis.fetch(`${base}/v1/mail-providers`);
    assert(providersRes.status === 200, "GET /mail-providers sollte auch ohne Bearer-Token 200 liefern");
    const providers = (await providersRes.json()) as Array<Record<string, unknown>>;
    assert(Array.isArray(providers) && providers.length >= 6, "mind. 6 Provider-Presets erwartet (gmail, outlook, yahoo, icloud, gmx, web_de, other_imap)");
    const gmailProvider = providers.find((p) => p.id === "gmail");
    assert(gmailProvider?.authType === "oauth" && gmailProvider?.comingSoon === false, "gmail sollte authType=oauth und comingSoon=false liefern");
    const outlookProvider = providers.find((p) => p.id === "outlook");
    assert(outlookProvider?.authType === "oauth" && outlookProvider?.comingSoon === true, "outlook sollte authType=oauth und comingSoon=true liefern (wartet laut Auftrag)");
    const gmxProvider = providers.find((p) => p.id === "gmx");
    assert(
      gmxProvider?.authType === "imap" && gmxProvider?.imapHost === "imap.gmx.net" && gmxProvider?.imapPort === 993,
      "gmx sollte authType=imap mit vorbefülltem Host/Port liefern",
    );
    const otherImapProvider = providers.find((p) => p.id === "other_imap");
    assert(
      otherImapProvider?.authType === "imap" && otherImapProvider?.imapHost === null,
      "other_imap sollte authType=imap mit imapHost=null liefern (User trägt selbst ein)",
    );

    // POST /accounts provider=imap ohne imapHost/imapPassword -> 400, kein
    // Verbindungsversuch, keine Zeile angelegt.
    const imapMissingFieldsRes = await globalThis.fetch(`${base}/v1/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "imap", emailAddress: "imap-missing-fields@example.com" }),
    });
    assert(imapMissingFieldsRes.status === 400, "POST /accounts provider=imap ohne imapHost/imapPassword sollte 400 liefern");

    // POST /accounts provider=imap mit unerreichbarem Host -> echter
    // Verbindungsversuch (ImapAdapter.testConnection()) schlägt fehl -> 422,
    // NICHTS wird gespeichert (weder Konto noch verschlüsselte Zugangsdaten).
    const imapBadHostEmail = "imap-bad-host-test@example.com";
    const imapBadCredentialsRes = await globalThis.fetch(`${base}/v1/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "imap",
        emailAddress: imapBadHostEmail,
        imapHost: "imap.invalid.nonexistent-domain-for-driftmail-testing.example",
        imapPassword: "falsches-passwort",
      }),
    });
    assert(
      imapBadCredentialsRes.status === 422,
      "POST /accounts provider=imap mit nicht erreichbarem Host sollte 422 liefern (echter Verbindungstest schlägt fehl)",
    );
    const imapBadHostUser = await store.getUserByEmail(imapBadHostEmail);
    if (imapBadHostUser) {
      const imapBadHostAccount = await store.getMailAccountByUserId(imapBadHostUser.id);
      assert(
        imapBadHostAccount === undefined,
        "bei fehlgeschlagenem IMAP-Verbindungstest darf kein Mail-Konto angelegt werden (User-Zeile allein ist unkritisch, siehe backend/README.md)",
      );
    }

    // Hinweis (analog zur Gmail-OAuth-Testlücke, siehe backend/README.md
    // "Auth" -> "Echter Google-Login"): ein ECHTER, erfolgreicher IMAP-Login
    // (gültiger Host + echtes App-Passwort) lässt sich ohne eine reale
    // Mailbox in dieser Umgebung nicht end-to-end durchspielen -- die
    // Verbindungstest-/Verschlüsselungs-Logik selbst ist oben geprüft,
    // Massimo müsste den kompletten Weg einmal mit einem echten GMX-/
    // web.de-/iCloud-Konto gegentesten.

    console.log("✔ Smoketest erfolgreich: Kernfluss (Auth -> Sync -> Messages -> Summary -> Reply-Draft -> Quarantäne -> Papierkorb/Löschen -> Contracts -> Capability -> Draft-Phishing-Check -> Versand -> Anhang-Upload/Scan -> Entwürfe -> Ordner-Umbau-Migration -> Externe Lookup-Adapter -> Automatische/Manuelle Abmeldung bei Spam -> Whitelist/Vorschussbetrug-Auto-Löschung -> Provider-Support -> Periodischer/Manueller Mail-Abruf) end-to-end grün.");
  } finally {
    server.close();
    // Ohne das haelt der tesseract.js-Worker (worker_threads) den Prozess
    // am Leben -- server.close() allein reicht nicht zum sauberen Beenden,
    // siehe Kommentar an OcrAdapter.terminate().
    await ocrAdapter.terminate?.();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
