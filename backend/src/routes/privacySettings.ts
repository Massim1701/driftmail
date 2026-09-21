// GET/PUT /privacy-settings (WEB_INBOX.md 21.09. "NEUE AUFTRAEGE - 5
// Wettbewerbs-Luecken" Punkt 1, "Tracking-Pixel-Blockierung"). Eigener
// Endpunkt statt in GET/PUT /settings gequetscht, gleiches Prinzip wie
// /ai-settings.
//
// WICHTIGE EINORDNUNG: driftmail rendert nirgends HTML-Mail-Inhalte und
// laedt nirgends automatisch entfernte Bilder -- Nachrichtentext ist
// durchgaengig Klartext (siehe mail/imapAdapter.ts/gmailAdapter.ts, die nur
// die "text/plain"-Variante extrahieren). Der klassische Tracking-Pixel-
// Angriffsweg (ein unsichtbares <img>, das beim automatischen Laden der
// HTML-Mail dem Absender IP/Oeffnungszeitpunkt meldet) kann in dieser
// Architektur schon strukturell nicht greifen. `blockRemoteImages` hat
// deshalb aktuell KEINE zusaetzliche technische Wirkung -- der Schalter
// existiert trotzdem echt (nicht nur ein Mock-Wert), fuer Transparenz und
// falls HTML-Rendering je nachgezogen wird, ohne dass die Einstellungen-UI
// nochmal angefasst werden muss.
//
// `blockTrackingLinks` hat ebenfalls noch keine technische Wirkung: eine
// echte Umsetzung braeuchte die Link-Extraktion aus message_links, die
// selbst noch nicht implementiert ist (siehe backend/README.md "Annahmen"
// -- separate, bereits vorher bekannte Luecke). Beide Grenzen sind in
// backend/README.md "Tracking-Schutz" ausfuehrlich dokumentiert.

import { Router } from "express";
import { store } from "../db/store";
import type { PrivacySettingsRecord } from "../types";

export const privacySettingsRouter = Router();

function toApiPrivacySettings(p: Pick<PrivacySettingsRecord, "blockRemoteImages" | "blockTrackingLinks">) {
  return { blockRemoteImages: p.blockRemoteImages, blockTrackingLinks: p.blockTrackingLinks };
}

const DEFAULTS: Pick<PrivacySettingsRecord, "blockRemoteImages" | "blockTrackingLinks"> = {
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
