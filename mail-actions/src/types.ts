// driftmail — Track E (Antwort & Signatur)
//
// Typen, die 1:1 aus den Track-0-Contracts stammen (contracts/db-schema.sql,
// contracts/ai-adapter-interface.ts). Wir importieren statt kopieren, wo es
// geht, damit dieses Modul nicht stillschweigend vom Contract abweicht.

export type { MailThread, AiSource, AiAdapterResult } from "../../contracts/ai-adapter-interface";

/**
 * Spiegelt die Tabelle `signatures` aus contracts/db-schema.sql 1:1.
 * Feldnamen bewusst wie im DB-Schema (snake_case), damit eine spätere
 * Backend-Anbindung (Track A) diese Records ohne Mapping-Schicht
 * durchreichen kann.
 */
export interface SignatureRecord {
  id: string;
  mail_account_id: string;
  content_html: string;
  is_default: boolean;
  apply_to_new: boolean;
  apply_to_replies: boolean;
}

/** Kontext, in dem eine Signatur automatisch angehängt werden könnte. */
export type CompositionContext = "new" | "reply";
