import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Draft, Folder, MailAccount, Message, MessageDetail } from "./types";
import { FolderSidebar } from "./components/FolderSidebar";
import { MessageList } from "./components/MessageList";
import { DraftList } from "./components/DraftList";
import { MessageDetailPane } from "./components/MessageDetailPane";
import { useTheme } from "./useTheme";
import "./App.css";

export default function App() {
  const [theme, setTheme] = useTheme();
  const [account, setAccount] = useState<MailAccount | null>(null);

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

  const [error, setError] = useState<string | null>(null);

  // Konto laden (nur für Anzeige der E-Mail-Adresse im Sidebar-Header)
  useEffect(() => {
    api
      .listAccounts()
      .then((accs) => setAccount(accs[0] ?? null))
      .catch(() => setError("Mock-Server nicht erreichbar. Läuft er auf Port 4000?"));
  }, []);

  const loadFolder = useCallback((folderId: string) => {
    setListLoading(true);
    api
      .listMessages(folderId)
      .then((msgs) => {
        setMessagesByFolder((prev) => ({ ...prev, [folderId]: msgs }));
        setError(null);
      })
      .catch(() => setError("Mock-Server nicht erreichbar. Läuft er auf Port 4000?"))
      .finally(() => setListLoading(false));
  }, []);

  // Ordner laden (System- und eigene) und initial den ersten sinnvollen Ordner aktivieren
  useEffect(() => {
    api
      .listFolders()
      .then((fs) => {
        const sorted = fs.slice().sort((a, b) => a.sortOrder - b.sortOrder);
        setFolders(sorted);
        setError(null);
        // [2026-09-10] Ordner-Umbau (WEB_INBOX.md 09.09.): "eingang" ersetzt
        // "wichtig" als automatische Landezone/Standard-Startordner.
        setActiveFolder((prev) => prev ?? sorted.find((f) => f.systemKey === "eingang")?.id ?? sorted[0]?.id ?? null);
      })
      .catch(() => setError("Mock-Server nicht erreichbar. Läuft er auf Port 4000?"))
      .finally(() => setFoldersLoading(false));
  }, []);

  // Alle Ordner initial laden, damit die Sidebar-Zähler stimmen
  useEffect(() => {
    folders.forEach((f) => loadFolder(f.id));
  }, [folders, loadFolder]);

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
    api
      .createFolder({ name })
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

  function handleDeleteDraft(id: string) {
    api
      .deleteDraft(id)
      .then(() => {
        setDrafts((prev) => prev.filter((d) => d.id !== id));
        setError(null);
      })
      .catch(() => setError("Entwurf konnte nicht gelöscht werden."));
  }

  if (foldersLoading) {
    return <div className="app-shell app-loading">Lade…</div>;
  }

  return (
    <div className="app-shell">
      <FolderSidebar
        folders={folders}
        active={activeFolder}
        onSelect={handleSelectFolder}
        counts={counts}
        accountEmail={account?.emailAddress}
        theme={theme}
        onThemeChange={setTheme}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
      />

      <div className="message-column">
        <div className="message-column-header">
          <h2>{activeFolderDef?.name ?? "—"}</h2>
          <span className="message-column-count">{isEntwuerfeFolder ? drafts.length : currentMessages.length}</span>
        </div>
        {error && <div className="app-error">{error}</div>}
        {isEntwuerfeFolder ? (
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
        onQuarantined={handleQuarantined}
        onMoved={handleMoved}
        onDeleted={handleDeleted}
        onPermanentlyDeleted={handlePermanentlyDeleted}
        onSent={handleSent}
      />
    </div>
  );
}
