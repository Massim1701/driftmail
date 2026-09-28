#!/bin/zsh
# Baut driftmail.app (macOS) und installiert sie nach /Applications.
# [2026-09-28] Siehe mac/README.md. Keine Xcode-Projektdatei noetig:
# eine Swift-Datei, Info.plist und das App-Icon aus der iOS-Icon-Vorlage.
set -euo pipefail
cd "$(dirname "$0")"
BUILD=build
APP="$BUILD/driftmail.app"
ICON_SRC=../ios/DriftmailApp/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/Info.plist"

xcrun swiftc -O -target arm64-apple-macos14.0 \
  -framework AppKit -framework WebKit \
  Sources/main.swift -o "$APP/Contents/MacOS/driftmail"

# App-Icon: macOS-Icons haben (anders als iOS) eine eigene abgerundete
# Form mit Rand -- das volle Quadrat wird auf 824/1024 verkleinert und mit
# 185px-Radius abgerundet (Apples Icon-Raster), Rest transparent.
ICONSET="$BUILD/AppIcon.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
xcrun swift - "$ICON_SRC" "$BUILD/icon-mac-1024.png" <<'SWIFT'
import AppKit
let src = NSImage(contentsOfFile: CommandLine.arguments[1])!
let size: CGFloat = 1024, inset: CGFloat = 100, radius: CGFloat = 185
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
let rect = NSRect(x: inset, y: inset, width: size - 2 * inset, height: size - 2 * inset)
NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).addClip()
src.draw(in: rect)
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
SWIFT
for s in 16 32 128 256 512; do
  sips -z $s $s "$BUILD/icon-mac-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$BUILD/icon-mac-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

codesign --force --deep --sign - "$APP"

if [[ "${1:-}" == "--install" ]]; then
  rm -rf /Applications/driftmail.app
  cp -R "$APP" /Applications/
  echo "Installiert: /Applications/driftmail.app"
else
  echo "Gebaut: $APP (mit --install nach /Applications kopieren)"
fi
