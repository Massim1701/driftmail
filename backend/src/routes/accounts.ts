import { Router } from "express";
import { store } from "../db/store";
import { toApiMailAccount } from "../mappers";

export const accountsRouter = Router();

// GET /accounts — siehe api-spec.yaml. [2026-09-10] echte Auth: nur die
// Konten des angemeldeten Users (req.userId, von requireAuth aufgelöst) --
// vorher lieferte das ungefiltert ALLE mail_accounts über alle User hinweg,
// weil es bis dahin ohnehin nur den einen Demo-User gab.
accountsRouter.get("/accounts", async (req, res) => {
  const accounts = (await store.listMailAccounts()).filter((a) => a.userId === req.userId);
  res.json(accounts.map(toApiMailAccount));
});
