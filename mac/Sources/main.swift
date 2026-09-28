// driftmail für macOS -- schlanke native Hülle um den Web-Client.
//
// [2026-09-28] Massimo: "erstelle eine App auf dem Mac" (Desktop-Ansicht).
// Zeigt den Web-Client (Drei-Spalten-Ansicht aus dem Redesign), den das
// lokale Backend unter http://localhost:3000 mit ausliefert (siehe
// backend/src/app.ts WEB_DIST_DIR, SYNC.md 28.09. "Lokaler Server").
// Bewusst ohne eigene Oberflächenlogik: Web und Mac teilen sich denselben
// Code, die Hülle ergänzt nur, was ein Browser-Fenster nicht mitbringt
// (Dock-Symbol, Menüs mit Kopieren/Einfügen, Datei-Dialog für Anhänge,
// JavaScript-Rückfragen, externe Links im Standard-Browser).

import AppKit
import WebKit

let serverURL = URL(string: ProcessInfo.processInfo.environment["DRIFTMAIL_URL"] ?? "http://localhost:3000/")!

/// Hosts, die im App-Fenster bleiben: der eigene Server und der Google-Login
/// (dessen Weiterleitung führt zurück auf den eigenen Server). Alles andere
/// -- Links in Mails, Hilfe-Seiten -- öffnet der Standard-Browser.
func staysInApp(_ url: URL) -> Bool {
    guard let host = url.host?.lowercased() else { return true }
    if host == serverURL.host?.lowercased() { return true }
    return host == "accounts.google.com" || host.hasSuffix(".google.com") && url.path.hasPrefix("/o/oauth2")
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // Anmeldung (Token) bleibt über Neustarts erhalten
        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.setValue(false, forKey: "drawsBackground")

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "driftmail"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 960, height: 600)
        window.contentView = webView
        window.center()
        window.setFrameAutosaveName("driftmailMainWindow")
        window.makeKeyAndOrderFront(nil)

        load()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    @objc func load() {
        webView.load(URLRequest(url: serverURL))
    }

    @objc func reload() {
        if webView.url == nil || webView.url?.host != serverURL.host { load() } else { webView.reload() }
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.allow) }
        if url.scheme == "about" || url.scheme == "data" || url.scheme == "blob" || staysInApp(url) {
            return decisionHandler(.allow)
        }
        // Nur echte Navigationen des Hauptfensters nach draußen umleiten;
        // eingebettete Inhalte (z.B. der Mail-Text im iframe) laden normal.
        if action.targetFrame?.isMainFrame == false {
            return decisionHandler(.allow)
        }
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showOfflinePage()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showOfflinePage() }
    }

    private func showOfflinePage() {
        let html = """
        <!doctype html><html lang="de"><meta charset="utf-8">
        <style>
          :root { color-scheme: light dark; }
          body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center;
                 font: 15px -apple-system, system-ui; background:#F6F4EE; color:#1F2A24; }
          @media (prefers-color-scheme: dark) { body { background:#121714; color:#E9EEE8; } p { color:#A9B4AC !important; } }
          .box { text-align:center; max-width:420px; padding:24px; }
          h1 { font: 500 26px "New York", Georgia, serif; margin:0 0 10px; }
          p { color:#4A554E; line-height:1.5; margin:0 0 20px; }
          a { display:inline-block; padding:10px 18px; border-radius:10px; background:#2A7D50; color:#fff; text-decoration:none; font-weight:600; }
        </style>
        <div class="box"><h1>Server nicht erreichbar</h1>
        <p>driftmail findet den lokalen Server unter \(serverURL.absoluteString) nicht. Er startet normalerweise automatisch mit dem Mac.</p>
        <a href="\(serverURL.absoluteString)">Erneut versuchen</a></div>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    // MARK: Fenster, Dialoge, Dateien

    /// target="_blank" / window.open: außerhalb des eigenen Servers im
    /// Standard-Browser öffnen, sonst im selben Fenster.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if staysInApp(url) { webView.load(action.request) } else { NSWorkspace.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Abbrechen")
        alert.beginSheetModal(for: window) { response in completionHandler(response == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    // MARK: Menü

    private func buildMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Über driftmail", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "driftmail ausblenden", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Andere ausblenden", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Alle einblenden", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "driftmail beenden", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        // Ohne Bearbeiten-Menü funktionieren Cmd+C/V/X/A im Web-Inhalt nicht.
        let editItem = NSMenuItem()
        let edit = NSMenu(title: "Bearbeiten")
        edit.addItem(withTitle: "Widerrufen", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Wiederholen", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Ausschneiden", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Kopieren", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Einsetzen", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Alles auswählen", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        main.addItem(editItem)

        let viewItem = NSMenuItem()
        let view = NSMenu(title: "Darstellung")
        let reloadItem = view.addItem(withTitle: "Neu laden", action: #selector(reload), keyEquivalent: "r")
        reloadItem.target = self
        view.addItem(.separator())
        let fullscreen = view.addItem(withTitle: "Vollbild", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = view
        main.addItem(viewItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Fenster")
        windowMenu.addItem(withTitle: "Im Dock ablegen", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoomen", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Fenster schließen", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
