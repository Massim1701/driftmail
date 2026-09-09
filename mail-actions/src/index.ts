// driftmail — Track E (Antwort & Signatur): öffentliches Modul-Interface

export { draftReply, composeReplyDraft } from "./draftReply";
export {
  selectSignatureForContext,
  selectSignatureForNewMail,
  selectSignatureForReply,
  appendSignature,
  SignatureStore,
  type NewSignatureInput,
} from "./signatures";
export type { SignatureRecord, CompositionContext, MailThread, AiSource } from "./types";
