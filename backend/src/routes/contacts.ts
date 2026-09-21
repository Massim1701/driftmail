// GET /contacts (WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES", Punkt 2
// "Kontakt-Autovervollstaendigung beim Verfassen") -- einfache Ableitung aus
// bisherigen From-/An-Adressen des Users, kein eigenes Kontakte-Feature noetig
// (siehe store.listKnownContactAddresses()).

import { Router } from "express";
import { store } from "../db/store";

export const contactsRouter = Router();

contactsRouter.get("/contacts", async (req, res) => {
  res.json(await store.listKnownContactAddresses(req.userId));
});
