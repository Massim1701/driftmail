// GET/PUT /settings (WEB_INBOX.md 21.09. "NEUER AUFTRAG - Einstellungsbereich
// + Info-Seite", Punkt 1 "Ansicht"; erweitert um strictUnknownSenders in
// "FUENF NEUE KOMFORT-FEATURES" Punkt 1): allgemeine UI-Präferenzen des
// Users -- eigener, erweiterbarer Endpunkt statt in ein bestehendes Objekt
// gequetscht, gleiches Prinzip wie /ai-settings.

import { Router } from "express";
import { store } from "../db/store";
import type { AccentTheme, User } from "../types";

export const settingsRouter = Router();

const VALID_ACCENT_THEMES: AccentTheme[] = ["teal", "ocean_blue", "violett", "koralle", "ocean_verlauf"];

function toApiSettings(user: Pick<User, "accentTheme" | "strictUnknownSenders">) {
  return { accentTheme: user.accentTheme, strictUnknownSenders: user.strictUnknownSenders };
}

settingsRouter.get("/settings", async (req, res) => {
  const user = await store.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: "User nicht gefunden" });
  res.json(toApiSettings(user));
});

settingsRouter.put("/settings", async (req, res) => {
  const body = req.body as { accentTheme?: AccentTheme; strictUnknownSenders?: boolean };
  if (body.accentTheme !== undefined && !VALID_ACCENT_THEMES.includes(body.accentTheme)) {
    return res.status(400).json({ error: `accentTheme muss eines von ${VALID_ACCENT_THEMES.join(", ")} sein` });
  }
  if (body.accentTheme === undefined && body.strictUnknownSenders === undefined) {
    const user = await store.getUserById(req.userId);
    if (!user) return res.status(404).json({ error: "User nicht gefunden" });
    return res.json(toApiSettings(user));
  }
  const updated = await store.updateUserSettings(req.userId, {
    accentTheme: body.accentTheme,
    strictUnknownSenders: body.strictUnknownSenders,
  });
  if (!updated) return res.status(404).json({ error: "User nicht gefunden" });
  res.json(toApiSettings(updated));
});
