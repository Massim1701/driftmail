import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, getStoredToken, setStoredToken } from "./api";
import type { Draft, Folder, MailAccount, Message, MessageDetail } from "./types";
import { FolderSidebar } from "./components/FolderSidebar";
import { MessageList } from "./components/MessageList";
import { DraftList } from "./components/DraftList";
import { MessageDetailPane } from "./components/MessageDetailPane";
import { OnboardingScreen } from "./components/OnboardingScreen";
import { AppLockGate } from "./components/AppLockGate";
import { ComposeModal, type ComposeMode } from "./components/ComposeModal";
import { AiSettingsModal } from "./components/AiSettingsModal";
import { SettingsModal } from "./components/SettingsModal";
import { applyAccentTheme } from "./accentThemes";
import { useTheme } from "./useTheme";
import { useAppLock } from "./useAppLock";
import "./App.css";

// [2026-09-10] echter Google-Login (backend/README.md "Echter
// Google-Login"): GET /auth/google/callback landet hier immer mit
// ?token=... (Erfolg) oder ?error=<code> (Fehlschlag) im Query-String --
// keine Router-Library im Projekt (siehe web/README.md), daher reines
// window.location-Parsing statt einer echten Route. Läuft außerhalb der
// Komponente, damit es garantiert vor dem ersten Render passiert (die
// erste request()-Anfrage in App.tsx braucht den Token bereits).
function consumeAuthCallback(): { error: string | null } {
  if (window.location.pathname !== "/auth/callback") return { error: null };
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const error = params.get("error");
  if (token) setStoredToken(token);
  // URL säubern (kein Token/Error mehr sichtbar, kein erneutes Verarbeiten
  // bei einem Reload), zurück zur Startseite.
  window.history.replaceState(null, "", "/");
  return { error: token ? null : (error ?? "token_exchange_failed") };
}

const authCallbackResult = consumeAuthCallback();

export default function App() {
  const [theme, setTheme] = useTheme();
  const appLock = useAppLock();
  // [2026-09-21] Mehrfach-Konten (WEB_INBOX.md 21.09. Punkt 2): mehrere
  // Konten statt eines einzelnen, "getrennte Ansichten pro Konto" --
  // activeAccountId bestimmt, welches Konto gerade angezeigt wird.
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [isAddingAccount, setIsAddingAccount] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  // Nur der EINE Fehler aus dem gerade konsumierten Callback (falls einer da
  // war) -- kein State-Update nötig, ändert sich nicht innerhalb einer
  // Seitenladung (ein erneuter Login-Versuch navigiert ohnehin komplett weg).
  const loginError = authCallbackResult.error;

  const [folders, setFolders] = useState<Folder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [messagesByFolder, setMessagesByFolder] = useState<Record<string, Message[]>>({});
  const [listLoading, setListLoading] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // "entwuerfe"-Systemordner (WEB_INBOX.md 09.09. "KORREKTUR/ERWEITERUNG des
  // Ordner-Umbau-Eintrags"): kommt aus GET /drafts, nicht aus listMessages().
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);

  // GET /trusted-senders (WEB_INBOX.md 15.09./19.09.): kombiniert sich mit
  // MessageDetail.isNewSender fuer die "Neuer Absender"-Badge (siehe
  // MessageDetailPane/SecuritySignalBadges) -- als Set fuer O(1)-Lookup.
  const [trustedSenderAddresses, setTrustedSenderAddresses] = useState<Set<string>>(new Set());

  const [error, setError] = useState<string | null>(null);

  // Compose (WEB_INBOX.md 21.09. "BUG - Massimo beim echten Live-Test
  // entdeckt" + "DREI WEITERE GRUNDFUNKTIONEN"): ein gemeinsamer Dialog für
  // neue Mail/Antworten/Weiterleiten, siehe ComposeModal.tsx.
  const [compose, setCompose] = useState<{ mode: ComposeMode; original: MessageDetail | null } | null>(null);

  // KI-Einstellungen (TERMINAL_INBOX.md 21.09. KORREKTUR): eigener Dialog,
  // siehe AiSettingsModal.tsx. Wird seit dem Einstellungsbereich (WEB_INBOX.md
  // 21.09.) aus SettingsModal heraus geöffnet, nicht mehr direkt aus der
  // Sidebar -- deshalb kann er zusätzlich zu settingsOpen offen sein
  // (stapelt sich einfach über den SettingsModal-Overlay, gleiches Prinzip
  // wie jeder andere Modal-über-Modal-Fall hier).
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  // [2026-09-21] WEB_INBOX.md 21.09. "Einstellungsbereich": gebündelter
  // Einstellungsbereich, siehe SettingsModal.tsx.
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Suche (WEB_INBOX.md 21.09. "DREI WEITERE GRUNDFUNKTIONEN", Punkt 2):
  // solange searchQuery gesetzt ist, ersetzt die Ergebnisliste die normale
  // Ordneransicht (kontoweit, nicht auf den aktuell aktiven Ordner
  // beschränkt -- der User weiß beim Suchen oft nicht mehr, in welchem
  // Ordner eine Mail liegt).
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Konten laden -- erst NACH erfolgreichem Login (token gesetzt), siehe
  // OnboardingScreen unten. Beim ersten Laden automatisch das erste Konto
  // aktivieren; ein späteres Neuladen (nach "Konto hinzufügen") rührt eine
  // bereits aktive Auswahl nicht an.
  const loadAccounts = useCallback(() => {
    return api
      .listAccounts()
      .then((accs) => {
        setAccounts(accs);
        setActiveAccountId((prev) => (prev && accs.some((a) => a.id === prev) ? prev : (accs[0]?.id ?? null)));
        setError(null);
        return accs;
      })
      .catch((err) => {
        // 401: gespeicherter Token war ungültig/abgelaufen (api.ts hat ihn
        // bereits aus localStorage entfernt) -- zurück zum LoginScreen,
        // statt in einer Fehlermeldung hängen zu bleiben.
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          return [];
        }
        setError("Server nicht erreichbar. Läuft Backend/Mock-Server?");
        return [];
      });
  }, []);

  useEffect(() => {
    if (!token) return;
    loadAccounts();
  }, [token, loadAccounts]);

  const loadFolder = useCallback((folderId: string) => {
    setListLoading(true);
    api
      .listMessages({ folderId })
      .then((msgs) => {
        setMessagesByFolder((prev) => ({ ...prev, [folderId]: msgs }));
        setError(null);
      })
      .catch(() => setError("Mock-Server nicht erreichbar. Läuft er auf Port 4000?"))
      .finally(() => setListLoading(false));
  }, []);

  // Ordner laden (System- und eigene) und initial den ersten sinnvollen Ordner
  // aktivieren -- erst NACH erfolgreichem Login UND sobald ein aktives Konto
  // feststeht. [2026-09-21] Mehrfach-Konten: scoped auf activeAccountId
  // ("getrennte Ansichten pro Konto") -- bei jedem Kontowechsel kompletter
  // Neustart des lokalen Nachrichten-/Auswahl-Zustands, alte Ordner-IDs
  // gehören zum vorherigen Konto und sind für das neue irrelevant.
  useEffect(() => {
    if (!token || !activeAccountId) return;
    setFoldersLoading(true);
    setMessagesByFolder({});
    setActiveFolder(null);
    setSelectedId(null);
    setSelectedDetail(null);
    setDrafts([]);
    api
      .listFolders(activeAccountId)
      .then((fs) => {
        const sorted = fs.slice().sort((a, b) => a.sortOrder - b.sortOrder);
        setFolders(sorted);
        setError(null);
        // [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09.): "eingang" ersetzt
        // "wichtig" als automatische Landezone/Standard-Startordner.
        setActiveFolder(sorted.find((f) => f.systemKey === "eingang")?.id ?? sorted[0]?.id ?? null);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          return;
        }
        setError("Server nicht erreichbar. Läuft Backend/Mock-Server?");
      })
      .finally(() => setFoldersLoading(false));
  }, [token, activeAccountId]);

  // Alle Ordner initial laden, damit die Sidebar-Zähler stimmen
  useEffect(() => {
    folders.forEach((f) => loadFolder(f.id));
  }, [folders, loadFolder]);

  // Suche (siehe searchQuery-Kommentar oben): leicht entprellt (250ms),
  // damit nicht bei jedem Tastendruck ein eigener Request rausgeht. Leerer
  // Suchbegriff löscht die Ergebnisse sofort, kein Request nötig.
  useEffect(() => {
    if (!activeAccountId || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    const handle = setTimeout(() => {
      api
        .listMessages({ accountId: activeAccountId, q: searchQuery.trim() })
        .then((msgs) => {
          setSearchResults(msgs);
          setError(null);
        })
        .catch(() => setError("Suche fehlgeschlagen. Bitte später erneut versuchen."))
        .finally(() => setSearchLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [activeAccountId, searchQuery]);

  // "Jetzt aktualisieren" (WEB_INBOX.md 21.09. "SEHR WICHTIGE LUECKE -
  // HOECHSTE PRIORITAET", Punkt 1): löst POST /accounts/{accountId}/sync
  // aus (sofortiger Mail-Abruf statt auf das automatische Backend-
  // Intervall zu warten) und lädt danach alle Ordner neu, damit neu
  // eingetroffene Mail sofort sichtbar wird.
  async function handleSyncNow() {
    if (!activeAccountId || isSyncing) return;
    setIsSyncing(true);
    try {
      await api.syncAccount(activeAccountId);
      folders.forEach((f) => loadFolder(f.id));
      setError(null);
    } catch {
      setError("Aktualisieren fehlgeschlagen. Bitte später erneut versuchen.");
    } finally {
      setIsSyncing(false);
    }
  }

  // [2026-09-21] Mehrfach-Konten: Kontowechsel selbst ist nur der State-
  // Wechsel -- der Ordner-Lade-Effekt oben reagiert auf activeAccountId und
  // übernimmt Laden/Reset.
  function handleSwitchAccount(accountId: string) {
    setActiveAccountId(accountId);
    setSearchQuery("");
  }

  // "Konto hinzufügen" (WEB_INBOX.md 21.09. "SEHR WICHTIGE LUECKE", Punkt
  // 2, Übergabe an Track F): öffnet denselben Onboarding-Bildschirm wie
  // beim Erst-Login, aber als Overlay über der bereits eingeloggten App
  // statt als Vollbild-Gate -- api.ts hängt den bereits gespeicherten
  // Token automatisch an, das Backend erkennt daran "weiteres Konto zu
  // bestehendem Login", siehe backend/README.md.
  function handleAddAccount() {
    setIsAddingAccount(true);
  }

  function handleAccountAdded(newAccount: MailAccount) {
    setIsAddingAccount(false);
    loadAccounts().then(() => setActiveAccountId(newAccount.id));
  }

  // "Absender vertrauen" direkt am "Neuer Absender"-Badge (WEB_INBOX.md
  // 21.09. "KLEINE VERKNUEPFUNG"): optimistisches Update (Badge verschwindet
  // sofort für alle Nachrichten dieses Absenders, nicht nur die aktuell
  // geöffnete), kein Neuladen der ganzen Liste nötig.
  function handleTrustSender(address: string) {
    api
      .addTrustedSender(address)
      .then(() => setTrustedSenderAddresses((prev) => new Set(prev).add(address)))
      .catch(() => setError("Absender konnte nicht zur Whitelist hinzugefügt werden."));
  }

  // [2026-09-21] WEB_INBOX.md 21.09. "Einstellungsbereich": gespeicherte
  // Akzentfarbe einmal nach Login laden und anwenden (applyAccentTheme
  // setzt --color-accent inline auf <html>, siehe accentThemes.ts). Kein
  // harter Fehler bei 401/Netzwerkfehler -- Default-Teal aus tokens.css
  // bleibt einfach stehen.
  useEffect(() => {
    if (!token) return;
    api
      .getSettings()
      .then((s) => applyAccentTheme(s.accentTheme))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (!token) return;
    api
      .listTrustedSenders()
      .then((list) => setTrustedSenderAddresses(new Set(list.map((s) => s.senderAddress))))
      .catch(() => {
        // Kein harter Fehler: ohne die Liste zeigt die "Neuer Absender"-Badge
        // im Zweifel einfach für alle isNewSender=true-Nachrichten an, statt
        // die ganze Detailansicht zu blockieren.
      });
  }, [token]);

  const loadDrafts = useCallback(() => {
    setDraftsLoading(true);
    api
      .listDrafts()
      .then(setDrafts)
      .catch(() => setError("Entwürfe konnten nicht geladen werden."))
      .finally(() => setDraftsLoading(false));
  }, []);

  // Entwürfe (GET /drafts) laden, sobald der "entwuerfe"-Ordner existiert --
  // separat von loadFolder() oben, weil Entwürfe nicht aus GET /messages
  // kommen (siehe DraftList-Kommentar).
  const entwuerfeFolder = useMemo(() => folders.find((f) => f.systemKey === "entwuerfe"), [folders]);
  useEffect(() => {
    if (entwuerfeFolder) loadDrafts();
  }, [entwuerfeFolder, loadDrafts]);

  const currentMessages = (activeFolder && messagesByFolder[activeFolder]) || [];

  const counts = useMemo(() => {
    const c: Partial<Record<string, number>> = {};
    for (const f of folders) c[f.id] = messagesByFolder[f.id]?.length ?? 0;
    if (entwuerfeFolder) c[entwuerfeFolder.id] = drafts.length;
    return c;
  }, [folders, messagesByFolder, entwuerfeFolder, drafts]);

  const quarantaeneFolder = useMemo(() => folders.find((f) => f.systemKey === "quarantaene"), [folders]);
  const papierkorbFolder = useMemo(() => folders.find((f) => f.systemKey === "papierkorb"), [folders]);
  const sonstigesFolder = useMemo(() => folders.find((f) => f.systemKey === "sonstiges"), [folders]);
  const gesendetFolder = useMemo(() => folders.find((f) => f.systemKey === "gesendet"), [folders]);
  const spamFolder = useMemo(() => folders.find((f) => f.systemKey === "spam"), [folders]);

  // POST /messages/send erfolgreich (WEB_INBOX.md 09.09. "KORREKTUR/
  // ERWEITERUNG des Ordner-Umbau-Eintrags"): das Backend hat lokal eine
  // neue Nachricht im "gesendet"-Ordner angelegt -- Zähler/Liste neu laden,
  // sonst bleibt der Sidebar-Zähler bis zum nächsten vollständigen Neuladen
  // falsch (0 statt der tatsächlichen Anzahl).
  function handleSent() {
    if (gesendetFolder) loadFolder(gesendetFolder.id);
  }

  function handleSelectFolder(folderId: string) {
    setActiveFolder(folderId);
    setSelectedId(null);
    setSelectedDetail(null);
    setSearchQuery("");
  }

  function handleNewMessage() {
    setCompose({ mode: "new", original: null });
  }

  function handleReply(message: MessageDetail) {
    setCompose({ mode: "reply", original: message });
  }

  function handleForward(message: MessageDetail) {
    setCompose({ mode: "forward", original: message });
  }

  function handleSelectMessage(id: string) {
    setSelectedId(id);
    setDetailLoading(true);
    api
      .getMessage(id)
      .then(setSelectedDetail)
      .catch(() => setError("Nachricht konnte nicht geladen werden."))
      .finally(() => setDetailLoading(false));
  }

  function handleQuarantined(id: string) {
    // Nachricht aus dem aktuellen Ordner entfernen und Quarantäne-Ordner neu laden
    if (activeFolder) {
      setMessagesByFolder((prev) => ({
        ...prev,
        [activeFolder]: (prev[activeFolder] ?? []).filter((m) => m.id !== id),
      }));
    }
    if (quarantaeneFolder) loadFolder(quarantaeneFolder.id);
    setSelectedId(null);
    setSelectedDetail(null);
  }

  function handleMoved(id: string, newFolderId: string) {
    // Nachricht ist jetzt in einem anderen Ordner: aktuellen Ordner + Zielordner neu laden
    if (activeFolder) {
      setMessagesByFolder((prev) => ({
        ...prev,
        [activeFolder]: (prev[activeFolder] ?? []).filter((m) => m.id !== id),
      }));
    }
    loadFolder(newFolderId);
    setSelectedId(null);
    setSelectedDetail(null);
  }

  function handleDeleted(id: string) {
    // Soft delete: Nachricht ist jetzt im Papierkorb (analog handleQuarantined/-Moved)
    if (activeFolder) {
      setMessagesByFolder((prev) => ({
        ...prev,
        [activeFolder]: (prev[activeFolder] ?? []).filter((m) => m.id !== id),
      }));
    }
    if (papierkorbFolder) loadFolder(papierkorbFolder.id);
    setSelectedId(null);
    setSelectedDetail(null);
  }

  function handlePermanentlyDeleted(id: string) {
    // Endgültig gelöscht: nur noch aus dem aktuellen (Papierkorb-)Ordner entfernen,
    // kein Zielordner zum Neuladen.
    if (activeFolder) {
      setMessagesByFolder((prev) => ({
        ...prev,
        [activeFolder]: (prev[activeFolder] ?? []).filter((m) => m.id !== id),
      }));
    }
    setSelectedId(null);
    setSelectedDetail(null);
  }

  function handleCreateFolder(name: string) {
    if (!activeAccountId) return;
    api
      .createFolder({ name, accountId: activeAccountId })
      .then((folder) => {
        setFolders((prev) => [...prev, folder].sort((a, b) => a.sortOrder - b.sortOrder));
        setMessagesByFolder((prev) => ({ ...prev, [folder.id]: [] }));
        setError(null);
      })
      .catch(() => setError("Ordner konnte nicht angelegt werden."));
  }

  function handleRenameFolder(folderId: string, name: string) {
    api
      .updateFolder(folderId, { name })
      .then((updated) => {
        setFolders((prev) => prev.map((f) => (f.id === folderId ? updated : f)));
        setError(null);
      })
      .catch(() => setError("Ordner konnte nicht umbenannt werden."));
  }

  function handleDeleteFolder(folderId: string) {
    api
      .deleteFolder(folderId)
      .then(() => {
        setFolders((prev) => prev.filter((f) => f.id !== folderId));
        setMessagesByFolder((prev) => {
          const rest = { ...prev };
          delete rest[folderId];
          return rest;
        });
        // Enthaltene Nachrichten sind laut Mock-Server-Vertrag nach "Sonstiges" gewandert
        if (sonstigesFolder) loadFolder(sonstigesFolder.id);
        if (activeFolder === folderId) {
          setActiveFolder(sonstigesFolder?.id ?? null);
          setSelectedId(null);
          setSelectedDetail(null);
        }
        setError(null);
      })
      .catch(() => setError("Ordner konnte nicht gelöscht werden."));
  }

  const activeFolderDef = folders.find((f) => f.id === activeFolder) ?? null;
  const isQuarantineFolder = activeFolderDef?.systemKey === "quarantaene";
  const isPapierkorbFolder = activeFolderDef?.systemKey === "papierkorb";
  const isEntwuerfeFolder = activeFolderDef?.systemKey === "entwuerfe";
  const isSearching = searchQuery.trim().length > 0;

  function handleDeleteDraft(id: string) {
    api
      .deleteDraft(id)
      .then(() => {
        setDrafts((prev) => prev.filter((d) => d.id !== id));
        setError(null);
      })
      .catch(() => setError("Entwurf konnte nicht gelöscht werden."));
  }

  // [2026-09-10] echter Google-Login: ohne Token keine Anfragen an die API
  // (die würden ohnehin alle mit 401 scheitern) -- stattdessen der
  // OnboardingScreen (Provider-Auswahl + IMAP-Formular, WEB_INBOX.md 19.09.).
  // Der Gmail-Zweig dort navigiert per echtem Redirect zu
  // GET /auth/google/start, kein clientseitiger State-Übergang; der IMAP-
  // Zweig ruft onConnected() mit dem neuen Token auf.
  if (!token) {
    return <OnboardingScreen error={loginError} onConnected={setToken} />;
  }

  if (foldersLoading) {
    return <div className="app-shell app-loading">Lade…</div>;
  }

  // [2026-09-21] Mehrfach-Konten: "Konto hinzufügen" öffnet denselben
  // Onboarding-Bildschirm als Overlay über der bereits eingeloggten App
  // (nicht als Vollbild-Gate wie beim Erst-Login) -- api.ts hängt den
  // bestehenden Token automatisch an jeden Request, das Backend erkennt
  // daran "weiteres Konto zu bestehendem Login" statt eines neuen Users.
  if (isAddingAccount) {
    return (
      <OnboardingScreen
        error={null}
        mode="addAccount"
        onCancel={() => setIsAddingAccount(false)}
        onConnected={() => {}}
        onAccountAdded={handleAccountAdded}
      />
    );
  }

  return (
    <AppLockGate locked={appLock.locked} unlocking={appLock.unlocking} unlockError={appLock.unlockError} onUnlock={appLock.unlock}>
      <div className="app-shell">
        <FolderSidebar
          folders={folders}
          active={activeFolder}
          onSelect={handleSelectFolder}
          counts={counts}
          accounts={accounts}
          activeAccountId={activeAccountId}
          onSwitchAccount={handleSwitchAccount}
          onAddAccount={handleAddAccount}
          onSyncNow={handleSyncNow}
          isSyncing={isSyncing}
          onNewMessage={handleNewMessage}
          theme={theme}
          onThemeChange={setTheme}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="message-column">
          <div className="message-column-header">
            <h2>{isSearching ? `Suche: „${searchQuery.trim()}“` : (activeFolderDef?.name ?? "—")}</h2>
            <span className="message-column-count">
              {isSearching ? searchResults.length : isEntwuerfeFolder ? drafts.length : currentMessages.length}
            </span>
          </div>
          {/* Suche (WEB_INBOX.md 21.09. "DREI WEITERE GRUNDFUNKTIONEN",
              Punkt 2): kontoweit, ersetzt bei nicht-leerem Suchbegriff die
              Ordner-/Entwürfe-Ansicht darunter (siehe searchQuery-Kommentar
              oben). */}
          <input
            type="search"
            className="message-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Nach Betreff, Absender oder Inhalt suchen…"
            aria-label="Mails durchsuchen"
          />
          {error && <div className="app-error">{error}</div>}
          {isSearching ? (
            <MessageList
              messages={searchResults}
              selectedId={selectedId}
              onSelect={handleSelectMessage}
              loading={searchLoading && searchResults.length === 0}
              emptyLabel="Keine Treffer."
            />
          ) : isEntwuerfeFolder ? (
            <DraftList drafts={drafts} loading={draftsLoading && drafts.length === 0} onDelete={handleDeleteDraft} />
          ) : (
            <MessageList
              messages={currentMessages}
              selectedId={selectedId}
              onSelect={handleSelectMessage}
              loading={listLoading && currentMessages.length === 0}
              emptyLabel={
                isQuarantineFolder
                  ? "Keine Nachrichten in Quarantäne."
                  : isPapierkorbFolder
                    ? "Papierkorb ist leer."
                    : "Keine Nachrichten in diesem Ordner."
              }
            />
          )}
        </div>

        <MessageDetailPane
          message={selectedDetail}
          loading={detailLoading}
          folders={folders}
          quarantaeneFolderId={quarantaeneFolder?.id ?? null}
          papierkorbFolderId={papierkorbFolder?.id ?? null}
          spamFolderId={spamFolder?.id ?? null}
          trustedSenderAddresses={trustedSenderAddresses}
          onTrustSender={handleTrustSender}
          onQuarantined={handleQuarantined}
          onMoved={handleMoved}
          onDeleted={handleDeleted}
          onPermanentlyDeleted={handlePermanentlyDeleted}
          onReply={handleReply}
          onForward={handleForward}
        />
      </div>

      {compose && (
        <ComposeModal
          mode={compose.mode}
          accounts={accounts}
          defaultAccountId={activeAccountId}
          original={compose.original}
          onClose={() => setCompose(null)}
          onSent={handleSent}
        />
      )}

      {aiSettingsOpen && <AiSettingsModal onClose={() => setAiSettingsOpen(false)} />}

      {settingsOpen && (
        <SettingsModal
          accounts={accounts}
          onAccountRemoved={() => loadAccounts()}
          onAddAccount={handleAddAccount}
          appLockSupported={appLock.supported}
          appLockEnabled={appLock.enabled}
          onAppLockChange={appLock.setEnabled}
          onOpenAiSettings={() => setAiSettingsOpen(true)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </AppLockGate>
  );
}
