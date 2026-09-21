import express from "express";
import { cors } from "./middleware/cors";
import { accountsRouter } from "./routes/accounts";
import { authRouter } from "./routes/auth";
import { foldersRouter } from "./routes/folders";
import { messagesRouter } from "./routes/messages";
import { contractsRouter } from "./routes/contracts";
import { capabilityRouter } from "./routes/capability";
import { attachmentsRouter } from "./routes/attachments";
import { draftsRouter } from "./routes/drafts";
import { trustedSendersRouter } from "./routes/trustedSenders";
import { mailProvidersRouter } from "./routes/mailProviders";
import { aiSettingsRouter } from "./routes/aiSettings";
import { internalRouter } from "./routes/internal";
import { requireAuth } from "./middleware/auth";

export function createApp() {
  const app = express();
  // Vor allem anderen (auch vor express.json()): OPTIONS-Preflights
  // brauchen keinen geparsten Body, und alle Antworten -- auch Fehler --
  // sollen die CORS-Header tragen (WEB_INBOX.md 21.09. "BUG").
  app.use(cors);
  app.use(express.json());

  // api-spec.yaml: servers[0].url = https://api.driftware.online/v1
  // -> alle Contract-Routen unter /v1 gemountet.
  const v1 = express.Router();
  // [2026-09-10] echte Auth: authRouter (POST /accounts, POST /auth/session)
  // MUSS vor requireAuth gemountet werden -- das sind laut api-spec.yaml die
  // einzigen beiden Endpunkte mit `security: []` (man kann naturgemäß
  // keinen Token verlangen, um überhaupt einen zu bekommen). Alles danach
  // verlangt einen gültigen Bearer-Token.
  v1.use(authRouter);
  // GET /mail-providers (WEB_INBOX.md 15.09.): laeuft VOR dem Login (Onboarding-
  // Provider-Auswahl), deshalb wie authRouter vor requireAuth gemountet.
  v1.use(mailProvidersRouter);
  v1.use(requireAuth);
  v1.use(accountsRouter);
  v1.use(foldersRouter);
  v1.use(messagesRouter);
  v1.use(contractsRouter);
  v1.use(capabilityRouter);
  v1.use(attachmentsRouter);
  v1.use(draftsRouter);
  v1.use(trustedSendersRouter);
  v1.use(aiSettingsRouter);
  app.use("/v1", v1);

  // Betriebs-/Test-Hilfsmittel, kein Contract-Bestandteil.
  app.use(internalRouter);

  app.use((req, res) => {
    res.status(404).json({ error: `unbekannte Route: ${req.method} ${req.path}` });
  });

  return app;
}
