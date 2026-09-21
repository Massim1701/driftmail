import { useEffect, useMemo, useRef, useState } from "react";
import type { AiSource, AttachmentScanStatus, MailAccount, MessageDetail } from "../types";
import { api, ApiError } from "../api";
import { tryDraftReplyOnDevice } from "../onDeviceAi";
import "./ComposeModal.css";

// [2026-09-21] WEB_INBOX.md "DREI WEITERE FEATURES - Gmail-Recherche"
// Punkt 1 ("Vergessener-Anhang-Erkennung") -- reine Client-Logik, einfache
// Keyword-Liste reicht laut Auftrag, kein ML nötig.
const FORGOTTEN_ATTACHMENT_PATTERN = /\b(im anhang|siehe anhang|anbei|attached|see attachment)\b/i;

// [2026-09-21] WEB_INBOX.md "NEUE AUFTRAEGE - 5 Wettbewerbs-Luecken" Punkt 2
// ("Undo Send") -- 8 Sekunden, wie im Auftrag vorgeschlagen ("z.B. 5-10
// Sekunden"). Bewusst als reine Client-Verzögerung VOR dem eigentlichen
// POST /messages/send-Aufruf umgesetzt (kein serverseitiger "vorläufiger
// Versand"-Zustand nötig) -- der Compose-Dialog bleibt dafür während des
// Countdowns geöffnet (Felder eingefroren) statt sich zu schließen und
// später wieder zu öffnen: einfacher umzusetzen und der eingegebene Text
// geht dabei garantiert nie verloren.
const UNDO_SEND_SECONDS = 8;

// [2026-09-21] Compose-Screen (WEB_INBOX.md 21.09. "BUG - Massimo beim
// echten Live-Test entdeckt" + "ERGAENZUNG" + "DREI WEITERE
// GRUNDFUNKTIONEN"): EIN gemeinsamer Compose-Dialog für alle drei Fälle
// (neue Mail, Antworten, Weiterleiten) statt drei getrennter UIs -- To/CC/
// BCC/Betreff sind in allen drei Fällen dieselben Felder, nur die
// Vorbefüllung unterscheidet sich. Antworten lief bisher inline in
// MessageDetailPane (kein To/CC/BCC-Feld, feste Empfänger-Adresse) --
// dieser Dialog ersetzt das, damit CC/BCC auch beim Antworten nutzbar sind.

type AttachmentUiStatus = AttachmentScanStatus | "uploading" | "error";

interface ComposeAttachment {
  localId: string;
  file: File;
  attachmentId: string | null;
  status: AttachmentUiStatus;
}

function attachmentStatusLabel(status: AttachmentUiStatus): string {
  switch (status) {
    case "uploading":
      return "Wird hochgeladen…";
    case "pending":
      return "Wird geprüft…";
    case "clean":
      return "Geprüft";
    case "malicious":
      return "Gefährlich — wird nicht gesendet";
    case "blocked_type":
      return "Dateityp nicht erlaubt";
    case "scan_failed":
      return "Prüfung fehlgeschlagen";
    case "error":
      return "Hochladen fehlgeschlagen";
  }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sensitiveDataLabel(kind: "iban" | "credit_card" | "other"): string {
  switch (kind) {
    case "iban":
      return "eine IBAN";
    case "credit_card":
      return "eine Kreditkartennummer";
    case "other":
      return "sensible Daten";
  }
}

// datetime-local liefert/erwartet lokale Zeit ohne Zeitzonen-Suffix --
// new Date(value).toISOString() würde das als UTC fehlinterpretieren.
function localDateTimeToIso(value: string): string {
  return new Date(value).toISOString();
}

// Kleinster sinnvoller Default für die beiden datetime-local-Felder
// (Vertraulich-bis / Später senden): 1h ab jetzt, als "YYYY-MM-DDTHH:mm".
function defaultLocalDateTime(minutesFromNow: number): string {
  const d = new Date(Date.now() + minutesFromNow * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function parseAddressList(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export type ComposeMode = "new" | "reply" | "forward";

export function ComposeModal({
  mode,
  accounts,
  defaultAccountId,
  original,
  onClose,
  onSent,
  onDraftScheduled,
}: {
  mode: ComposeMode;
  /** Sender-Auswahl (WEB_INBOX.md 21.09. "ERGAENZUNG"): nur relevant im
   * "new"-Modus -- bei "reply"/"forward" wird accountId aus der
   * Ursprungsnachricht abgeleitet (siehe backend/README.md "Versand"). */
  accounts: MailAccount[];
  defaultAccountId: string | null;
  /** Ursprungsnachricht für "reply"/"forward" (Vorbefüllung), bei "new" null. */
  original: MessageDetail | null;
  onClose: () => void;
  /** POST /messages/send war erfolgreich -- App.tsx lädt den "gesendet"-
   * Ordner neu (analog zum bisherigen onSent in MessageDetailPane). */
  onSent: () => void;
  /** [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 8 ("Schedule Send"): ein
   * geplanter Versand legt (nur) einen Entwurf mit scheduledFor an, nichts
   * wurde tatsächlich gesendet -- onSent (das den "gesendet"-Ordner neu
   * lädt) wäre hier falsch, App.tsx lädt stattdessen die Entwürfe-Liste neu. */
  onDraftScheduled: () => void;
}) {
  const isReply = mode === "reply";
  const isForward = mode === "forward";

  const prefill = useMemo(() => {
    if (isReply && original) {
      const subject = original.subject
        ? original.subject.toLowerCase().startsWith("re:")
          ? original.subject
          : `Re: ${original.subject}`
        : "";
      return { to: original.fromAddress, cc: "", bcc: "", subject, bodyText: "" };
    }
    if (isForward && original) {
      const subject = original.subject
        ? original.subject.toLowerCase().startsWith("fwd:")
          ? original.subject
          : `Fwd: ${original.subject}`
        : "Fwd:";
      const quoted = [
        "",
        "",
        "---- Weitergeleitete Nachricht ----",
        `Von: ${original.fromDisplayName ? `${original.fromDisplayName} <${original.fromAddress}>` : original.fromAddress}`,
        `Datum: ${formatDateTime(original.receivedAt)}`,
        `Betreff: ${original.subject}`,
        "",
        original.bodyText ?? "",
      ].join("\n");
      return { to: "", cc: "", bcc: "", subject, bodyText: quoted };
    }
    return { to: "", cc: "", bcc: "", subject: "", bodyText: "" };
  }, [isReply, isForward, original]);

  const [accountId, setAccountId] = useState(defaultAccountId ?? accounts[0]?.id ?? "");
  const [to, setTo] = useState(prefill.to);
  const [cc, setCc] = useState(prefill.cc);
  const [bcc, setBcc] = useState(prefill.bcc);
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState(prefill.subject);
  const [bodyText, setBodyText] = useState(prefill.bodyText);
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draftSource, setDraftSource] = useState<AiSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // [2026-09-21] "DREI WEITERE FEATURES - Gmail-Recherche" Punkt 2
  // ("Vertraulicher Modus"): Checkbox + Ablaufzeitpunkt, Vorschlag kommt aus
  // POST /messages/draft/phishing-check (containsSensitiveData), siehe
  // sensitiveDataHint-Effekt unten.
  const [confidential, setConfidential] = useState(false);
  const [confidentialUntil, setConfidentialUntil] = useState(() => defaultLocalDateTime(24 * 60));
  const [sensitiveDataHint, setSensitiveDataHint] = useState<string[] | null>(null);

  // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 8 ("Schedule Send"): eigener
  // Zweig statt direktem Senden -- legt/aktualisiert stattdessen den
  // Autosave-Entwurf mit scheduledFor (siehe handleScheduleConfirm).
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState(() => defaultLocalDateTime(60));
  const [scheduling, setScheduling] = useState(false);

  // [2026-09-21] "5 Wettbewerbs-Luecken" Punkt 2 ("Undo Send"): null =
  // normaler Bearbeitungszustand, sonst Sekunden bis zum tatsächlichen
  // POST /messages/send (siehe UNDO_SEND_SECONDS-Kommentar oben).
  const [undoSecondsLeft, setUndoSecondsLeft] = useState<number | null>(null);

  // Kontakt-Autovervollstaendigung (WEB_INBOX.md 21.09. "FUENF NEUE
  // KOMFORT-FEATURES" Punkt 2) -- einmal beim Oeffnen geladen, native
  // <datalist> uebernimmt das Filtern-waehrend-des-Tippens, keine eigene
  // JS-Logik noetig.
  const [contacts, setContacts] = useState<string[]>([]);
  useEffect(() => {
    api.listContacts().then(setContacts).catch(() => {});
  }, []);

  // Entwuerfe automatisch speichern (WEB_INBOX.md 21.09. "FUENF NEUE
  // KOMFORT-FEATURES" Punkt 3) -- 3s nach der letzten Aenderung, nur bei
  // "new"/"forward" (nicht "reply": ein Antwortentwurf braucht
  // inReplyToMessageId + eine eigene Wiederherstellungs-UI in der
  // Entwuerfe-Liste, die es fuer Antworten noch nicht gibt -- bewusst nicht
  // Teil dieses Schritts). Erster Speicherversuch legt den Entwurf an
  // (POST /drafts), alle weiteren aktualisieren ihn (PATCH /drafts/{id}).
  // Kein leerer Entwurf beim reinen Oeffnen des Dialogs. `draftId` als Ref
  // statt State: soll GELESEN/geschrieben werden, ohne den Debounce-Effekt
  // erneut auszuloesen (ein Speichern wuerde sonst sich selbst unterbrechen).
  const draftIdRef = useRef<string | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  useEffect(() => {
    if (isReply) return;
    const toListForSave = parseAddressList(to);
    const hasContent = toListForSave.length > 0 || subject.trim().length > 0 || bodyText.trim().length > 0;
    if (!hasContent) return;

    const timeout = setTimeout(async () => {
      setDraftSaveStatus("saving");
      try {
        const data = { to: toListForSave, cc: parseAddressList(cc), subject, bodyText };
        if (draftIdRef.current) {
          await api.updateDraft(draftIdRef.current, data);
        } else {
          const created = await api.createDraft(data);
          draftIdRef.current = created.id;
        }
        setDraftSaveStatus("saved");
      } catch {
        setDraftSaveStatus("idle");
      }
    }, 3000);
    return () => clearTimeout(timeout);
  }, [to, cc, subject, bodyText, isReply]);

  // Vertraulicher Modus, Auto-Vorschlag (Punkt 2): entprellt wie das
  // Autosave oben, prüft den Text auf IBAN/Kreditkarte/Sonstiges. Kein
  // erneuter Aufruf mehr, sobald der Nutzer den Modus schon aktiviert hat --
  // der Hinweis wäre dann überflüssig.
  useEffect(() => {
    if (confidential || bodyText.trim().length === 0) {
      setSensitiveDataHint(null);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const result = await api.checkDraftForSensitiveData(bodyText);
        setSensitiveDataHint(result.containsSensitiveData.length > 0 ? result.containsSensitiveData : null);
      } catch {
        // Vorschlag ist optional -- kein Fehler-Banner für einen fehlgeschlagenen Hintergrund-Check.
      }
    }, 1500);
    return () => clearTimeout(timeout);
  }, [bodyText, confidential]);

  // Reply/Forward auf Klick eines KI-Entwurfs (nur bei "reply" sinnvoll --
  // createReplyDraft() beantwortet die Ursprungsnachricht, kein Äquivalent
  // für "neue Mail"/"weiterleiten"). [2026-09-21] KORREKTUR
  // (TERMINAL_INBOX.md 21.09.): On-Device zuerst versuchen (Inhalt verlässt
  // dann nie das Gerät), Backend-Aufruf nur als Fallback.
  async function requestAiDraft() {
    if (!original) return;
    if (bodyText.trim() && !window.confirm("Vorhandenen Text durch einen KI-Entwurf ersetzen?")) {
      return;
    }
    setDraftLoading(true);
    try {
      const onDevice = await tryDraftReplyOnDevice({ ...original, bodyText: original.bodyText ?? "" });
      if (onDevice) {
        setBodyText(onDevice);
        setDraftSource("on_device");
      } else {
        const res = await api.createReplyDraft(original.id);
        setBodyText(res.draftText);
        setDraftSource(res.source);
      }
      setSendError(null);
    } finally {
      setDraftLoading(false);
    }
  }

  async function handleFilesSelected(files: FileList | null) {
    if (!files || files.length === 0) return;
    const newItems: ComposeAttachment[] = Array.from(files).map((file) => ({
      localId: crypto.randomUUID(),
      file,
      attachmentId: null,
      status: "uploading",
    }));
    setAttachments((prev) => [...prev, ...newItems]);

    for (const item of newItems) {
      try {
        const result = await api.uploadAttachment(item.file);
        setAttachments((prev) =>
          prev.map((a) => (a.localId === item.localId ? { ...a, attachmentId: result.attachmentId, status: result.scanStatus } : a)),
        );
      } catch {
        setAttachments((prev) => prev.map((a) => (a.localId === item.localId ? { ...a, status: "error" } : a)));
      }
    }
  }

  function removeAttachment(localId: string) {
    setAttachments((prev) => prev.filter((a) => a.localId !== localId));
  }

  const hasBlockingAttachment = attachments.some((a) => a.status !== "clean");
  const toList = parseAddressList(to);
  const canSend = toList.length > 0 && bodyText.trim().length > 0 && !hasBlockingAttachment && (isReply || !!accountId);

  async function performSend() {
    setSending(true);
    setSendError(null);
    try {
      await api.sendMessage({
        accountId: isReply ? undefined : accountId,
        inReplyToMessageId: isReply && original ? original.id : undefined,
        to: toList,
        cc: parseAddressList(cc),
        bcc: parseAddressList(bcc),
        subject,
        bodyText,
        attachmentIds: attachments.map((a) => a.attachmentId).filter((id): id is string => id !== null),
        // Autosave (Punkt 3): falls waehrend des Tippens ein Entwurf
        // angelegt wurde, raeumt das Backend ihn nach erfolgreichem Versand
        // automatisch auf (siehe backend/README.md "Versand", draftId-Feld).
        draftId: draftIdRef.current ?? undefined,
        confidentialUntil: confidential ? localDateTimeToIso(confidentialUntil) : undefined,
      });
      onSent();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const body = err.body as { reason?: string } | undefined;
        setSendError(body?.reason ?? "Versand wurde aus Sicherheitsgründen blockiert.");
      } else {
        setSendError("Versand fehlgeschlagen. Bitte später erneut versuchen.");
      }
      setUndoSecondsLeft(null);
    } finally {
      setSending(false);
    }
  }

  // Undo Send (Punkt 2 der "5 Wettbewerbs-Luecken"): der eigentliche Klick
  // startet nur den Countdown, performSend() läuft erst, wenn er auf 0
  // abläuft, ohne dass "Rückgängig" gedrückt wurde.
  function handleSendClick() {
    if (!canSend) return;
    // Vergessener-Anhang-Erkennung (Punkt 1 der "DREI WEITERE FEATURES"):
    // reine Keyword-Heuristik, siehe FORGOTTEN_ATTACHMENT_PATTERN oben.
    if (attachments.length === 0 && FORGOTTEN_ATTACHMENT_PATTERN.test(bodyText)) {
      const proceed = window.confirm(
        'Der Text erwähnt einen Anhang ("im Anhang", "anbei", …), es wurde aber keiner hinzugefügt. Trotzdem senden?',
      );
      if (!proceed) return;
    }
    setSendError(null);
    setUndoSecondsLeft(UNDO_SEND_SECONDS);
  }

  function handleUndoSend() {
    setUndoSecondsLeft(null);
  }

  useEffect(() => {
    if (undoSecondsLeft === null) return;
    if (undoSecondsLeft <= 0) {
      performSend();
      return;
    }
    const timeout = setTimeout(() => setUndoSecondsLeft((s) => (s ?? 1) - 1), 1000);
    return () => clearTimeout(timeout);
    // performSend liest bei Ablauf den zu diesem Zeitpunkt aktuellen State
    // (Felder sind waehrend des Countdowns eingefroren, siehe JSX unten) --
    // ein Abhaengen von den Formularfeldern wuerde den Countdown nur
    // unnoetig neu starten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoSecondsLeft]);

  async function handleScheduleConfirm() {
    if (!canSend || !scheduledFor) return;
    setScheduling(true);
    setSendError(null);
    try {
      const data = {
        to: toList,
        cc: parseAddressList(cc),
        bcc: parseAddressList(bcc),
        subject,
        bodyText,
        scheduledFor: localDateTimeToIso(scheduledFor),
      };
      if (draftIdRef.current) {
        await api.updateDraft(draftIdRef.current, data);
      } else {
        const created = await api.createDraft(data);
        draftIdRef.current = created.id;
      }
      onDraftScheduled();
      onClose();
    } catch {
      setSendError("Planen fehlgeschlagen. Bitte später erneut versuchen.");
    } finally {
      setScheduling(false);
    }
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const title = isReply ? "Antworten" : isForward ? "Weiterleiten" : "Neue Nachricht";

  return (
    <div className="compose-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="compose-modal" onClick={(e) => e.stopPropagation()}>
        <div className="compose-modal-header">
          <h2>{title}</h2>
          <button type="button" className="link-button" onClick={onClose} aria-label="Schließen">
            Schließen
          </button>
        </div>

        <fieldset className="compose-fields" disabled={undoSecondsLeft !== null}>
          {mode === "new" && accounts.length > 1 && (
            <label className="compose-field">
              <span>Von</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emailAddress}
                  </option>
                ))}
              </select>
            </label>
          )}
          {/* Kontakt-Autovervollstaendigung (Punkt 2): ein gemeinsames
              <datalist>, native Browser-Filterung beim Tippen, kein
              eigener Dropdown-Code noetig. */}
          <datalist id="known-contacts">
            {contacts.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>

          <label className="compose-field">
            <span>An</span>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="empfaenger@example.com, weitere@example.com"
              autoFocus={!isReply}
              list="known-contacts"
            />
          </label>

          {!showCcBcc ? (
            <button type="button" className="link-button compose-ccbcc-toggle" onClick={() => setShowCcBcc(true)}>
              CC/BCC hinzufügen
            </button>
          ) : (
            <>
              <label className="compose-field">
                <span>CC</span>
                <input type="text" value={cc} onChange={(e) => setCc(e.target.value)} placeholder="cc@example.com" list="known-contacts" />
              </label>
              <label className="compose-field">
                <span>BCC</span>
                <input type="text" value={bcc} onChange={(e) => setBcc(e.target.value)} placeholder="bcc@example.com" list="known-contacts" />
              </label>
            </>
          )}

          <label className="compose-field">
            <span>Betreff</span>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Betreff" />
          </label>

          <textarea
            className="draft-textarea compose-body"
            value={bodyText}
            onChange={(e) => {
              setBodyText(e.target.value);
              setSendError(null);
            }}
            rows={10}
            autoFocus={isReply}
            placeholder="Nachricht eingeben…"
          />

          {sensitiveDataHint && (
            <div className="compose-hint-banner">
              <span>
                Der Text enthält {sensitiveDataHint.map((k) => sensitiveDataLabel(k as "iban" | "credit_card" | "other")).join(" und ")}{" "}
                — vertraulich senden?
              </span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setConfidential(true);
                  setSensitiveDataHint(null);
                }}
              >
                Vertraulich senden
              </button>
            </div>
          )}

          {/* Vertraulicher Modus (Punkt 2): Ablauf-Zeitpunkt nur sichtbar,
              wenn aktiviert -- Default 24h ab jetzt (defaultLocalDateTime). */}
          <label className="compose-option-row">
            <input type="checkbox" checked={confidential} onChange={(e) => setConfidential(e.target.checked)} />
            <span>Vertraulich senden</span>
          </label>
          {confidential && (
            <label className="compose-option-row">
              <span>Läuft ab am</span>
              <input
                type="datetime-local"
                value={confidentialUntil}
                onChange={(e) => setConfidentialUntil(e.target.value)}
              />
            </label>
          )}

          {/* Schedule Send ("5 Wettbewerbs-Luecken" Punkt 8): eigener
              Auslöser (Button unten), das Picker-Feld wird hier nur
              eingeblendet, wenn "Später senden" angeklickt wurde. */}
          {scheduleOpen && (
            <label className="compose-option-row">
              <span>Senden am</span>
              <input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
              <button type="button" className="btn btn-primary" onClick={handleScheduleConfirm} disabled={scheduling || !canSend}>
                {scheduling ? "Plane…" : "Planen"}
              </button>
              <button type="button" className="link-button" onClick={() => setScheduleOpen(false)}>
                Abbrechen
              </button>
            </label>
          )}

          {attachments.length > 0 && (
            <ul className="attachment-list">
              {attachments.map((a) => (
                <li key={a.localId} className={`attachment-item attachment-status-${a.status}`}>
                  <span className="attachment-filename">{a.file.name}</span>
                  <span className="attachment-status">{attachmentStatusLabel(a.status)}</span>
                  <button
                    type="button"
                    className="link-button attachment-remove"
                    onClick={() => removeAttachment(a.localId)}
                    aria-label={`${a.file.name} entfernen`}
                  >
                    Entfernen
                  </button>
                </li>
              ))}
            </ul>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = "";
            }}
          />

          {sendError && <p className="send-error">{sendError}</p>}
        </fieldset>

        {undoSecondsLeft !== null ? (
          // Undo Send (Punkt 2): der Dialog bleibt offen (Felder eingefroren
          // per fieldset disabled oben), diese Leiste ersetzt nur die
          // normale Aktionszeile für die Dauer des Countdowns.
          <div className="undo-send-bar">
            <span>Wird in {undoSecondsLeft}s gesendet…</span>
            <div className="compose-modal-actions-spacer" />
            <button type="button" className="btn btn-secondary" onClick={handleUndoSend}>
              Rückgängig
            </button>
          </div>
        ) : (
          <div className="compose-modal-actions">
            <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
              Anhang hinzufügen
            </button>
            {isReply && (
              <button type="button" className="btn btn-secondary" onClick={requestAiDraft} disabled={draftLoading}>
                {draftLoading ? "Erstelle Entwurf…" : "KI-Entwurf vorschlagen"}
              </button>
            )}
            {isReply && draftSource && (
              <span className="compose-draft-source">
                {draftSource === "on_device" ? "On-Device" : draftSource === "cloud_fallback" ? "Cloud (eigener Zugang)" : "Regelbasiert"}
              </span>
            )}
            {!isReply && draftSaveStatus !== "idle" && (
              <span className="compose-draft-source">{draftSaveStatus === "saving" ? "Speichere Entwurf…" : "Entwurf gespeichert"}</span>
            )}
            {!isReply && !scheduleOpen && (
              <button type="button" className="btn btn-secondary" onClick={() => setScheduleOpen(true)} disabled={!canSend}>
                Später senden
              </button>
            )}
            <div className="compose-modal-actions-spacer" />
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Verwerfen
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSendClick} disabled={sending || !canSend}>
              {sending ? "Sende…" : "Senden"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
