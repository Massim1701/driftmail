// Ordner-Endpunkte — neu durch die Contract-Änderung "benutzerdefinierte
// Ordner statt festem Enum" (SYNC.md, Commit 734781e). Siehe api-spec.yaml
// /folders, /folders/{folderId}.

import type { Request, Response } from "express";
import { Router } from "express";
import { store } from "../db/store";
import { toApiFolder } from "../mappers";
import type { FolderRecord, SystemFolderKey } from "../types";

export const foldersRouter = Router();

// quarantaene/spam/papierkorb/entwuerfe/gesendet sind laut design-tokens.json
// (systemFolders.defaults, renamable: false) nicht umbenennbar — API lehnt
// PATCH auf `name` für diese mit 400 ab. [2026-09-10] Ordner-Umbau
// (WEB_INBOX.md 09.09.): entwuerfe/gesendet ergänzt.
const NOT_RENAMABLE: SystemFolderKey[] = ["quarantaene", "spam", "papierkorb", "entwuerfe", "gesendet"];

// design-tokens.json: customFolder.defaultIcon
const CUSTOM_FOLDER_DEFAULT_ICON = "folder";

// [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): Ordner gehören
// jetzt zu einem mail_account, nicht mehr direkt zu einem User -- Besitz
// läuft über das Konto des Ordners, analog zu requireOwnMessage() in
// routes/messages.ts. Schreibt bei Fehlschlag direkt die Response (404 bei
// unbekannter folderId, 403 bei fremder), damit die Aufrufer nur noch
// `if (!folder) return;` prüfen müssen.
async function requireOwnFolder(req: Request, res: Response, folderId: string): Promise<FolderRecord | null> {
  const folder = await store.getFolder(folderId);
  if (!folder) {
    res.status(404).json({ error: "Ordner nicht gefunden" });
    return null;
  }
  const account = await store.getMailAccount(folder.mailAccountId);
  if (!account || account.userId !== req.userId) {
    res.status(403).json({ error: "Ordner gehört nicht zum angemeldeten User" });
    return null;
  }
  return folder;
}

// GET /folders?accountId= — siehe api-spec.yaml. Mit accountId nur die
// Ordner dieses (eigenen) Kontos, ohne accountId alle Ordner ALLER eigenen
// Konten zusammen (flache Liste, jeder Folder trägt seine eigene
// accountId -- "getrennte Ansichten pro Konto" ist Sache des Clients).
foldersRouter.get("/folders", async (req, res) => {
  const accountId = typeof req.query.accountId === "string" ? req.query.accountId : undefined;

  if (accountId) {
    const account = await store.getMailAccount(accountId);
    if (!account || account.userId !== req.userId) {
      return res.status(403).json({ error: "Mail-Konto gehört nicht zum angemeldeten User" });
    }
    return res.json((await store.listFolders(accountId)).map(toApiFolder));
  }

  const accounts = await store.listMailAccountsByUserId(req.userId);
  const perAccount = await Promise.all(accounts.map((a) => store.listFolders(a.id)));
  res.json(perAccount.flat().map(toApiFolder));
});

// POST /folders — eigenen Ordner anlegen (is_system=false, system_key=null).
// accountId ist Pflicht, sobald der User mehr als ein Konto hat (siehe
// api-spec.yaml) -- bei genau einem Konto automatisch dieses.
foldersRouter.post("/folders", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "name ist erforderlich" });

  const icon =
    typeof req.body?.icon === "string" && req.body.icon.trim() ? req.body.icon.trim() : CUSTOM_FOLDER_DEFAULT_ICON;

  const requestedAccountId = typeof req.body?.accountId === "string" ? req.body.accountId : undefined;
  const ownAccounts = await store.listMailAccountsByUserId(req.userId);
  let accountId: string;
  if (requestedAccountId) {
    if (!ownAccounts.some((a) => a.id === requestedAccountId)) {
      return res.status(403).json({ error: "Mail-Konto gehört nicht zum angemeldeten User" });
    }
    accountId = requestedAccountId;
  } else if (ownAccounts.length === 1) {
    accountId = ownAccounts[0].id;
  } else {
    return res.status(400).json({ error: "accountId ist erforderlich (mehrere Konten verbunden)" });
  }

  // sort_order: ans Ende der bestehenden Liste DIESES Kontos anhängen (kein
  // sortOrder im Request-Body laut api-spec.yaml POST /folders — nur PATCH
  // erlaubt das).
  const sortOrder = (await store.listFolders(accountId)).length;

  const folder = await store.createFolder({
    mailAccountId: accountId,
    name,
    icon,
    isSystem: false,
    systemKey: null,
    sortOrder,
  });
  res.status(201).json(toApiFolder(folder));
});

// PATCH /folders/:folderId — umbenennen/Icon/Reihenfolge ändern
foldersRouter.patch("/folders/:folderId", async (req, res) => {
  const folder = await requireOwnFolder(req, res, req.params.folderId);
  if (!folder) return;

  const patch: { name?: string; icon?: string; sortOrder?: number } = {};

  if (req.body?.name !== undefined) {
    if (folder.isSystem && folder.systemKey && NOT_RENAMABLE.includes(folder.systemKey)) {
      return res.status(400).json({ error: `Systemordner '${folder.systemKey}' kann nicht umbenannt werden` });
    }
    if (typeof req.body.name !== "string" || !req.body.name.trim()) {
      return res.status(400).json({ error: "name darf nicht leer sein" });
    }
    patch.name = req.body.name.trim();
  }

  if (req.body?.icon !== undefined) {
    if (typeof req.body.icon !== "string" || !req.body.icon.trim()) {
      return res.status(400).json({ error: "icon darf nicht leer sein" });
    }
    patch.icon = req.body.icon.trim();
  }

  if (req.body?.sortOrder !== undefined) {
    if (typeof req.body.sortOrder !== "number") {
      return res.status(400).json({ error: "sortOrder muss eine Zahl sein" });
    }
    patch.sortOrder = req.body.sortOrder;
  }

  const updated = (await store.updateFolder(folder.id, patch))!;
  res.json(toApiFolder(updated));
});

// DELETE /folders/:folderId — eigenen Ordner löschen (System-Ordner nicht löschbar)
foldersRouter.delete("/folders/:folderId", async (req, res) => {
  const folder = await requireOwnFolder(req, res, req.params.folderId);
  if (!folder) return;

  if (folder.isSystem) {
    return res.status(400).json({ error: "Systemordner können nicht gelöscht werden" });
  }

  // Design-Entscheidung (nicht im Contract festgelegt, siehe SYNC.md/README):
  // messages.folder_id ist im Schema NOT NULL/FK, darf also nie ins Leere
  // zeigen. Nachrichten aus dem gelöschten Ordner werden deshalb vor dem
  // Löschen in den System-Ordner "sonstiges" DESSELBEN Kontos verschoben.
  const fallback = await store.getSystemFolder(folder.mailAccountId, "sonstiges");
  if (fallback) {
    for (const message of await store.listMessages({ folderId: folder.id })) {
      await store.moveMessage(message.id, fallback.id);
    }
  }

  await store.deleteFolder(folder.id);
  res.status(204).send();
});
