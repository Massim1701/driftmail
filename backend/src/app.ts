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
import { settingsRouter } from "./routes/settings";
import { contactsRouter } from "./routes/contacts";
import { signaturesRouter } from "./routes/signatures";
import { absenceResponderRouter } from "./routes/absenceResponder";
import { privacySettingsRouter } from "./routes/privacySettings";
import { breachesRouter } from "./routes/breaches";
import { linkCheckRouter } from "./routes/linkCheck";
import { internalRouter } from "./routes/internal";
import { requireAuth } from "./middleware/auth";

export function createApp() {
  const app = express();

  // [2026-09-23] Massimo: "mails sind nicht da", obwohl der Server sie
  // nachweislich gespeichert hatte und die App mit den RICHTIGEN IDs
  // gefragt hat. Das Zugriffs-Log zeigte: Express beantwortete praktisch
  // jede Anfrage der App mit "304 Not Modified" (ETag ist in Express
  // standardmaessig an) -- also OHNE Inhalt. Kommt eine 304 in der App an,
  // ist es keine 2xx-Antwort: ihre Fehlerbehandlung faengt das still ab und
  // setzt leere Listen (`catch { messages = [] }`), weshalb das Postfach
  // leer blieb, ohne dass irgendwo ein Fehler sichtbar wurde.
  //
  // Fuer eine Postfach-API ist diese Zwischenspeicherung ohnehin falsch:
  // der Client darf den Zustand einer Mailbox nie aus einem HTTP-Cache
  // bedienen, und die Antworten sind benutzerspezifisch (der URL-Cache
  // kennt den Authorization-Header nicht).
  app.set("etag", false);
  // Vor allem anderen (auch vor express.json()): OPTIONS-Preflights
  // brauchen keinen geparsten Body, und alle Antworten -- auch Fehler --
  // sollen die CORS-Header tragen (WEB_INBOX.md 21.09. "BUG").
  app.use(cors);
  app.use(express.json());

  // Zugriffs-Log: zeigt, was ein Client (iOS/Web) tatsaechlich anfragt und
  // mit welchem Status geantwortet wurde. Beim Geraete-Test am 23.09. war
  // genau das die fehlende Information -- der Server lieferte die Mails
  // nachweislich aus, die App zeigte trotzdem nichts, und ohne dieses Log
  // liess sich nicht unterscheiden, ob die App falsch fragt, gar nicht
  // fragt oder die Antwort verwirft. Per DISABLE_ACCESS_LOG=true abschaltbar.
  if (process.env.DISABLE_ACCESS_LOG !== "true") {
    app.use((req, res, next) => {
      const startedAt = Date.now();
      res.on("finish", () => {
        const query = Object.keys(req.query).length > 0 ? ` ${JSON.stringify(req.query)}` : "";
        const size = res.getHeader("content-length");
        console.log(
          `[http] ${req.method} ${req.path}${query} -> ${res.statusCode}${size ? ` ${size}B` : ""} (${Date.now() - startedAt}ms)`,
        );
      });
      next();
    });
  }

  // Ergaenzung zu `app.set("etag", false)` oben: ein Client (URLSession/
  // Browser) darf eine Postfach-Antwort auch nicht ohne Rueckfrage aus
  // seinem eigenen Cache bedienen. Ohne Cache-Control wendet URLSession
  // heuristische Frische an und kann eine veraltete Antwort ausliefern.
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

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
  // GET /link-check (WEB_INBOX.md 21.09. "ZWEI ENTERPRISE-SICHERHEITS-
  // FEATURES" Punkt 2): wird durch eine echte Browser-Navigation (Mail-
  // Link-Klick) aufgerufen, kein Bearer-Token vorhanden -- siehe
  // routes/linkCheck.ts Datei-Kopfkommentar.
  v1.use(linkCheckRouter);
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
  v1.use(settingsRouter);
  v1.use(contactsRouter);
  v1.use(signaturesRouter);
  v1.use(absenceResponderRouter);
  v1.use(privacySettingsRouter);
  v1.use(breachesRouter);
  app.use("/v1", v1);

  // Betriebs-/Test-Hilfsmittel, kein Contract-Bestandteil.
  app.use(internalRouter);

  app.use((req, res) => {
    res.status(404).json({ error: `unbekannte Route: ${req.method} ${req.path}` });
  });

  return app;
}
