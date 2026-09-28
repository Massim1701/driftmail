# driftmail für macOS

Schlanke native Mac-App (Swift/AppKit + WKWebView), die den Web-Client in der
Desktop-Ansicht zeigt. Keine eigene Oberflächenlogik -- Web und Mac teilen
denselben Code (`web/`). Die Hülle ergänzt Dock-Symbol, Menüs (Kopieren/
Einfügen, Neu laden ⌘R, Vollbild), Datei-Dialog für Anhänge, JavaScript-
Rückfragen und öffnet externe Links im Standard-Browser.

## Bauen und installieren

```sh
mac/build.sh --install   # -> /Applications/driftmail.app
```

Braucht nur die Xcode-Kommandozeilenwerkzeuge, keine Xcode-Projektdatei und
kein Apple-Konto (lokal signiert). Das App-Icon entsteht aus
`ios/.../AppIcon-1024.png` im macOS-Raster (abgerundet, mit Rand).

## Server

Die App lädt `http://localhost:3000/` (änderbar per Umgebungsvariable
`DRIFTMAIL_URL`). Dort läuft das lokale Backend, das den gebauten
Web-Client mit ausliefert (`WEB_DIST_DIR`, siehe `backend/src/app.ts`).
Einrichtung dieses Macs: siehe SYNC.md 28.09. "Lokaler Server".

Nach Änderungen am Web-Client neu bauen:

```sh
cd web && VITE_API_BASE_URL=/v1 npx vite build
```

(Kein Neustart der App nötig, ⌘R lädt neu.)
