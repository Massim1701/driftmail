// driftmail — saisonaler Zweig (Sidebar, Anmeldung, leerer Eingang)
//
// [2026-09-28] Massimo: der botanische Zweig wechselt mit der Jahreszeit
// (Frühling Kirschblüte, Sommer Gänseblümchen, Herbst Ahorn, Weihnachten
// Tanne, Winter Schnee). Zeiträume und Farben 1:1 aus
// contracts/design-tokens.json "seasonalTwig". Feste Farben je Saison,
// bewusst NICHT die Akzentfarbe (Herbstlaub bleibt rostrot, auch bei
// Akzent Blau). Alle Formen sind eigene Pfade, keine fremden Icon-Sets.

import type { ReactElement, SVGProps } from "react";
import type { Season } from "./season";
import "./seasonalTwig.css";

const MAPLE =
  "M0 -18 L4 -10 L10 -13 L8.5 -5 L16 -6.5 L12 0 L18 4 L8 5.5 L9 12 L2 8 L0 10 L-2 8 L-9 12 L-8 5.5 L-18 4 L-12 0 L-16 -6.5 L-8.5 -5 L-10 -13 L-4 -10 Z";
const MAPLE_VEINS = "M0 8 L0 -13 M0 3 L-12 -3 M0 3 L12 -3 M0 -3 L-6 -9 M0 -3 L6 -9";
const MAPLE_STEM = "M0 9 L0 20";
const SNOWFLAKE = "M0 -6 L0 6 M-5.2 -3 L5.2 3 M-5.2 3 L5.2 -3";

function firNeedles(offset: number, scale: number): string {
  let d = "";
  for (let x = 4; x <= 92; x += 6) {
    const len = x > 80 ? 6 : 9;
    const x0 = x + offset;
    const dx = len * (offset ? 0.8 : 1);
    const dy = ((len - 1) * scale).toFixed(1);
    d += `M${x0} 0 L${x0 + dx} -${dy} M${x0} 0 L${x0 + dx} ${dy} `;
  }
  return d.trim();
}
const FIR_DARK = firNeedles(0, 1);
const FIR_LIGHT = firNeedles(3, 0.55);

function Blossom({ x, y, scale = 1, petal }: { x: number; y: number; scale?: number; petal: string }) {
  const offsets: [number, number][] = [[0, -4.5], [4.3, -1.4], [2.6, 3.6], [-2.6, 3.6], [-4.3, -1.4]];
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {offsets.map(([cx, cy]) => (
        <circle key={`${cx},${cy}`} cx={cx} cy={cy} r="4" fill={petal} stroke="#D97A96" strokeWidth="0.6" />
      ))}
      <circle r="1.8" fill="#E0A33A" />
    </g>
  );
}

function Maple({ x, y, rotate, scale, fill, stroke, veins }: { x: number; y: number; rotate: number; scale: number; fill: string; stroke: string; veins?: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
      <path d={MAPLE_STEM} stroke={stroke} strokeWidth="1.2" strokeLinecap="round" />
      <path d={MAPLE} fill={fill} stroke={stroke} strokeWidth="0.9" strokeLinejoin="round" />
      {veins && <path d={MAPLE_VEINS} fill="none" stroke={veins} strokeWidth="0.7" strokeLinecap="round" opacity="0.8" />}
    </g>
  );
}

function Spring() {
  return (
    <>
      <path d="M8 90 C 36 72, 64 52, 110 12" fill="none" stroke="#7A5A44" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M58 56 C 62 46, 60 38, 54 32" fill="none" stroke="#7A5A44" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M34 76 C 30 66, 34 58, 42 55 C 44 64, 40 71, 34 76 Z" fill="#CFE5B8" stroke="#6E9E4E" strokeWidth="0.9" />
      <path d="M84 34 C 92 28, 100 30, 102 36 C 94 40, 88 39, 84 34 Z" fill="#CFE5B8" stroke="#6E9E4E" strokeWidth="0.9" />
      <g className="twig-sway">
        <Blossom x={54} y={31} petal="#F7CDD8" />
        <Blossom x={74} y={42} scale={0.85} petal="#FBE1E8" />
        <Blossom x={108} y={13} scale={0.8} petal="#F7CDD8" />
      </g>
      <ellipse cx="94" cy="22" rx="2.2" ry="3.2" transform="rotate(40 94 22)" fill="#EFA3B8" stroke="#D97A96" strokeWidth="0.6" />
      <g className="twig-fall">
        <ellipse cx="40" cy="48" rx="2.6" ry="1.8" transform="rotate(-20 40 48)" fill="#F7CDD8" opacity="0.8" />
      </g>
    </>
  );
}

function Summer() {
  return (
    <>
      <path d="M8 90 C 40 72, 70 52, 104 18" fill="none" stroke="#4E8A3E" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M36 74 C 30 62, 34 52, 44 48 C 46 60, 42 68, 36 74 Z" fill="#BFE0A8" stroke="#4E8A3E" strokeWidth="1" />
      <path d="M52 64 C 60 58, 70 60, 74 66 C 66 70, 58 70, 52 64 Z" fill="#A9D48E" stroke="#4E8A3E" strokeWidth="1" />
      <path d="M66 50 C 62 38, 68 28, 78 26 C 80 38, 74 46, 66 50 Z" fill="#BFE0A8" stroke="#4E8A3E" strokeWidth="1" />
      <path d="M82 38 C 90 32, 98 34, 100 40 C 92 44, 86 43, 82 38 Z" fill="#A9D48E" stroke="#4E8A3E" strokeWidth="1" />
      <g transform="translate(105 17)">
        <g className="twig-bloom">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <ellipse key={a} cx="0" cy="-6" rx="2.2" ry="4" transform={`rotate(${a})`} fill="#FFFFFF" stroke="#C9C2A8" strokeWidth="0.6" />
          ))}
          <circle r="3" fill="#E8B23A" stroke="#C48A1E" strokeWidth="0.6" />
        </g>
      </g>
    </>
  );
}

function Autumn() {
  return (
    <>
      <path d="M10 90 C 38 70, 66 50, 108 16" fill="none" stroke="#7A5230" strokeWidth="1.7" strokeLinecap="round" />
      <g className="twig-sway">
        <Maple x={50} y={60} rotate={-35} scale={0.95} fill="#B5472A" stroke="#8A2F17" veins="#F3D2C2" />
        <Maple x={84} y={36} rotate={25} scale={0.78} fill="#D08A3A" stroke="#9A5E1E" veins="#F6E0C0" />
        <Maple x={106} y={16} rotate={-10} scale={0.5} fill="#8C5A2E" stroke="#6A4020" />
      </g>
      <g className="twig-fall" opacity="0.85">
        <Maple x={26} y={36} rotate={50} scale={0.55} fill="#9C3B22" stroke="#7A2A15" veins="#F3D2C2" />
      </g>
    </>
  );
}

function Christmas() {
  return (
    <>
      <g transform="translate(10 86) rotate(-38)">
        <path d="M0 0 L100 0" fill="none" stroke="#5B4632" strokeWidth="1.6" strokeLinecap="round" />
        <path d={FIR_DARK} fill="none" stroke="#245A3C" strokeWidth="1.5" strokeLinecap="round" />
        <path d={FIR_LIGHT} fill="none" stroke="#3E7D56" strokeWidth="1.2" strokeLinecap="round" />
      </g>
      <g className="twig-swing">
        <path d="M66 50 L66 64" stroke="#B89A5A" strokeWidth="0.8" />
        <rect x="63.5" y="62" width="5" height="3" rx="0.8" fill="#C9A94E" />
        <circle cx="66" cy="72" r="7.5" fill="#B8322F" stroke="#8E2320" strokeWidth="0.8" />
        <path d="M62.5 69 C 63.5 67, 65.5 66.2, 67.5 66.5" fill="none" stroke="#F4B7B2" strokeWidth="1.1" strokeLinecap="round" />
      </g>
      <circle cx="36" cy="58" r="2.6" fill="#C0392B" />
      <circle cx="40.5" cy="60" r="2.6" fill="#C0392B" />
      <circle cx="38" cy="54" r="2.6" fill="#A93226" />
    </>
  );
}

function Winter() {
  return (
    <>
      <path d="M8 90 C 38 70, 66 50, 108 16" fill="none" stroke="#6E625A" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M44 66 C 42 56, 46 48, 52 42" fill="none" stroke="#6E625A" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M74 44 C 82 40, 88 40, 94 44" fill="none" stroke="#6E625A" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M40 67 C 44 62, 52 58, 58 58 C 56 62, 48 66, 40 67 Z" fill="#FFFFFF" stroke="#B8C7D1" strokeWidth="0.7" />
      <path d="M47 50 C 48 46, 52 43, 55 42 C 55 45, 51 49, 47 50 Z" fill="#FFFFFF" stroke="#B8C7D1" strokeWidth="0.7" />
      <path d="M72 46 C 76 41, 84 36, 92 34 C 90 39, 80 44, 72 46 Z" fill="#FFFFFF" stroke="#B8C7D1" strokeWidth="0.7" />
      <path d="M84 41 C 88 39, 92 39, 95 42 C 91 43, 88 43, 84 41 Z" fill="#FFFFFF" stroke="#B8C7D1" strokeWidth="0.7" />
      <circle cx="98" cy="26" r="2.4" fill="#FFFFFF" stroke="#B8C7D1" strokeWidth="0.6" />
      <circle cx="94" cy="30" r="2" fill="#FFFFFF" stroke="#B8C7D1" strokeWidth="0.6" />
      <g className="twig-fall" stroke="#7FA3BA" strokeLinecap="round">
        <path transform="translate(26 30)" d={SNOWFLAKE} strokeWidth="0.9" />
        <path transform="translate(64 20) scale(0.7)" d={SNOWFLAKE} strokeWidth="1.1" />
        <path transform="translate(100 64) scale(0.8)" d={SNOWFLAKE} stroke="#9DB8C9" strokeWidth="1" />
      </g>
    </>
  );
}

const DRAWINGS: Record<Season, () => ReactElement> = {
  fruehling: Spring,
  sommer: Summer,
  herbst: Autumn,
  weihnachten: Christmas,
  winter: Winter,
};

const LABELS: Record<Season, string> = {
  fruehling: "Kirschblütenzweig",
  sommer: "Sommerzweig mit Gänseblümchen",
  herbst: "Herbstzweig mit Ahornblättern",
  weihnachten: "Tannenzweig mit Christbaumkugel",
  winter: "Winterzweig mit Schnee",
};

/** `animated`: sanfte Bewegung (nur im leeren Eingang), respektiert
 * prefers-reduced-motion. Ohne `aria-label`-Wunsch rein dekorativ. */
export function SeasonalTwig({
  season,
  animated = false,
  decorative = true,
  className,
  ...rest
}: { season: Season; animated?: boolean; decorative?: boolean } & SVGProps<SVGSVGElement>) {
  const Drawing = DRAWINGS[season];
  return (
    <svg
      viewBox="0 0 120 96"
      className={`seasonal-twig${animated ? " animated" : ""}${className ? ` ${className}` : ""}`}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : LABELS[season]}
      {...rest}
    >
      <Drawing />
    </svg>
  );
}
