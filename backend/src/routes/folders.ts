// Ordner-Endpunkte — neu durch die Contract-Änderung "benutzerdefinierte
// Ordner statt festem Enum" (SYNC.md, Commit 734781e). Siehe api-spec.yaml
// /folders, /folders/{folderId}.

import { Router } from "express";
import { store, ensureDemoUser } from "../db/store";
import { toApiFolder } from "../mappers";
import type { SystemFolderKey } from "../types";

export const foldersRouter = Router();

// quarantaene/spam/papierkorb sind laut design-tokens.json
// (systemFolders.defaults, renamable: false) nicht umbenennbar — API lehnt
// PATCH auf `name` für diese drei mit 400 ab.
const NOT_RENAMABLE: SystemFolderKey[] = ["quarantaene", "spam", "papierkorb"];

// design-tokens.json: customFolder.defaultIcon
const CUSTOM_FOLDER_DEFAULT_ICON = "folder";

// GET /folders — siehe api-spec.yaml
foldersRouter.get("/folders", (_req, res) => {
  const { user } = ensureDemoUser();
  res.json(store.listFolders(user.id).map(toApiFolder));
});

// POST /folders — eigenen Ordner anlegen (is_system=false, system_key=null)
foldersRouter.post("/folders", (req, res) => {
  const { user } = ensureDemoUser();

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "name ist erforderlich" });

  const icon =
    typeof req.body?.icon === "string" && req.body.icon.trim() ? req.body.icon.trim() : CUSTOM_FOLDER_DEFAULT_ICON;

  // sort_order: ans Ende der bestehenden Liste anhängen (kein sortOrder im
  // Request-Body laut api-spec.yaml POST /folders — nur PATCH erlaubt das).
  const sortOrder = store.listFolders(user.id).length;

  const folder = store.createFolder({
    userId: user.id,
    name,
    icon,
    isSystem: false,
    systemKey: null,
    sortOrder,
  });
  res.status(201).json(toApiFolder(folder));
});

// PATCH /folders/:folderId — umbenennen/Icon/Reihenfolge ändern
foldersRouter.patch("/folders/:folderId", (req, res) => {
  const folder = store.getFolder(req.params.folderId);
  if (!folder) return res.status(404).json({ error: "Ordner nicht gefunden" });

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

  const updated = store.updateFolder(folder.id, patch)!;
  res.json(toApiFolder(updated));
});

// DELETE /folders/:folderId — eigenen Ordner löschen (System-Ordner nicht löschbar)
foldersRouter.delete("/folders/:folderId", (req, res) => {
  const folder = store.getFolder(req.params.folderId);
  if (!folder) return res.status(404).json({ error: "Ordner nicht gefunden" });

  if (folder.isSystem) {
    return res.status(400).json({ error: "Systemordner können nicht gelöscht werden" });
  }

  // Design-Entscheidung (nicht im Contract festgelegt, siehe SYNC.md/README):
  // messages.folder_id ist im Schema NOT NULL/FK, darf also nie ins Leere
  // zeigen. Nachrichten aus dem gelöschten Ordner werden deshalb vor dem
  // Löschen in den System-Ordner "sonstiges" verschoben.
  const fallback = store.getSystemFolder(folder.userId, "sonstiges");
  if (fallback) {
    for (const message of store.listMessages({ folderId: folder.id })) {
      store.moveMessage(message.id, fallback.id);
    }
  }

  store.deleteFolder(folder.id);
  res.status(204).send();
});
