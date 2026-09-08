// Einfacher End-to-End-Smoketest ohne Testframework: startet die App
// in-process, spielt den Kernfluss durch und prüft grob die Response-Form
// gegen contracts/api-spec.yaml. `npm test` führt das aus.

import { createApp } from "./app";
import { ensureDemoUser, store } from "./db/store";
import { syncAccount } from "./mail/sync";
import { aiAdapter } from "./ai";
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

    console.log("✔ Smoketest erfolgreich: Kernfluss (Sync -> Messages -> Summary -> Reply-Draft -> Quarantäne -> Contracts -> Capability) end-to-end grün.");
  } finally {
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
