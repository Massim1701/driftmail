// Einzige Stelle, die konkrete Lookup-Implementierungen mit den Interfaces
// verdrahtet -- analog zu src/ai/index.ts. Austausch gegen echte
// Implementierungen (WHOIS/Spamhaus/echte fraud_alerts-Anbindung) betrifft
// jeweils nur eine Zeile hier, Aufrufer (src/mail/sync.ts,
// src/routes/messages.ts) kennen nur die Interfaces aus ./types.

import { store } from "../db/store";
import { MockDomainReputationLookup } from "./domainReputationMock";
import { StoreIbanHistoryCheck } from "./ibanHistoryCheck";
import { MockIpReputationLookup } from "./ipReputationMock";
import { MockRecipientReputationLookup } from "./recipientReputationMock";
import type { DomainReputationLookup, IbanHistoryCheck, IpReputationLookup, RecipientReputationLookup } from "./types";

export const domainReputationLookup: DomainReputationLookup = new MockDomainReputationLookup();
export const ipReputationLookup: IpReputationLookup = new MockIpReputationLookup();
export const ibanHistoryCheck: IbanHistoryCheck = new StoreIbanHistoryCheck(store);
export const recipientReputationLookup: RecipientReputationLookup = new MockRecipientReputationLookup(store);

export { extractSendingIp } from "./ipReputationMock";
export { extractIbanCandidates } from "./ibanHistoryCheck";
export { domainFromAddress } from "./util";
export type * from "./types";
