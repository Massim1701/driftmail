import { Router } from "express";
import { store } from "../db/store";
import { toApiContract } from "../mappers";

export const contractsRouter = Router();

// GET /contracts — siehe api-spec.yaml
contractsRouter.get("/contracts", async (_req, res) => {
  res.json((await store.listContracts()).map(toApiContract));
});

// POST /contracts/:contractId/confirm — siehe api-spec.yaml
// Nimmt vom User bestätigte/korrigierte Vertragsdaten entgegen und setzt
// status auf "active" (Review abgeschlossen).
contractsRouter.post("/contracts/:contractId/confirm", async (req, res) => {
  const existing = await store.getContract(req.params.contractId);
  if (!existing) return res.status(404).json({ error: "contract nicht gefunden" });

  // Echte Persistenz (Terminal 09.09.): vorher wurde das von getContract()
  // zurückgegebene Objekt direkt mutiert -- funktionierte nur, weil
  // InMemoryStore dieselbe Objektreferenz wie im Store-Array zurückgab.
  // Mit einer echten DB liefert jede Query eine frische Kopie, die
  // Mutation hätte also nirgendwo persistiert. updateContract() macht das
  // jetzt über beide Store-Implementierungen hinweg explizit.
  const body = req.body ?? {};
  const contract = await store.updateContract(existing.id, {
    providerName: typeof body.providerName === "string" ? body.providerName : undefined,
    contractStart: body.contractStart !== undefined ? body.contractStart : undefined,
    contractEnd: body.contractEnd !== undefined ? body.contractEnd : undefined,
    cancellationDeadline: body.cancellationDeadline !== undefined ? body.cancellationDeadline : undefined,
    cancellationPeriodDays: body.cancellationPeriodDays !== undefined ? body.cancellationPeriodDays : undefined,
    status: "active",
  });

  res.json(toApiContract(contract!));
});
