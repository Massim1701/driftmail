// driftmail — Ordner-Icons im 3D/Facetten-Stil (Web)
//
// [2026-09-25] TERMINAL_INBOX.md 25.09. Punkt 3 ("Vier Ordner-Icons")
// -- gehört zu WEB_INBOX.md 24.09. "ORDNER-ICONS - 3D/Facetten-Stil".
// Referenz: contracts/design-tokens.json "systemFolders.facetIconStyle"
// (Motiv-Beschreibungen + feste Farbwerte, KEINE currentColor-Vererbung wie
// die restlichen Zeilen-Icons in icons.tsx -- diese vier bringen ihre Farbe
// fest mit, siehe FolderSidebar.tsx). iOS hat dieselbe Optik als PNG-Assets
// (Assets.xcassets/FolderIcon*), hier stattdessen inline-SVG (kein Build-
// Schritt für Rasterbilder auf Web nötig).
//
// WICHTIGE LEHRE aus dem iOS-Gesendet-Icon (TERMINAL_INBOX.md 25.09.,
// Nachbesserung nach "wirkt wie ein duenner Strich bei echter Groesse"):
// bei der TATSAECHLICHEN Zielgroesse (24px) geprüft, nicht nur in einer
// großen Vorschau -- deshalb hier bewusst grobe, randnahe Flächen statt
// filigraner Linien. Alle vier Icons rendern fest bei 24x24 (kein Skalieren
// auf 16px wie die einfarbigen Stroke-Icons in icons.tsx).

import type { SVGProps } from "react";

function FacetSvg(props: SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" width={24} height={24} aria-hidden="true" {...props} />;
}

// systemFolders.facetIconStyle.shadowEllipse
const SHADOW_ELLIPSE = "#E1DFDD";

function ShadowEllipse() {
  return <ellipse cx="12" cy="20.3" rx="7.2" ry="1.6" fill={SHADOW_ELLIPSE} />;
}

// eingang: "Briefumschlag, hellere Flap-Flaeche oben, zwei dunklere
// Seiten-Facetten". colors: base #0078D4, light #5EB1EC, dark #106EBE.
export function FacetIconEingang(props: SVGProps<SVGSVGElement>) {
  return (
    <FacetSvg {...props}>
      <ShadowEllipse />
      {/* Umschlag-Koerper */}
      <rect x="3.5" y="7" width="17" height="12" rx="2" fill="#0078D4" />
      {/* zwei dunklere Seiten-Facetten (linke/rechte untere Ecke) */}
      <path d="M3.5 9 12 15.5 3.5 17.5z" fill="#106EBE" />
      <path d="M20.5 9 12 15.5 20.5 17.5z" fill="#106EBE" />
      {/* hellere, offene Flap-Flaeche oben */}
      <path d="M3.5 9c0-1.1.9-2 2-2h13c1.1 0 2 .9 2 2l-8.5 6.5z" fill="#5EB1EC" />
    </FacetSvg>
  );
}

// gesendet: "EIN grosses, massives Dreieck (nose rechts, breiter
// Fluegel oben-links, Rumpf unten), per diagonaler Falzlinie ... in zwei
// Facetten geteilt ... kleiner dunkler Heck-Akzent-Keil an der Ruecklinie."
// colors: base #0078D4, light #8ECBF5, dark #106EBE, darkest #004578
// (nur fuer den kleinen Heck-Akzent).
export function FacetIconGesendet(props: SVGProps<SVGSVGElement>) {
  return (
    <FacetSvg {...props}>
      <ShadowEllipse />
      {/* Ruecklinie (Fluegelspitze oben-links bis Rumpfende unten-links) */}
      <path d="M4 5.5 20 11 8.5 19.5z" fill="#106EBE" />
      {/* obere, groessere Facette (Fluegel) -- durch die Falzlinie nose->Ruecklinie abgetrennt */}
      <path d="M4 5.5 20 11 9.8 12.7z" fill="#8ECBF5" />
      {/* untere Facette (Rumpf), gleiche Grundfarbe wie der Umschlag-Koerper oben, damit alle vier Icons zusammen wirken */}
      <path d="M9.8 12.7 20 11 8.5 19.5z" fill="#0078D4" />
      {/* kleiner dunkler Heck-Akzent-Keil an der Ruecklinie */}
      <path d="M4 5.5 7.2 6.6 5.4 9.2z" fill="#004578" />
    </FacetSvg>
  );
}

// quarantaene: "Warndreieck in Amber/Gelb mit dunklerem Ausrufezeichen".
// colors: base #F0A800, light #FFCB5C, dark #7A4D00.
export function FacetIconQuarantaene(props: SVGProps<SVGSVGElement>) {
  return (
    <FacetSvg {...props}>
      <ShadowEllipse />
      <path d="M12 3.2 21 18.5H3z" fill="#F0A800" />
      {/* helle Facette entlang der linken Kante, deutet Lichteinfall an */}
      <path d="M12 3.2 3 18.5 8.5 18.5 12 8.5z" fill="#FFCB5C" />
      <rect x="10.9" y="9.5" width="2.2" height="5.5" rx="1.1" fill="#7A4D00" />
      <circle cx="12" cy="16.6" r="1.15" fill="#7A4D00" />
    </FacetSvg>
  );
}

// papierkorb: "Echter Papierkorb, leicht konisch (oben breiter als unten),
// sichtbare vertikale Gitterstaebe -- explizit KEINE eckige Muelltonne".
// colors: base #A19F9D, light #C8C6C4, dark #8A8886.
export function FacetIconPapierkorb(props: SVGProps<SVGSVGElement>) {
  return (
    <FacetSvg {...props}>
      <ShadowEllipse />
      {/* konischer Koerper (oben breiter) */}
      <path d="M5.5 8.5h13L17 19.5c-.1.7-.7 1.2-1.4 1.2H8.4c-.7 0-1.3-.5-1.4-1.2z" fill="#A19F9D" />
      {/* hellere Facette rechts, deutet Rundung/Tiefe an */}
      <path d="M13 8.5h5.5L17 19.5c-.1.7-.7 1.2-1.4 1.2h-1.2z" fill="#C8C6C4" />
      {/* oberer Rand/Henkel-Band, dunkler */}
      <rect x="4.5" y="6.3" width="15" height="2.4" rx="1.2" fill="#8A8886" />
      {/* vertikale Gitterstaebe */}
      <rect x="9.4" y="10.5" width="1.3" height="7.5" rx="0.6" fill="#8A8886" />
      <rect x="14.3" y="10.5" width="1.3" height="7.5" rx="0.6" fill="#8A8886" opacity="0.85" />
    </FacetSvg>
  );
}

// [2026-09-25] Kleines, gemeinsames Lookup analog FOLDER_ICONS (icons.tsx)
// -- Schlüssel sind dieselben systemKey-Werte wie in
// contracts/design-tokens.json "systemFolders.defaults[].systemKey".
// NUR diese vier (siehe Contract-Note: "Restliche Ordner-Icons ... bleiben
// einfarbige System-Icons, kein Facetten-Redesign dafuer vorgegeben").
export const FACET_ICONS: Record<string, (p: SVGProps<SVGSVGElement>) => import("react").ReactElement> = {
  eingang: FacetIconEingang,
  gesendet: FacetIconGesendet,
  quarantaene: FacetIconQuarantaene,
  papierkorb: FacetIconPapierkorb,
};
