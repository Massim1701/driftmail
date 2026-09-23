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
import { dataBreachLookup } from "../lookups";
import { sendMessageForUser } from "./sendMessage";

const DEFAULT_INTERVAL_MINUTES = 3;
// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 3 ("Darkweb-/Datenleck-
// Ueberwachung"): ein Datenleck aendert sich nicht minuetlich -- taeglich
// reicht, siehe getLastDataBreachCheck()/recordDataBreachCheck().
const DATA_BREACH_CHECK_INTERVAL_MS = 24 * 3600 * 1000;

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
        // syncAccount() loggt selbst eine Zusammenfassung pro Durchlauf
        // (inkl. 0-Treffer) -- hier keine zweite Zeile mehr.
        await syncAccount(account, aiAdapter);
      } catch (err) {
        console.error(`[sync] Fehlgeschlagen fuer Konto ${account.emailAddress}:`, err);
      }
    }),
  );
}

/** [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 3 ("Darkweb-/Datenleck-
 * Ueberwachung"): prueft jedes Konto, dessen letzte Pruefung laenger als
 * DATA_BREACH_CHECK_INTERVAL_MS her ist (oder noch nie geprueft wurde).
 * Gleiches Muster wie runSyncForAllAccounts() -- unabhaengig pro Konto,
 * ein Fehlschlag blockiert die anderen nicht. */
export async function runDataBreachChecks(): Promise<void> {
  const accounts = await store.listMailAccounts();
  await Promise.allSettled(
    accounts.map(async (account) => {
      try {
        const lastChecked = await store.getLastDataBreachCheck(account.id);
        if (lastChecked && Date.now() - new Date(lastChecked).getTime() < DATA_BREACH_CHECK_INTERVAL_MS) return;

        const hits = await dataBreachLookup.check(account.emailAddress);
        for (const hit of hits) {
          await store.upsertDataBreachFinding({
            mailAccountId: account.id,
            breachName: hit.breachName,
            breachDate: hit.breachDate,
          });
        }
        await store.recordDataBreachCheck(account.id, new Date().toISOString());
        if (hits.length > 0) {
          console.log(`[breach-check] ${account.emailAddress}: ${hits.length} Datenleck-Treffer gefunden`);
        }
      } catch (err) {
        console.error(`[breach-check] Fehlgeschlagen fuer Konto ${account.emailAddress}:`, err);
      }
    }),
  );
}

/** [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 4 ("Schedule Send"): schickt
 * jeden faelligen geplanten Entwurf ueber denselben Versand-Kern wie ein
 * direkter Versand (siehe mail/sendMessage.ts). Schlaegt der Versand fehl
 * (z.B. Phishing-Check greift, Provider-Fehler), wird die Planung
 * aufgehoben (scheduledFor -> null) statt endlos erneut zu versuchen --
 * der Entwurf selbst bleibt erhalten, der User sieht ihn als normalen
 * Entwurf wieder und kann selbst entscheiden, wie es weitergeht. */
export async function runDueScheduledSends(): Promise<void> {
  const due = await store.listDraftsDueForSending();
  await Promise.allSettled(
    due.map(async (draft) => {
      try {
        const result = await sendMessageForUser(draft.userId, {
          to: draft.toAddresses,
          cc: draft.ccAddresses,
          bcc: draft.bccAddresses,
          subject: draft.subject,
          bodyText: draft.bodyText,
          accountId: draft.mailAccountId,
          draftId: draft.id,
        });
        if (!result.ok) {
          console.error(`[schedule-send] Entwurf ${draft.id} konnte nicht automatisch verschickt werden:`, result.body);
          await store.updateDraft(draft.id, { scheduledFor: null });
          return;
        }
        console.log(`[schedule-send] Entwurf ${draft.id} automatisch verschickt (sentMessageId ${result.sentMessageId})`);
      } catch (err) {
        console.error(`[schedule-send] Fehlgeschlagen fuer Entwurf ${draft.id}:`, err);
        await store.updateDraft(draft.id, { scheduledFor: null });
      }
    }),
  );
}

/** Startet den periodischen Sync (Intervall per `MAIL_SYNC_INTERVAL_MINUTES`
 * konfigurierbar, Default 3 Minuten -- im vom Auftrag vorgeschlagenen
 * 2-5-Minuten-Rahmen). Gibt den Timer zurueck, falls ein Aufrufer ihn je
 * stoppen muss (z.B. in Tests) -- `index.ts` selbst tut das nicht, laeuft
 * fuer die Lebensdauer des Prozesses. Nutzt denselben Tick auch fuer die
 * Datenleck-Pruefung + faellige geplante Sends (beide haben ihre eigene
 * "nur wenn faellig"-Logik, ein haeufigerer Tick als noetig ist harmlos). */
export function startPeriodicSync(): ReturnType<typeof setInterval> {
  const ms = intervalMinutes() * 60_000;
  return setInterval(() => {
    void runSyncForAllAccounts();
    void runDataBreachChecks();
    void runDueScheduledSends();
  }, ms);
}
