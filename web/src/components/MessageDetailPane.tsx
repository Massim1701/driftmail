import { useEffect, useState } from "react";
import type { AttachmentScanStatus, Folder, MailSummary, MessageDetail } from "../types";
import { api } from "../api";
import { trySummarizeOnDevice } from "../onDeviceAi";
import { SecurityBadge, SecurityDetails, SecuritySignalBadges } from "./SecurityBadge";
import "./MessageDetailPane.css";

// [2026-09-21] "WICHTIGE LUECKE ENTDECKT - echter Malware-Scan" -- gleiche
// Label-Logik wie attachmentStatusLabel() in ComposeModal.tsx, hier nur für
// bereits gescannte (nicht mehr hochladende) Anhänge.
function scanStatusLabel(status: AttachmentScanStatus): string {
  switch (status) {
    case "pending":
      return "Wird geprüft…";
    case "clean":
      return "Geprüft, unauffällig";
    case "malicious":
      return "Gefährlich — gesperrt";
    case "blocked_type":
      return "Dateityp nicht erlaubt — gesperrt";
    case "scan_failed":
      return "Prüfung fehlgeschlagen — gesperrt";
  }
}

// [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze") --
// ein paar sinnvolle Presets statt ausschließlich freier Datumsauswahl,
// analog zu Gmail/Superhuman.
function snoozePresetDate(preset: "1h" | "tomorrow" | "nextWeek"): string {
  const now = new Date();
  if (preset === "1h") return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  if (preset === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date(now);
  d.setDate(d.getDate() + 7);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

// [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): drei statt zwei
// Quellen, siehe backend/README.md "KI-Anbindung (BYOK)".
function aiSourceLabel(source: MailSummary["source"]): string {
  switch (source) {
    case "on_device":
      return "On-Device";
    case "cloud_fallback":
      return "Cloud (eigener Zugang)";
    case "heuristic":
      return "Regelbasiert";
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

export function MessageDetailPane({
  message,
  loading,
  folders,
  quarantaeneFolderId,
  papierkorbFolderId,
  spamFolderId,
  trustedSenderAddresses,
  strictUnknownSenders,
  onTrustSender,
  onQuarantined,
  onMoved,
  onDeleted,
  onPermanentlyDeleted,
  onReply,
  onForward,
  onSnoozed,
}: {
  message: MessageDetail | null;
  loading: boolean;
  folders: Folder[];
  quarantaeneFolderId: string | null;
  papierkorbFolderId: string | null;
  /** WEB_INBOX.md 09.09. "KORREKTUR der letzten Regel": der Antworten-
   * Button wird ausgeblendet, wenn die Nachricht sich AKTUELL im
   * spam-Systemordner befindet (folderId-Check), NICHT wenn irgendwann
   * classification='spam' war -- verschiebt der User die Mail manuell
   * raus, ist der Button sofort wieder da. */
  spamFolderId: string | null;
  /** GET /trusted-senders (WEB_INBOX.md 15.09.): "Neuer Absender"-Badge wird
   * unterdrückt, wenn die Adresse hier drin ist -- siehe api-spec.yaml
   * isNewSender-Beschreibung. */
  trustedSenderAddresses: Set<string>;
  /** [2026-09-21] WEB_INBOX.md 21.09. "FUENF NEUE KOMFORT-FEATURES" Punkt 1
   * ("Unbekannte Absender streng behandeln", Default true): wenn true UND
   * die Nachricht von einem unbekannten Absender stammt, wird der Header
   * zusätzlich zum bestehenden dezenten Badge stärker hervorgehoben (siehe
   * `detail-header-unknown-sender`-Klasse unten) -- reine Darstellungs-
   * intensität, kein neues Signal. */
  strictUnknownSenders: boolean;
  onQuarantined: (id: string) => void;
  onMoved: (id: string, folderId: string) => void;
  onDeleted: (id: string) => void;
  onPermanentlyDeleted: (id: string) => void;
  /** [2026-09-21] Antworten/Weiterleiten öffnen jetzt den gemeinsamen
   * ComposeModal in App.tsx (siehe dort) statt eines inline hier
   * eingebetteten Compose-Felds -- dadurch stehen CC/BCC (WEB_INBOX.md
   * 21.09. "CC/BCC beim Verfassen") auch beim Antworten zur Verfügung,
   * nicht nur bei neuen Mails. */
  onReply: (message: MessageDetail) => void;
  onForward: (message: MessageDetail) => void;
  /** [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze"):
   * die Nachricht verschwindet aus der Ordner-Liste (App.tsx entfernt sie
   * dort), bleibt aber hier in der Detailansicht sichtbar -- gleiches
   * Prinzip wie onQuarantined/onMoved. */
  onSnoozed: (id: string) => void;
  /** [2026-09-21] WEB_INBOX.md 21.09. "KLEINE VERKNUEPFUNG - Neuer-
   * Absender-Badge mit Whitelist verbinden": App.tsx besitzt
   * trustedSenderAddresses zentral (auch für andere Nachrichten relevant),
   * deshalb ruft diese Komponente nur den Callback auf statt selbst
   * api.addTrustedSender() aufzurufen. */
  onTrustSender: (address: string) => void;
}) {
  const [summary, setSummary] = useState<MailSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [quarantining, setQuarantining] = useState(false);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [permanentlyDeleting, setPermanentlyDeleting] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [unsubscribing, setUnsubscribing] = useState(false);
  // [2026-09-21] "LUECKE SCHLIESSEN - echter Abmelde-Aufruf": nur noch
  // confirmed/failed, siehe api.ts-Kommentar.
  const [unsubscribeStatus, setUnsubscribeStatus] = useState<"confirmed" | "failed" | null>(null);
  // [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 5 ("Snooze").
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const [snoozing, setSnoozing] = useState(false);

  // Beim Wechsel der Nachricht abgeleiteten Zustand zurücksetzen
  useEffect(() => {
    setSummary(null);
    setShowDetails(false);
    setUnsubscribeStatus(null);
    setSnoozeMenuOpen(false);
  }, [message?.id]);

  if (loading) {
    return <div className="detail-pane detail-empty">Lade Nachricht…</div>;
  }
  if (!message) {
    return <div className="detail-pane detail-empty">Wähle eine Nachricht aus der Liste.</div>;
  }

  const isQuarantined = quarantaeneFolderId !== null && message.folderId === quarantaeneFolderId;
  const isInTrash = papierkorbFolderId !== null && message.folderId === papierkorbFolderId;
  const isInSpam = spamFolderId !== null && message.folderId === spamFolderId;
  const isUnknownSender = message.isNewSender && !trustedSenderAddresses.has(message.fromAddress);

  async function loadSummary() {
    if (!message) return;
    setSummaryLoading(true);
    try {
      // [2026-09-21] KORREKTUR (TERMINAL_INBOX.md 21.09.): On-Device zuerst
      // versuchen (Inhalt verlässt dann nie das Gerät), Backend nur als
      // Fallback (siehe onDeviceAi.ts-Kopfkommentar für Details/Grenzen).
      const onDevice = await trySummarizeOnDevice(message.bodyText ?? "");
      if (onDevice) {
        setSummary({ ...onDevice, source: "on_device" });
      } else {
        setSummary(await api.getSummary(message.id));
      }
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleQuarantine() {
    if (!message) return;
    setQuarantining(true);
    try {
      await api.quarantineMessage(message.id);
      onQuarantined(message.id);
    } finally {
      setQuarantining(false);
    }
  }

  // POST /messages/{id}/unsubscribe (WEB_INBOX.md 09.09. "Automatische
  // Abmeldung bei Spam", manueller Pfad) -- nur sichtbar, wenn
  // message.canUnsubscribe=true. Läuft unabhängig von der Klassifikation:
  // auch eine als phishing/unclear eingestufte Mail mit gültigem
  // List-Unsubscribe-Header kann der User hierüber manuell abmelden.
  async function handleUnsubscribe() {
    if (!message) return;
    setUnsubscribing(true);
    try {
      const res = await api.unsubscribeFromMessage(message.id);
      setUnsubscribeStatus(res.status);
    } finally {
      setUnsubscribing(false);
    }
  }

  async function handleMove(folderId: string) {
    if (!message || !folderId) return;
    setMoving(true);
    try {
      await api.moveMessage(message.id, folderId);
      onMoved(message.id, folderId);
    } finally {
      setMoving(false);
    }
  }

  async function handleDelete() {
    if (!message) return;
    setDeleting(true);
    try {
      await api.deleteMessage(message.id);
      onDeleted(message.id);
    } finally {
      setDeleting(false);
    }
  }

  async function handleSnooze(until: string) {
    if (!message) return;
    setSnoozing(true);
    try {
      await api.snoozeMessage(message.id, until);
      setSnoozeMenuOpen(false);
      onSnoozed(message.id);
    } finally {
      setSnoozing(false);
    }
  }

  async function handlePermanentDelete() {
    if (!message) return;
    if (!window.confirm("Diese Nachricht endgültig löschen? Das kann nicht rückgängig gemacht werden.")) {
      return;
    }
    setPermanentlyDeleting(true);
    try {
      await api.permanentlyDeleteMessage(message.id);
      onPermanentlyDeleted(message.id);
    } finally {
      setPermanentlyDeleting(false);
    }
  }

  return (
    <div className="detail-pane">
      <header className={`detail-header${strictUnknownSenders && isUnknownSender ? " detail-header-unknown-sender" : ""}`}>
        <div className="detail-subject-row">
          <h1>{message.subject}</h1>
          <SecurityBadge classification={message.classification} />
          <SecuritySignalBadges
            security={message.security}
            isNewSender={isUnknownSender}
            onTrustSender={() => onTrustSender(message.fromAddress)}
          />
        </div>
        <div className="detail-meta">
          <span>
            <strong>{message.fromDisplayName}</strong> &lt;{message.fromAddress}&gt;
          </span>
          <span>{formatDateTime(message.receivedAt)}</span>
        </div>
      </header>

      {isQuarantined && (
        <div className="quarantine-notice">
          Diese Nachricht liegt in Quarantäne — sie wird automatisch nach 30 Tagen gelöscht,
          falls sie nicht geprüft wird. Öffne nur Links oder Anhänge, wenn du dir absolut sicher bist.
        </div>
      )}

      {isInTrash && (
        <div className="trash-notice">
          Diese Nachricht liegt im Papierkorb. Verschiebe sie über „In Ordner verschieben…“ zurück
          oder lösche sie endgültig — anders als bei Quarantäne gibt es hier keine automatische Frist.
        </div>
      )}

      {/* [2026-09-21] WEB_INBOX.md "DREI WEITERE FEATURES - Gmail-
          Recherche" Punkt 3 ("Vertraulicher Modus"). */}
      {message.confidentialUntil && (
        <div className="quarantine-notice">
          {new Date(message.confidentialUntil).getTime() > Date.now()
            ? `Vertraulich bis ${formatDateTime(message.confidentialUntil)} — danach wird der Text automatisch gelöscht.`
            : "Diese Nachricht war vertraulich und ist inzwischen abgelaufen — der Text wurde serverseitig gelöscht."}
        </div>
      )}

      <section className="detail-section">
        <button type="button" className="link-button" onClick={() => setShowDetails((v) => !v)}>
          {showDetails ? "Sicherheits-Details ausblenden" : "Sicherheits-Details anzeigen"}
        </button>
        {showDetails && <SecurityDetails security={message.security} />}
      </section>

      <section className="detail-actions">
        {!isQuarantined && !isInTrash && (
          <button type="button" className="btn btn-danger-outline" onClick={handleQuarantine} disabled={quarantining}>
            {quarantining ? "Verschiebe…" : "In Quarantäne verschieben"}
          </button>
        )}
        {!isInTrash && (
          <button type="button" className="btn btn-danger-outline" onClick={handleDelete} disabled={deleting}>
            {deleting ? "Verschiebe…" : "Löschen"}
          </button>
        )}
        {isInTrash && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={handlePermanentDelete}
            disabled={permanentlyDeleting}
          >
            {permanentlyDeleting ? "Lösche…" : "Endgültig löschen"}
          </button>
        )}
        {/* Label-Umbenennung (zuletzt WEB_INBOX.md 21.09. "KLEINE LABEL-
            AENDERUNG", davor WEB_INBOX.md 09.09. "Ordner-Umbau-Eintrags",
            Punkt 2): reine UI-Textänderung, das Feld heißt technisch
            weiterhin summaryText. */}
        <button type="button" className="btn btn-secondary" onClick={loadSummary} disabled={summaryLoading}>
          {summaryLoading ? "Fasse zusammen…" : "Check Mail"}
        </button>
        {/* Antworten/Weiterleiten öffnen den gemeinsamen ComposeModal in
            App.tsx (siehe onReply/onForward-Kommentar oben). WEB_INBOX.md
            09.09. "KORREKTUR der letzten Regel" weiterhin gültig: Antworten
            ausgeblendet bei aktuellem Ordner spam (folderId-Check), nicht
            bei eingefrorenem classification='spam' -- Antworten auf Spam
            macht keinen Sinn, auf Phishing (Quarantäne) schon (User kann
            die Mail trotzdem sehen/melden, siehe Warnbanner oben).
            Weiterleiten (WEB_INBOX.md 21.09. "DREI WEITERE
            GRUNDFUNKTIONEN") ist unabhängig davon immer sinnvoll. */}
        {!isInSpam && (
          <button type="button" className="btn btn-secondary" onClick={() => onReply(message)}>
            Antworten
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => onForward(message)}>
          Weiterleiten
        </button>
        {/* [2026-09-21] WEB_INBOX.md "5 Wettbewerbs-Luecken" Punkt 5
            ("Snooze") -- ein paar sinnvolle Presets statt nur freier
            Datumsauswahl. */}
        <div className="snooze-menu-wrap">
          <button type="button" className="btn btn-secondary" onClick={() => setSnoozeMenuOpen((v) => !v)} disabled={snoozing}>
            {snoozing ? "…" : "Später erinnern"}
          </button>
          {snoozeMenuOpen && (
            <div className="snooze-menu">
              <button type="button" onClick={() => handleSnooze(snoozePresetDate("1h"))}>
                In 1 Stunde
              </button>
              <button type="button" onClick={() => handleSnooze(snoozePresetDate("tomorrow"))}>
                Morgen früh
              </button>
              <button type="button" onClick={() => handleSnooze(snoozePresetDate("nextWeek"))}>
                Nächste Woche
              </button>
            </div>
          )}
        </div>
        {/* Automatische Abmeldung bei Spam (WEB_INBOX.md 09.09.): manueller
            Abmelden-Button, unabhängig von der Klassifikation -- nur wenn
            die Nachricht einen gültigen List-Unsubscribe-Header hat.
            [2026-09-21] "LUECKE SCHLIESSEN": der Aufruf ist jetzt ein
            echter Netzwerk-Seiteneffekt und kann fehlschlagen -- bei
            status='failed' bleibt der Button sichtbar (erneuter Versuch
            möglich), statt den User mit einer stillen Fehlanzeige
            hängenzulassen. */}
        {message.canUnsubscribe && unsubscribeStatus !== "confirmed" && (
          <button type="button" className="btn btn-secondary" onClick={handleUnsubscribe} disabled={unsubscribing}>
            {unsubscribing ? "Melde ab…" : unsubscribeStatus === "failed" ? "Erneut versuchen" : "Von Absender abmelden"}
          </button>
        )}
        {unsubscribeStatus === "failed" && <span className="unsubscribe-status unsubscribe-status-failed">Abmeldung fehlgeschlagen</span>}
        {unsubscribeStatus === "confirmed" && <span className="unsubscribe-status">Abgemeldet</span>}
        <select
          className="move-select"
          value=""
          disabled={moving}
          onChange={(e) => {
            if (e.target.value) handleMove(e.target.value);
            e.target.value = "";
          }}
          aria-label="In anderen Ordner verschieben"
        >
          <option value="">{moving ? "Verschiebe…" : "In Ordner verschieben…"}</option>
          {folders
            .filter((f) => f.id !== message.folderId)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
      </section>

      {summary && (
        <section className="detail-card">
          <div className="detail-card-title">Zusammenfassung ({aiSourceLabel(summary.source)})</div>
          <p>{summary.summaryText}</p>
          {summary.actionRequired && (
            <p className="summary-action">
              Aktion nötig{summary.deadline ? ` bis ${new Date(summary.deadline).toLocaleDateString("de-DE")}` : ""}
              {summary.actionDescription ? `: ${summary.actionDescription}` : ""}
            </p>
          )}
        </section>
      )}

      {message.attachments.length > 0 && (
        <section className="detail-section">
          <ul className="attachment-list">
            {message.attachments.map((a) => (
              <li key={a.id} className={`attachment-item attachment-status-${a.scanStatus}`}>
                <span className="attachment-filename">{a.filename}</span>
                <span className="attachment-status">{scanStatusLabel(a.scanStatus)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="detail-body">
        {message.bodyText === null ? (
          <p className="detail-body-empty">Kein Inhalt mehr verfügbar.</p>
        ) : (
          message.bodyText.split("\n").map((line, i) => <p key={i}>{line || " "}</p>)
        )}
      </section>
    </div>
  );
}
