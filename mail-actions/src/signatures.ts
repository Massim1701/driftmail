// driftmail — Track E: Signatur-Verwaltung
//
// Reine Backend-Logik gegen die `signatures`-Tabelle aus
// contracts/db-schema.sql. Die tatsächliche Persistenz übernimmt Track A
// (Backend); `SignatureStore` hier ist ein austauschbarer In-Memory-Stand-in,
// der dieselbe Record-Form benutzt, damit die Auswahl-Regeln schon jetzt
// unabhängig getestet werden können. Siehe README.md für Annahmen.

import { randomUUID } from "node:crypto";
import type { CompositionContext, SignatureRecord } from "./types";

export type { SignatureRecord } from "./types";

/**
 * Kernregel: welche Signatur wird für einen gegebenen Mail-Account und
 * Kompositions-Kontext (neue Mail vs. Antwort) automatisch angehängt?
 *
 * 1. Nur Signaturen des angegebenen mail_account_id kommen in Frage.
 * 2. Nur Signaturen, deren Flag für den Kontext gesetzt ist
 *    (apply_to_new bei "new", apply_to_replies bei "reply"), sind Kandidaten.
 * 3. Genau ein Kandidat -> der wird verwendet.
 * 4. Mehrere Kandidaten (Dateninkonsistenz, sollte durch SignatureStore
 *    verhindert werden) -> der mit is_default = true gewinnt; bei mehreren
 *    oder keinem Default wird deterministisch der erste in Array-Reihenfolge
 *    genommen.
 * 5. Kein Kandidat -> Fallback auf die Default-Signatur (is_default) des
 *    Accounts, auch wenn deren apply_to_new/apply_to_replies-Flag für
 *    diesen Kontext nicht gesetzt ist. Entscheidung von Web/Massimo am
 *    08.09. (SYNC.md "Offene Fragen"): Default wird IMMER als Fallback
 *    angehängt, nicht nur bei explizit passendem Flag. Hat der Account
 *    auch keine Default-Signatur -> null, kein automatisches Anhängen.
 */
export function selectSignatureForContext(
  signatures: readonly SignatureRecord[],
  mailAccountId: string,
  context: CompositionContext
): SignatureRecord | null {
  const flag: keyof SignatureRecord =
    context === "new" ? "apply_to_new" : "apply_to_replies";

  const candidates = signatures.filter(
    (s) => s.mail_account_id === mailAccountId && s[flag] === true
  );

  if (candidates.length === 0) {
    const accountDefault = signatures.find(
      (s) => s.mail_account_id === mailAccountId && s.is_default
    );
    return accountDefault ?? null;
  }
  if (candidates.length === 1) return candidates[0]!;

  const defaults = candidates.filter((s) => s.is_default);
  if (defaults.length === 1) return defaults[0]!;

  // Mehrdeutig (0 oder >1 Defaults unter den Kandidaten): deterministisch
  // den ersten nehmen, statt zufällig zu wählen. SignatureStore verhindert
  // diesen Fall normalerweise (siehe setDefault), Rohdaten von außen
  // (z.B. direkt aus der DB) könnten ihn trotzdem enthalten.
  return candidates[0]!;
}

export function selectSignatureForNewMail(
  signatures: readonly SignatureRecord[],
  mailAccountId: string
): SignatureRecord | null {
  return selectSignatureForContext(signatures, mailAccountId, "new");
}

export function selectSignatureForReply(
  signatures: readonly SignatureRecord[],
  mailAccountId: string
): SignatureRecord | null {
  return selectSignatureForContext(signatures, mailAccountId, "reply");
}

/** Hängt eine Signatur an einen HTML-Body an, sofern eine ausgewählt wurde. */
export function appendSignature(
  bodyHtml: string,
  signature: SignatureRecord | null
): string {
  if (!signature) return bodyHtml;
  return `${bodyHtml}\n<br/>\n${signature.content_html}`;
}

export type NewSignatureInput = {
  mail_account_id: string;
  content_html: string;
  is_default?: boolean;
  apply_to_new?: boolean;
  apply_to_replies?: boolean;
};

/**
 * In-Memory-Repository für Signaturen. Stand-in für die spätere
 * DB-Anbindung durch Track A — bildet dieselbe Record-Form aus
 * `signatures` ab, damit ein Ersatz durch echte Queries mechanisch bleibt.
 *
 * Erzwingt die Invariante "höchstens eine Default-Signatur pro
 * mail_account_id", die im DB-Schema selbst NICHT über einen Constraint
 * abgesichert ist (siehe README "Annahmen").
 */
export class SignatureStore {
  private records = new Map<string, SignatureRecord>();

  constructor(initial: readonly SignatureRecord[] = []) {
    for (const record of initial) {
      this.records.set(record.id, { ...record });
    }
  }

  list(mailAccountId: string): SignatureRecord[] {
    return [...this.records.values()].filter(
      (s) => s.mail_account_id === mailAccountId
    );
  }

  get(signatureId: string): SignatureRecord | null {
    return this.records.get(signatureId) ?? null;
  }

  /**
   * Legt eine neue Signatur an. Wenn es die erste Signatur für diesen
   * Account ist, wird sie automatisch is_default (ein Account ohne jede
   * Default-Signatur wäre ein Zustand, den die UI nicht sinnvoll abbilden
   * kann). Wird is_default explizit true übergeben, werden alle anderen
   * Signaturen desselben Accounts auf false gesetzt.
   */
  create(input: NewSignatureInput): SignatureRecord {
    if (input.content_html.trim().length === 0) {
      throw new Error("content_html darf nicht leer sein");
    }

    const isFirstForAccount = this.list(input.mail_account_id).length === 0;
    const record: SignatureRecord = {
      id: randomUUID(),
      mail_account_id: input.mail_account_id,
      content_html: input.content_html,
      is_default: input.is_default ?? isFirstForAccount,
      apply_to_new: input.apply_to_new ?? true,
      apply_to_replies: input.apply_to_replies ?? false,
    };

    this.records.set(record.id, record);
    if (record.is_default) {
      this.unsetOtherDefaults(record.mail_account_id, record.id);
    }
    return { ...record };
  }

  /** Markiert eine Signatur als Default und entfernt den Default-Status bei allen anderen desselben Accounts. */
  setDefault(mailAccountId: string, signatureId: string): SignatureRecord {
    const record = this.requireOwned(mailAccountId, signatureId);
    record.is_default = true;
    this.unsetOtherDefaults(mailAccountId, signatureId);
    return { ...record };
  }

  update(
    signatureId: string,
    patch: Partial<Omit<SignatureRecord, "id" | "mail_account_id">>
  ): SignatureRecord {
    const record = this.records.get(signatureId);
    if (!record) throw new Error(`Signatur ${signatureId} nicht gefunden`);

    Object.assign(record, patch);

    if (patch.is_default === true) {
      this.unsetOtherDefaults(record.mail_account_id, record.id);
    }
    return { ...record };
  }

  /**
   * Löscht eine Signatur. War sie Default und es gibt noch andere
   * Signaturen für den Account, wird die zeitlich zuerst angelegte
   * (nach Map-Einfügereihenfolge) automatisch neuer Default — sonst bliebe
   * der Account ohne jede Default-Signatur zurück.
   */
  remove(signatureId: string): void {
    const record = this.records.get(signatureId);
    if (!record) return;

    this.records.delete(signatureId);

    if (record.is_default) {
      const remaining = this.list(record.mail_account_id);
      if (remaining.length > 0) {
        remaining[0]!.is_default = true;
      }
    }
  }

  selectForNewMail(mailAccountId: string): SignatureRecord | null {
    return selectSignatureForNewMail(this.list(mailAccountId), mailAccountId);
  }

  selectForReply(mailAccountId: string): SignatureRecord | null {
    return selectSignatureForReply(this.list(mailAccountId), mailAccountId);
  }

  private unsetOtherDefaults(mailAccountId: string, keepId: string): void {
    for (const record of this.records.values()) {
      if (record.mail_account_id === mailAccountId && record.id !== keepId) {
        record.is_default = false;
      }
    }
  }

  private requireOwned(mailAccountId: string, signatureId: string): SignatureRecord {
    const record = this.records.get(signatureId);
    if (!record) throw new Error(`Signatur ${signatureId} nicht gefunden`);
    if (record.mail_account_id !== mailAccountId) {
      throw new Error(
        `Signatur ${signatureId} gehört nicht zu Account ${mailAccountId}`
      );
    }
    return record;
  }
}
