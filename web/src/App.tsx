import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Folder, MailAccount, Message, MessageDetail } from "./types";
import { FolderSidebar, FOLDERS } from "./components/FolderSidebar";
import { MessageList } from "./components/MessageList";
import { MessageDetailPane } from "./components/MessageDetailPane";
import { useTheme } from "./useTheme";
import "./App.css";

export default function App() {
  const [theme, setTheme] = useTheme();
  const [account, setAccount] = useState<MailAccount | null>(null);

  const [activeFolder, setActiveFolder] = useState<Folder>("wichtig");
  const [messagesByFolder, setMessagesByFolder] = useState<Partial<Record<Folder, Message[]>>>({});
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

  const loadFolder = useCallback((folder: Folder) => {
    setListLoading(true);
    api
      .listMessages(folder)
      .then((msgs) => {
        setMessagesByFolder((prev) => ({ ...prev, [folder]: msgs }));
        setError(null);
      })
      .catch(() => setError("Mock-Server nicht erreichbar. Läuft er auf Port 4000?"))
      .finally(() => setListLoading(false));
  }, []);

  // Alle Ordner initial laden, damit die Sidebar-Zähler stimmen
  useEffect(() => {
    FOLDERS.forEach((f) => loadFolder(f.key));
  }, [loadFolder]);

  const currentMessages = messagesByFolder[activeFolder] ?? [];

  const counts = useMemo(() => {
    const c: Partial<Record<Folder, number>> = {};
    for (const f of FOLDERS) c[f.key] = messagesByFolder[f.key]?.length ?? 0;
    return c;
  }, [messagesByFolder]);

  function handleSelectFolder(folder: Folder) {
    setActiveFolder(folder);
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
    setMessagesByFolder((prev) => ({
      ...prev,
      [activeFolder]: (prev[activeFolder] ?? []).filter((m) => m.id !== id),
    }));
    loadFolder("quarantaene");
    setSelectedId(null);
    setSelectedDetail(null);
  }

  const activeFolderDef = FOLDERS.find((f) => f.key === activeFolder)!;

  return (
    <div className="app-shell">
      <FolderSidebar
        active={activeFolder}
        onSelect={handleSelectFolder}
        counts={counts}
        accountEmail={account?.emailAddress}
        theme={theme}
        onThemeChange={setTheme}
      />

      <div className="message-column">
        <div className="message-column-header">
          <h2>{activeFolderDef.label}</h2>
          <span className="message-column-count">{currentMessages.length}</span>
        </div>
        {error && <div className="app-error">{error}</div>}
        <MessageList
          messages={currentMessages}
          selectedId={selectedId}
          onSelect={handleSelectMessage}
          loading={listLoading && currentMessages.length === 0}
          emptyLabel={
            activeFolder === "quarantaene"
              ? "Keine Nachrichten in Quarantäne."
              : "Keine Nachrichten in diesem Ordner."
          }
        />
      </div>

      <MessageDetailPane message={selectedDetail} loading={detailLoading} onQuarantined={handleQuarantined} />
    </div>
  );
}
