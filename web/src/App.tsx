import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Folder, MailAccount, Message, MessageDetail } from "./types";
import { FolderSidebar } from "./components/FolderSidebar";
import { MessageList } from "./components/MessageList";
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
        setActiveFolder((prev) => prev ?? sorted.find((f) => f.systemKey === "wichtig")?.id ?? sorted[0]?.id ?? null);
      })
      .catch(() => setError("Mock-Server nicht erreichbar. Läuft er auf Port 4000?"))
      .finally(() => setFoldersLoading(false));
  }, []);

  // Alle Ordner initial laden, damit die Sidebar-Zähler stimmen
  useEffect(() => {
    folders.forEach((f) => loadFolder(f.id));
  }, [folders, loadFolder]);

  const currentMessages = (activeFolder && messagesByFolder[activeFolder]) || [];

  const counts = useMemo(() => {
    const c: Partial<Record<string, number>> = {};
    for (const f of folders) c[f.id] = messagesByFolder[f.id]?.length ?? 0;
    return c;
  }, [folders, messagesByFolder]);

  const quarantaeneFolder = useMemo(() => folders.find((f) => f.systemKey === "quarantaene"), [folders]);
  const papierkorbFolder = useMemo(() => folders.find((f) => f.systemKey === "papierkorb"), [folders]);
  const sonstigesFolder = useMemo(() => folders.find((f) => f.systemKey === "sonstiges"), [folders]);

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
          <span className="message-column-count">{currentMessages.length}</span>
        </div>
        {error && <div className="app-error">{error}</div>}
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
      />
    </div>
  );
}
