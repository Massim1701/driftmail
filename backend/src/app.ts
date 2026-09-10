import express from "express";
import { accountsRouter } from "./routes/accounts";
import { foldersRouter } from "./routes/folders";
import { messagesRouter } from "./routes/messages";
import { contractsRouter } from "./routes/contracts";
import { capabilityRouter } from "./routes/capability";
import { attachmentsRouter } from "./routes/attachments";
import { internalRouter } from "./routes/internal";

export function createApp() {
  const app = express();
  app.use(express.json());

  // api-spec.yaml: servers[0].url = https://api.driftware.online/v1
  // -> alle Contract-Routen unter /v1 gemountet.
  const v1 = express.Router();
  v1.use(accountsRouter);
  v1.use(foldersRouter);
  v1.use(messagesRouter);
  v1.use(contractsRouter);
  v1.use(capabilityRouter);
  v1.use(attachmentsRouter);
  app.use("/v1", v1);

  // Betriebs-/Test-Hilfsmittel, kein Contract-Bestandteil.
  app.use(internalRouter);

  app.use((req, res) => {
    res.status(404).json({ error: `unbekannte Route: ${req.method} ${req.path}` });
  });

  return app;
}
