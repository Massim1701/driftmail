// Einzige Stelle, die konkrete Lookup-Implementierungen mit den Interfaces
// verdrahtet -- analog zu src/ai/index.ts. Austausch gegen echte
// Implementierungen (WHOIS/Spamhaus/echte fraud_alerts-Anbindung) betrifft
// jeweils nur eine Zeile hier, Aufrufer (src/mail/sync.ts,
// src/routes/messages.ts) kennen nur die Interfaces aus ./types.

import { store } from "../db/store";
import { ClamAvAttachmentScanner } from "./attachmentScanClamAv";
import { MockDataBreachLookup } from "./dataBreachMock";
import { MockDomainReputationLookup } from "./domainReputationMock";
import { StoreIbanHistoryCheck } from "./ibanHistoryCheck";
import { StoreIbanThreadCheck } from "./ibanThreadCheck";
import { MockIpReputationLookup } from "./ipReputationMock";
import { MockRecipientReputationLookup } from "./recipientReputationMock";
import type {
  AttachmentScanner,
  DataBreachLookup,
  DomainReputationLookup,
  IbanHistoryCheck,
  IbanThreadCheck,
  IpReputationLookup,
  RecipientReputationLookup,
} from "./types";

export const domainReputationLookup: DomainReputationLookup = new MockDomainReputationLookup();
export const ipReputationLookup: IpReputationLookup = new MockIpReputationLookup();
export const ibanHistoryCheck: IbanHistoryCheck = new StoreIbanHistoryCheck(store);
export const ibanThreadCheck: IbanThreadCheck = new StoreIbanThreadCheck(store);
export const recipientReputationLookup: RecipientReputationLookup = new MockRecipientReputationLookup(store);
// [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan": echter
// ClamAV-Scan statt der fruehen Dateiendungs-Attrappe, siehe
// attachmentScanClamAv.ts.
export const attachmentScanner: AttachmentScanner = new ClamAvAttachmentScanner();
// [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 3 ("Darkweb-/Datenleck-
// Ueberwachung") -- siehe dataBreachMock.ts fuer die Begruendung, warum
// (noch) gemockt statt real angebunden.
export const dataBreachLookup: DataBreachLookup = new MockDataBreachLookup();

export { extractSendingIp } from "./ipReputationMock";
export { extractIbanCandidates } from "./ibanHistoryCheck";
export { domainFromAddress } from "./util";
export type * from "./types";
