import { Router } from "express";
import { store } from "../db/store";
import { toApiMailAccount } from "../mappers";

export const accountsRouter = Router();

// GET /accounts — siehe api-spec.yaml
accountsRouter.get("/accounts", (_req, res) => {
  res.json(store.listMailAccounts().map(toApiMailAccount));
});
