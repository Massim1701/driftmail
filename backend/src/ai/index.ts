import { MockAiAdapter } from "./mockAdapter";
import { CloudAiAdapter } from "./cloudAdapter";
import type { AiAdapter, AiSource } from "./types";
import { store } from "../db/store";
import { decryptCredentials } from "../auth/credentialsEncryption";

// Einziger heuristischer AI-Adapter dieses Skeletons -- bleibt der Standard-
// Fallback UND der Adapter fuer den Sync-Pfad (syncAccount() in mail/sync.ts,
// siehe backend/README.md "bewusste Grenze": der Hintergrund-Sync bekommt
// KEIN Per-User-BYOK-Upgrade, das waere zusaetzliche Async-Lookups fuer
// jeden einzelnen Sync-Tick jedes Kontos, unverhaeltnismaessig zum Nutzen).
export const aiAdapter: AiAdapter = new MockAiAdapter();

// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09., ersetzt WEB_INBOX.md
// "ECHTE KI-ANBINDUNG" c3ec563): pro-User-Adapterwahl fuer die beiden
// on-demand KI-Aktionen (GET /messages/{id}/summary, POST
// /messages/{id}/reply-draft, siehe routes/messages.ts).
//
// BYOK-Cloud NUR wenn mode='byok' UND ein Key hinterlegt UND Consent erteilt
// ist -- sonst IMMER der heuristische Singleton. Nie automatisch On-Device:
// das Backend kennt gar keinen On-Device-Pfad, ein Client mit
// On-Device-Faehigkeit ruft diese Endpunkte fuer die drei betroffenen
// Funktionen im Idealfall erst gar nicht auf (siehe contracts/
// ai-adapter-interface.ts AiSource-Kommentar + iOS/Web-READMEs).
export async function getAiAdapterForUser(userId: string): Promise<{ adapter: AiAdapter; source: AiSource }> {
  const preference = await store.getAiPreference(userId);
  const provider = preference?.byokProvider;
  const canUseCloud =
    preference?.mode === "byok" &&
    !!preference.encryptedApiKey &&
    !!preference.cloudConsentGivenAt &&
    (provider === "anthropic" || provider === "openai");

  if (canUseCloud && preference?.encryptedApiKey) {
    const apiKey = decryptCredentials(preference.encryptedApiKey);
    return {
      adapter: new CloudAiAdapter({ provider: provider as "anthropic" | "openai", apiKey }),
      source: "cloud_fallback",
    };
  }
  return { adapter: aiAdapter, source: "heuristic" };
}

// Fuehrt eine der beiden on-demand KI-Aktionen mit graceful Fallback aus:
// schlaegt der echte BYOK-Cloud-Call fehl (falscher/abgelaufener Key,
// Netzwerk, Rate-Limit, unerwartete Antwortform), faellt die Funktion
// automatisch auf den heuristischen Adapter zurueck statt eines 500ers --
// eine BYOK-Fehlkonfiguration soll eine KI-Aktion nie kaputtmachen, nur
// schlechter machen. Der Fehlschlag selbst wird geloggt (Server-Konsole),
// nicht dem User als Fehler angezeigt. `source` im Rueckgabewert spiegelt
// IMMER, was tatsaechlich passiert ist (nie das, was eigentlich versucht war).
export async function runAiTask<T>(
  userId: string,
  task: (adapter: AiAdapter) => Promise<T>,
): Promise<{ result: T; source: AiSource }> {
  const { adapter, source } = await getAiAdapterForUser(userId);
  if (source !== "cloud_fallback") {
    return { result: await task(adapter), source };
  }
  try {
    return { result: await task(adapter), source };
  } catch (err) {
    console.error("[ai] BYOK-Cloud-Aufruf fehlgeschlagen, falle auf Heuristik zurueck:", err);
    return { result: await task(aiAdapter), source: "heuristic" };
  }
}
