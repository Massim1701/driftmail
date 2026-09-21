// GET/PUT /privacy-settings (WEB_INBOX.md 21.09. "NEUE AUFTRAEGE - 5
// Wettbewerbs-Luecken" Punkt 1, "Tracking-Pixel-Blockierung"). Eigener
// Endpunkt statt in GET/PUT /settings gequetscht, gleiches Prinzip wie
// /ai-settings.
//
// [2026-09-21 UPDATE, "NEUE GRUNDLAGE - HTML-Rendering des Mail-Bodies"]:
// die folgende Einordnung war bis hierhin korrekt, gilt jetzt NICHT mehr --
// driftmail rendert HTML-Mail-Inhalte jetzt wirklich (siehe
// mail/htmlSanitize.ts, angewendet in routes/messages.ts GET /messages/:id).
// `blockRemoteImages` hat dadurch eine ECHTE Wirkung: bei `true` entfernt
// der Sanitizer jedes `<img src="http(s)://...">` (u.a. der klassische
// Tracking-Pixel), bevor die Mail den Client erreicht.
//
// `blockTrackingLinks` bleibt weiterhin NUR gespeichert, ohne eigene
// Wirkung -- zu unterscheiden von der UNABHAENGIGEN "Klick-Zeit-Link-
// Pruefung" (GET /link-check, siehe routes/linkCheck.ts): die schreibt
// JEDEN http(s)-Link in einer HTML-Mail um, unabhaengig von diesem Schalter
// (Sicherheitsfeature, kein Marketing-Tracking-Filter). Eine echte
// Umsetzung DIESES Schalters braeuchte eine eigene Erkennung "ist dieser
// Link ein Marketing-/Analytics-Tracking-Redirect" (z.B. bekannte
// Tracking-Domains/Redirect-Muster) -- message_links (jetzt befuellt,
// siehe mail/sync.ts) liefert dafuer noch kein passendes Signal
// (domainMatchesDisplay/isKnownMalicious sind Phishing-, keine
// Tracking-Signale). Separate, weiterhin offene Luecke.

import { Router } from "express";
import { store } from "../db/store";
import type { PrivacySettingsRecord } from "../types";

export const privacySettingsRouter = Router();

function toApiPrivacySettings(p: Pick<PrivacySettingsRecord, "blockRemoteImages" | "blockTrackingLinks">) {
  return { blockRemoteImages: p.blockRemoteImages, blockTrackingLinks: p.blockTrackingLinks };
}

// Exportiert (statt privat), damit routes/messages.ts denselben Default
// verwenden kann, wenn ein User noch keine eigenen privacySettings
// gespeichert hat -- ein Reader mit Standard-Default soll dieselbe
// Bild-Blockierung sehen wie GET /privacy-settings ihm meldet.
export const DEFAULTS: Pick<PrivacySettingsRecord, "blockRemoteImages" | "blockTrackingLinks"> = {
  blockRemoteImages: true,
  blockTrackingLinks: true,
};

privacySettingsRouter.get("/privacy-settings", async (req, res) => {
  const existing = await store.getPrivacySettings(req.userId);
  res.json(toApiPrivacySettings(existing ?? DEFAULTS));
});

privacySettingsRouter.put("/privacy-settings", async (req, res) => {
  const body = req.body as { blockRemoteImages?: boolean; blockTrackingLinks?: boolean };
  const updated = await store.setPrivacySettings(req.userId, {
    blockRemoteImages: body.blockRemoteImages,
    blockTrackingLinks: body.blockTrackingLinks,
  });
  res.json(toApiPrivacySettings(updated));
});
