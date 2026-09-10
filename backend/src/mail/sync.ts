// Sync-Pipeline: Mail-Adapter -> Store, inkl. Security-Analyse (Mock-KI),
// automatischer Quarantäne bei classification === "phishing" und
// Auto-Delete bei classification === "spam" mit spamSubcategory
// "adult"/"gambling" (siehe WEB_INBOX.md 08.09. / SYNC.md).
//
// In diesem ersten Durchstich wird pro mail_account synchron beim
// Serverstart und über POST /internal/sync (siehe routes) synchronisiert.
// Ein echter Hintergrund-Job/Webhook (Gmail Push, IMAP IDLE) ist bewusst
// nicht Teil dieses Skeletons — siehe README "Annahmen".

import type { MailAccountRecord, SystemFolderKey } from "../types";
import type { MailAdapter } from "./types";
import { FixtureMailAdapter } from "./fixtureAdapter";
import { GmailAdapter } from "./gmailAdapter";
import { ImapAdapter } from "./imapAdapter";
import { store } from "../db/store";
import type { AiAdapter } from "../ai/types";
import {
  domainFromAddress,
  domainReputationLookup,
  extractIbanCandidates,
  extractSendingIp,
  ibanHistoryCheck,
  ipReputationLookup,
} from "../lookups";

/** Wählt den passenden Adapter für ein Konto. Fällt auf den Fixture-Adapter
 * zurück, wenn keine echten Zugangsdaten via Env konfiguriert sind. */
export function adapterForAccount(account: MailAccountRecord): MailAdapter {
  if (account.provider === "gmail") {
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    if (clientId && clientSecret && refreshToken) {
      return new GmailAdapter({ clientId, clientSecret, refreshToken });
    }
  }
  if (account.provider === "imap") {
    const host = process.env.IMAP_HOST;
    const user = process.env.IMAP_USER;
    const password = process.env.IMAP_PASSWORD;
    if (host && user && password) {
      return new ImapAdapter({
        host,
        port: Number(process.env.IMAP_PORT ?? 993),
        secure: process.env.IMAP_SECURE !== "false",
        user,
        password,
        // SMTP (Versand, WEB_INBOX.md 09.09.) faellt mangels eigener
        // Env-Vars auf den IMAP-Host + den ueblichen SMTP-Submission-Port
        // 587 (STARTTLS, nicht implizites TLS) zurueck -- funktioniert bei
        // Providern mit demselben Mailserver fuer IMAP/SMTP (haeufigster
        // Fall bei generischem Hosting), aber nicht garantiert korrekt.
        // Fuer den ersten Durchstich dokumentiert statt geraten: bei Bedarf
        // per SMTP_HOST/SMTP_PORT/SMTP_SECURE ueberschreibbar.
        smtpHost: process.env.SMTP_HOST ?? host,
        smtpPort: Number(process.env.SMTP_PORT ?? 587),
        smtpSecure: process.env.SMTP_SECURE === "true",
      });
    }
  }
  return new FixtureMailAdapter();
}

/** Ermittelt die Ziel-Ordner-ID für eine frisch importierte Nachricht anhand
 * der Mock-Klassifikation. Löst gegen die System-Ordner des Kontobesitzers
 * auf (folders.system_key, siehe ensureDemoUser) statt gegen einen festen
 * Enum-String — Contract-Änderung, siehe SYNC.md Commit 734781e.
 * [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09.): normale Mail landet jetzt
 * in "eingang" (echte automatische Landezone) statt "sonstiges" (nur noch
 * manuell nutzbar, keine Auto-Zuordnung mehr). */
async function resolveFolderId(classification: string, userId: string): Promise<string> {
  const key: SystemFolderKey = classification === "phishing" || classification === "spam" ? "spam" : "eingang";
  const folder = await store.getSystemFolder(userId, key);
  if (!folder) {
    throw new Error(
      `Systemordner '${key}' fehlt für User ${userId} — ensureDemoUser() muss vor dem ersten Sync gelaufen sein.`,
    );
  }
  return folder.id;
}

export async function syncAccount(account: MailAccountRecord, ai: AiAdapter, limit = 20): Promise<{ imported: number; autoDeleted: number }> {
  const adapter = adapterForAccount(account);
  // Echte Persistenz (Terminal 09.09.): `account.syncStatus` wird weiterhin
  // lokal mutiert, DAMIT die aufrufenden Routen (routes/internal.ts) den
  // aktuellen Wert direkt aus demselben Objekt lesen können, ohne erneut
  // zu queryen -- zusätzlich über store.updateMailAccount() persistiert,
  // sonst wäre der Status nach einem Neustart wieder "pending" (bei
  // PostgresStore) bzw. schlicht falsch (bei einer zweiten Objektreferenz).
  account.syncStatus = "syncing";
  await store.updateMailAccount(account.id, { syncStatus: "syncing" });

  let imported = 0;
  let autoDeleted = 0;
  try {
    const fetched = await adapter.fetchRecentMessages(limit);

    for (const mail of fetched) {
      if (await store.findMessageByHeader(account.id, mail.messageIdHeader)) continue; // dedupe, siehe UNIQUE-Constraint im Schema
      if (await store.wasAutoDeleted(account.id, mail.messageIdHeader)) continue; // dedupe für den Auto-Delete-Pfad, siehe store.ts

      const security = await ai.analyzeMail(mail.bodyText ?? "", mail.rawHeaders);

      // Externe Lookups als eigener Nachbearbeitungsschritt NACH
      // analyzeMail() (SYNC.md 08.09., Web-Antwort auf die vier "wer macht
      // den externen Lookup"-Fragen): security-classification/ (Track B)
      // bleibt zustandslos, Track A reichert das SecurityResult hier mit
      // DB-/Netzwerk-abhängigen Feldern an, die der Mock-KI-Adapter zuvor
      // fest auf "unknown"/geraten geliefert hat. Mock-Implementierungen,
      // siehe src/lookups/*.
      const senderDomain = domainFromAddress(mail.fromAddress);
      if (senderDomain) {
        const domainRep = await domainReputationLookup.lookup(senderDomain);
        security.senderDomainAgeDays = domainRep.senderDomainAgeDays;
        security.domainReputationScore = domainRep.domainReputationScore;
      }

      security.ipReputationFlag = await ipReputationLookup.lookup(extractSendingIp(mail.rawHeaders));

      const ibanCandidates = extractIbanCandidates(mail.bodyText ?? "");
      security.containsNewIban = await ibanHistoryCheck.checkAndRecord(account.userId, mail.fromAddress, ibanCandidates);

      // Auto-Delete-Pfad (WEB_INBOX.md 08.09., siehe SYNC.md): eindeutiger
      // Erotik-/Glücksspiel-Spam wird NIE persistiert -- weder als
      // messages-Zeile noch als Quarantäne-Eintrag. Anders als der normale
      // Spam-/Phishing-Pfad gibt es hier keine data_retention_policy-Frist
      // und kein Undo. Design-Entscheidung (2026-09-08): "gar nicht erst
      // speichern" statt "speichern + sofort wieder löschen", weil (a) der
      // Inhalt (Erotik/Glücksspiel) so nie im Klartext im Store landet, auch
      // nicht kurzzeitig, und (b) es keinen Undo-Pfad geben soll -- ein
      // real existierender, wenn auch sofort gelöschter Datensatz hätte das
      // nahegelegt. Nachvollziehbarkeit für den User trotzdem über
      // `security_audit_log` (action 'auto_deleted_adult_gambling_spam'),
      // ohne Message-Referenz (messageId=null, da nie angelegt).
      if (security.classification === "spam" && (security.spamSubcategory === "adult" || security.spamSubcategory === "gambling")) {
        await store.logSecurityAudit({
          userId: account.userId,
          messageId: null,
          action: "auto_deleted_adult_gambling_spam",
        });
        await store.markAutoDeleted(account.id, mail.messageIdHeader);
        autoDeleted++;
        continue;
      }

      const folderId = await resolveFolderId(security.classification, account.userId);

      const message = await store.insertMessage({
        mailAccountId: account.id,
        messageIdHeader: mail.messageIdHeader,
        providerMessageId: mail.providerMessageId,
        fromAddress: mail.fromAddress,
        fromDisplayName: mail.fromDisplayName,
        replyToAddress: mail.replyToAddress,
        subject: mail.subject,
        bodyText: mail.bodyText,
        receivedAt: mail.receivedAt,
        folderId,
        rawHeaders: mail.rawHeaders,
      });

      await store.setMessageSecurity({
        messageId: message.id,
        ...security,
        analyzedAt: new Date().toISOString(),
      });

      if (security.classification === "phishing") {
        await store.quarantineMessage(message.id, "Automatisch: Phishing-Klassifikation (Mock-KI)");
      }

      // Vertragsdaten best-effort extrahieren (Mock).
      const contractData = await ai.extractContract(mail.bodyText ?? "");
      if (contractData) {
        await store.insertContract({
          userId: account.userId,
          messageId: message.id,
          providerName: contractData.providerName,
          contractStart: contractData.contractStart,
          contractEnd: contractData.contractEnd,
          cancellationDeadline: contractData.cancellationDeadline,
          cancellationPeriodDays: contractData.cancellationPeriodDays,
          status: contractData.extractedConfidence < 0.7 ? "needs_review" : "active",
          extractedConfidence: contractData.extractedConfidence,
        });
      }

      imported++;
    }

    account.syncStatus = "ok";
    account.lastSyncedAt = new Date().toISOString();
    await store.updateMailAccount(account.id, { syncStatus: "ok", lastSyncedAt: account.lastSyncedAt });
  } catch (err) {
    account.syncStatus = "error";
    await store.updateMailAccount(account.id, { syncStatus: "error" });
    throw err;
  }

  return { imported, autoDeleted };
}
