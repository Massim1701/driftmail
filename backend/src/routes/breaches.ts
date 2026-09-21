// GET /security/breaches + PATCH /security/breaches/{breachId} (WEB_INBOX.md
// 21.09. "NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken" Punkt 3, "Darkweb-/
// Datenleck-Ueberwachung"). Der eigentliche Such-Vorgang selbst laeuft
// periodisch im Scheduler (siehe mail/scheduler.ts runDataBreachChecks()) --
// diese Route liefert nur die bereits gefundenen/gespeicherten Treffer +
// erlaubt, einen Treffer als gesehen zu markieren.

import { Router } from "express";
import { store } from "../db/store";
import type { ApiDataBreachFinding, DataBreachFindingRecord } from "../types";

export const breachesRouter = Router();

function toApiDataBreachFinding(f: DataBreachFindingRecord): ApiDataBreachFinding {
  return {
    id: f.id,
    accountId: f.mailAccountId,
    breachName: f.breachName,
    breachDate: f.breachDate,
    discoveredAt: f.discoveredAt,
    acknowledged: f.acknowledged,
  };
}

breachesRouter.get("/security/breaches", async (req, res) => {
  const findings = await store.listDataBreachFindingsForUser(req.userId);
  res.json(findings.map(toApiDataBreachFinding));
});

breachesRouter.patch("/security/breaches/:breachId", async (req, res) => {
  const finding = await store.getDataBreachFinding(req.params.breachId);
  if (!finding) return res.status(404).json({ error: "Treffer nicht gefunden" });

  const account = await store.getMailAccount(finding.mailAccountId);
  if (!account || account.userId !== req.userId) {
    return res.status(403).json({ error: "Treffer gehört nicht zum angemeldeten User" });
  }

  const body = req.body as { acknowledged?: boolean };
  if (typeof body.acknowledged !== "boolean") {
    return res.status(400).json({ error: "acknowledged (boolean) ist erforderlich" });
  }
  const updated = (await store.setDataBreachFindingAcknowledged(finding.id, body.acknowledged))!;
  res.json(toApiDataBreachFinding(updated));
});
