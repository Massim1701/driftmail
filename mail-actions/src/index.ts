// driftmail — Track E (Antwort & Signatur): öffentliches Modul-Interface

export { draftReply, composeReplyDraft } from "./draftReply.js";
export {
  selectSignatureForContext,
  selectSignatureForNewMail,
  selectSignatureForReply,
  appendSignature,
  SignatureStore,
  type NewSignatureInput,
} from "./signatures.js";
export type { SignatureRecord, CompositionContext, MailThread, AiSource } from "./types.js";
