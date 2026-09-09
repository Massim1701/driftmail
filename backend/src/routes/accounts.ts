import { Router } from "express";
import { store } from "../db/store";
import { toApiMailAccount } from "../mappers";

export const accountsRouter = Router();

// GET /accounts — siehe api-spec.yaml
accountsRouter.get("/accounts", async (_req, res) => {
  res.json((await store.listMailAccounts()).map(toApiMailAccount));
});
