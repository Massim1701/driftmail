// GET/PUT /settings (WEB_INBOX.md 21.09. "NEUER AUFTRAG - Einstellungsbereich
// + Info-Seite", Punkt 1 "Ansicht"): allgemeine UI-Präferenzen des Users.
// Aktuell nur accentTheme -- eigener, erweiterbarer Endpunkt statt in ein
// bestehendes Objekt gequetscht, gleiches Prinzip wie /ai-settings.

import { Router } from "express";
import { store } from "../db/store";
import type { AccentTheme } from "../types";

export const settingsRouter = Router();

const VALID_ACCENT_THEMES: AccentTheme[] = ["teal", "ocean_blue", "violett", "koralle", "ocean_verlauf"];

settingsRouter.get("/settings", async (req, res) => {
  const user = await store.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: "User nicht gefunden" });
  res.json({ accentTheme: user.accentTheme });
});

settingsRouter.put("/settings", async (req, res) => {
  const body = req.body as { accentTheme?: AccentTheme };
  if (body.accentTheme !== undefined && !VALID_ACCENT_THEMES.includes(body.accentTheme)) {
    return res.status(400).json({ error: `accentTheme muss eines von ${VALID_ACCENT_THEMES.join(", ")} sein` });
  }
  if (body.accentTheme === undefined) {
    const user = await store.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User nicht gefunden" });
    return res.json({ accentTheme: user.accentTheme });
  }
  const updated = await store.updateUserAccentTheme(req.userId, body.accentTheme);
  if (!updated) return res.status(404).json({ error: "User nicht gefunden" });
  res.json({ accentTheme: updated.accentTheme });
});
