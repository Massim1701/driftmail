import { Router } from "express";
import { store } from "../db/store";
import { toApiContract } from "../mappers";

export const contractsRouter = Router();

// GET /contracts — siehe api-spec.yaml
contractsRouter.get("/contracts", (_req, res) => {
  res.json(store.listContracts().map(toApiContract));
});

// POST /contracts/:contractId/confirm — siehe api-spec.yaml
// Nimmt vom User bestätigte/korrigierte Vertragsdaten entgegen und setzt
// status auf "active" (Review abgeschlossen).
contractsRouter.post("/contracts/:contractId/confirm", (req, res) => {
  const contract = store.getContract(req.params.contractId);
  if (!contract) return res.status(404).json({ error: "contract nicht gefunden" });

  const body = req.body ?? {};
  if (typeof body.providerName === "string") contract.providerName = body.providerName;
  if (body.contractStart !== undefined) contract.contractStart = body.contractStart;
  if (body.contractEnd !== undefined) contract.contractEnd = body.contractEnd;
  if (body.cancellationDeadline !== undefined) contract.cancellationDeadline = body.cancellationDeadline;
  if (body.cancellationPeriodDays !== undefined) contract.cancellationPeriodDays = body.cancellationPeriodDays;
  contract.status = "active";

  res.json(toApiContract(contract));
});
