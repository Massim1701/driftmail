// Laedt backend/.env in process.env.
//
// [2026-09-23] Massimo: "ich muss staendig meine Mail-Adresse eingeben".
// Ursache war NICHT die App, sondern dieses Backend: `npm run dev` startet
// `tsx watch`, und weder tsx noch Node lesen von sich aus eine .env-Datei
// (kein dotenv-Paket, kein --env-file im Skript). `DATABASE_URL` aus
// backend/.env kam damit nie an -- der Server lief trotz eingerichteter
// Postgres-DB immer im In-Memory-Store. Jede Code-Aenderung loeste einen
// tsx-watch-Neustart aus, der Konten, Nachrichten UND Sitzungstoken
// geloescht hat: die App war danach abgemeldet und das Postfach leer.
//
// Muss der ALLERERSTE Import jedes Einstiegspunkts sein: db/store.ts
// entscheidet schon beim Laden des Moduls (`export const store =
// createStore()`) anhand von DATABASE_URL zwischen Postgres und In-Memory.
// Ein spaeter geladenes .env kaeme zu spaet.
import path from "node:path";

const envPath = path.resolve(__dirname, "../.env");

// Bereits gesetzte Variablen haben Vorrang vor der Datei (z.B.
// `DATABASE_URL=... npm run dev` oder Werte aus der Deploy-Umgebung) --
// process.loadEnvFile() ueberschreibt sonst stillschweigend.
const explicitlySet = { ...process.env };

try {
  process.loadEnvFile(envPath);
  for (const [key, value] of Object.entries(explicitlySet)) {
    if (value !== undefined) process.env[key] = value;
  }
} catch {
  // Keine .env vorhanden: bewusst unterstuetzter Zero-Config-Fall
  // (In-Memory-Store + Fixture-Mails, siehe .env.example und README.md).
}
