import { useCallback, useEffect, useRef, useState } from "react";
import protectionTips from "../../../contracts/protection-tips.json";
import "./ProtectionTip.css";

// [2026-09-28] WEB_INBOX.md 28.09. "WILLKOMMENSBILDSCHIRM - wechselnde
// Schutz-Tipps": wechselt etwa alle 10 Sekunden mit sanftem Überblenden.
// Die Tipps kommen aus contracts/protection-tips.json (gemeinsam mit iOS).
// Reihenfolge: pro Besuch neu gemischt, keine Wiederholung, bis alle einmal
// gezeigt wurden. Pause, solange Maus oder Tastaturfokus im Bereich ist.

const TIPS: string[] = protectionTips.tips;
const INTERVAL_MS = 10_000;
const FADE_MS = 300;

function shuffled(avoidFirst?: number): number[] {
  const order = TIPS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  // Beim Neumischen nicht direkt den zuletzt gezeigten Tipp wiederholen.
  if (avoidFirst !== undefined && order.length > 1 && order[0] === avoidFirst) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function ProtectionTip() {
  // Reihenfolge und Position in EINEM State, damit beide nie auseinanderlaufen.
  const [deck, setDeck] = useState(() => ({ order: shuffled(), pos: 0 }));
  const [fading, setFading] = useState(false);
  const [paused, setPaused] = useState(false);
  const hoverRef = useRef(false);
  const focusRef = useRef(false);
  const tipIndex = deck.order[deck.pos];

  const advance = useCallback(() => {
    const swap = () => {
      setDeck((d) =>
        d.pos + 1 < d.order.length
          ? { order: d.order, pos: d.pos + 1 }
          : { order: shuffled(d.order[d.pos]), pos: 0 },
      );
      setFading(false);
    };
    if (prefersReducedMotion()) {
      swap();
      return;
    }
    setFading(true);
    window.setTimeout(swap, FADE_MS);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(advance, INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [paused, advance, tipIndex]);

  const updatePaused = () => setPaused(hoverRef.current || focusRef.current);

  return (
    <section
      className="protection-tip"
      aria-label="Schutz-Tipp"
      onMouseEnter={() => {
        hoverRef.current = true;
        updatePaused();
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
        updatePaused();
      }}
      onFocus={() => {
        focusRef.current = true;
        updatePaused();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focusRef.current = false;
        updatePaused();
      }}
    >
      <span className="protection-tip-label">Schutz-Tipp</span>
      {/* Alle Tipps unsichtbar in derselben Rasterzelle: die Höhe richtet sich
          nach dem längsten Tipp, beim Wechsel springt nichts. */}
      <div className="protection-tip-stage">
        {TIPS.map((tip, i) => (
          <p key={i} className="protection-tip-sizer" aria-hidden="true">
            {tip}
          </p>
        ))}
        <p className={`protection-tip-text${fading ? " fading" : ""}`} aria-live="off">
          {TIPS[tipIndex]}
        </p>
      </div>
      <button type="button" className="protection-tip-next" onClick={advance}>
        Nächster Tipp
      </button>
    </section>
  );
}
