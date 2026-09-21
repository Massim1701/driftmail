// GET/PUT /absence-responder — siehe api-spec.yaml. WEB_INBOX.md 21.09.
// "NEUER AUFTRAG - Abwesenheitsassistent". Die eigentliche Auslöse-Logik
// (wer bekommt wann eine automatische Antwort) läuft in mail/sync.ts /
// mail/absenceResponder.ts, nicht hier -- diese Route ist nur die
// Einstellungs-Verwaltung.

import { Router } from "express";
import { store } from "../db/store";
import { toApiAbsenceResponder } from "../mappers";

export const absenceResponderRouter = Router();

absenceResponderRouter.get("/absence-responder", async (req, res) => {
  const existing = await store.getAbsenceResponder(req.userId);
  res.json(existing ? toApiAbsenceResponder(existing) : { active: false, startDate: null, endDate: null, subject: null, body: null });
});

absenceResponderRouter.put("/absence-responder", async (req, res) => {
  const body = req.body as {
    active?: boolean;
    startDate?: string | null;
    endDate?: string | null;
    subject?: string | null;
    body?: string | null;
  };

  const existing = await store.getAbsenceResponder(req.userId);
  const resultingActive = body.active ?? existing?.active ?? false;

  if (resultingActive) {
    const startDate = body.startDate !== undefined ? body.startDate : (existing?.startDate ?? null);
    const subject = body.subject !== undefined ? body.subject : (existing?.subject ?? null);
    const messageBody = body.body !== undefined ? body.body : (existing?.body ?? null);
    if (!startDate || !subject?.trim() || !messageBody?.trim()) {
      return res.status(400).json({ error: "active=true verlangt startDate, subject und body" });
    }
  }

  const updated = await store.setAbsenceResponder(req.userId, {
    active: body.active,
    startDate: body.startDate,
    endDate: body.endDate,
    subject: body.subject,
    body: body.body,
  });
  res.json(toApiAbsenceResponder(updated));
});
