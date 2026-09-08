import { createApp } from "./app";
import { ensureDemoUser } from "./db/store";
import { syncAccount } from "./mail/sync";
import { aiAdapter } from "./ai";

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  const { account } = ensureDemoUser();

  // Initialer Sync beim Start, damit GET /v1/messages sofort Daten liefert
  // (Fixture-Adapter, solange keine echten Zugangsdaten konfiguriert sind).
  try {
    const { imported, autoDeleted } = await syncAccount(account, aiAdapter);
    console.log(
      `[startup] Initialer Sync: ${imported} Nachricht(en) importiert, ${autoDeleted} automatisch geloescht (adult/gambling-Spam) (Konto ${account.emailAddress}).`,
    );
  } catch (err) {
    console.error("[startup] Initialer Sync fehlgeschlagen:", err);
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`driftmail-backend läuft auf http://localhost:${PORT}`);
    console.log(`API-Basis (Contract): http://localhost:${PORT}/v1`);
    console.log(`Health: http://localhost:${PORT}/health`);
  });
}

main().catch((err) => {
  console.error("Startfehler:", err);
  process.exit(1);
});
