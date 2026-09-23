import "./loadEnv"; // muss vor jedem anderen Import stehen, siehe loadEnv.ts
import { createApp } from "./app";
import { ensureDemoUser, initStore, store } from "./db/store";
import { syncAccount } from "./mail/sync";
import { startPeriodicSync } from "./mail/scheduler";
import { aiAdapter } from "./ai";

const PORT = Number(process.env.PORT ?? 3000);

async function main() {
  // Echte Persistenz (Terminal 09.09.): initStore() migriert das Schema,
  // wenn DATABASE_URL gesetzt ist (siehe db/store.ts) -- muss VOR jedem
  // Store-Zugriff abgewartet werden, sonst schlagen die ersten Queries
  // gegen noch nicht existierende Tabellen fehl.
  await initStore();
  // Beim Start sichtbar machen, welcher Store aktiv ist: ein unbemerkt
  // laufender In-Memory-Store sah im Betrieb exakt wie ein funktionierender
  // Server aus, hat aber bei jedem Neustart Konten, Nachrichten und
  // Sitzungen verloren (siehe loadEnv.ts).
  console.log(
    process.env.DATABASE_URL
      ? `[startup] Persistenz: Postgres (${process.env.DATABASE_URL.replace(/:[^:@/]*@/, ":***@")})`
      : "[startup] Persistenz: In-Memory — ALLE Daten gehen bei jedem Neustart verloren. Fuer echten Betrieb DATABASE_URL in backend/.env setzen.",
  );
  const { user, account } = await ensureDemoUser();

  // [2026-09-10] echte Auth: seit requireAuth (middleware/auth.ts) auf allen
  // Contract-Routen verlangt jeder Request einen gültigen Bearer-Token --
  // ohne Login-UI in Web/iOS (noch offen, siehe backend/README.md "Auth")
  // gäbe es sonst keinen Weg, lokal überhaupt gegen die API zu testen. Der
  // hier ausgestellte Token gehört zu genau demselben Demo-User/-Konto wie
  // bisher, nur jetzt über eine echte Session statt implizit.
  const devSession = await store.createSession(user.id);
  console.log(`[startup] Demo-Session-Token (${account.emailAddress}): ${devSession.token}`);

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

  // Periodischer Mail-Abruf (WEB_INBOX.md 21.09. "SEHR WICHTIGE LUECKE"):
  // läuft für ALLE Konten über alle User hinweg, nicht nur den Demo-Account
  // oben -- siehe mail/scheduler.ts für die Architektur-Entscheidung.
  startPeriodicSync();

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
