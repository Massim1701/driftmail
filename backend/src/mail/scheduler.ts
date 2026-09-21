// Periodischer Mail-Abruf (WEB_INBOX.md 21.09. "SEHR WICHTIGE LUECKE -
// HOECHSTE PRIORITAET": es gab bisher NUR den einmaligen Sync beim ersten
// Verbinden eines Kontos, siehe index.ts -- danach passierte nie wieder
// etwas automatisch, egal wie viele neue Mails eintrafen).
//
// Architektur-Entscheidung: klassisches Polling (Intervall-Timer, jedes
// Konto unabhaengig per Promise.allSettled -- ein langsames/fehlerhaftes
// Konto blockiert die anderen nicht, siehe Auftrag). `syncAccount()`
// selbst ist bereits dedupe-sicher (`store.findMessageByHeader()`/
// `wasAutoDeleted()`), wiederholtes Aufrufen fuer dasselbe Konto ist damit
// von Haus aus sicher -- kein neuer State hier noetig.
//
// IMAP-IDLE-Vormerkung (im Auftrag ausdruecklich als spaetere Ausbaustufe
// erwaehnt): dieser Scheduler ruft nur `syncAccount()` in Intervallen auf,
// genau dieselbe Funktion, die auch der manuelle Sync-Endpunkt und der
// initiale Sync beim Verbinden nutzen. Ein spaeterer IDLE-Adapter muesste
// nur den Trigger ersetzen (Server-Push statt Timer), nicht `syncAccount()`
// selbst -- die eigentliche Sync-Logik ist bereits vom Ausloese-Mechanismus
// entkoppelt.
//
// Bekannte Grenze (nicht Teil dieses Schritts, siehe `mail/imapAdapter.ts`
// `fetchRecentMessages()`): der IMAP-Adapter holt bei jedem Aufruf die
// LETZTEN `limit` (Default 20) Nachrichten der Mailbox, kein "seit
// Zeitpunkt X"-Cursor. Treffen zwischen zwei Polling-Durchlaeufen mehr als
// `limit` neue Mails ein, werden die aeltesten davon nie importiert (fallen
// aus dem Fenster, bevor sie je abgerufen wurden). Bei einem
// 2-5-Minuten-Intervall fuer private/kleine Business-Postfaecher ein sehr
// seltener Randfall, aber ehrlich benannt statt stillschweigend
// hingenommen -- ein cursor-/UID-basierter Abruf waere die naechste
// Ausbaustufe, wenn das in der Praxis relevant wird.

import { store } from "../db/store";
import { syncAccount } from "./sync";
import { aiAdapter } from "../ai";

const DEFAULT_INTERVAL_MINUTES = 3;

function intervalMinutes(): number {
  const raw = Number(process.env.MAIL_SYNC_INTERVAL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_INTERVAL_MINUTES;
}

/** Synct alle verbundenen Konten (ueber alle User hinweg) einmal, unabhaengig
 * voneinander. Vom periodischen Timer UND direkt wiederverwendbar (z.B. fuer
 * Tests) -- kein eigener State, siehe Datei-Kopfkommentar. */
export async function runSyncForAllAccounts(): Promise<void> {
  const accounts = await store.listMailAccounts();
  await Promise.allSettled(
    accounts.map(async (account) => {
      try {
        const { imported, autoDeleted } = await syncAccount(account, aiAdapter);
        if (imported > 0 || autoDeleted > 0) {
          console.log(`[sync] ${account.emailAddress}: ${imported} importiert, ${autoDeleted} automatisch geloescht`);
        }
      } catch (err) {
        console.error(`[sync] Fehlgeschlagen fuer Konto ${account.emailAddress}:`, err);
      }
    }),
  );
}

/** Startet den periodischen Sync (Intervall per `MAIL_SYNC_INTERVAL_MINUTES`
 * konfigurierbar, Default 3 Minuten -- im vom Auftrag vorgeschlagenen
 * 2-5-Minuten-Rahmen). Gibt den Timer zurueck, falls ein Aufrufer ihn je
 * stoppen muss (z.B. in Tests) -- `index.ts` selbst tut das nicht, laeuft
 * fuer die Lebensdauer des Prozesses. */
export function startPeriodicSync(): ReturnType<typeof setInterval> {
  const ms = intervalMinutes() * 60_000;
  return setInterval(() => {
    void runSyncForAllAccounts();
  }, ms);
}
