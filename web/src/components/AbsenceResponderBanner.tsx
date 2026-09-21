// AbsenceResponderBanner -- [2026-09-21] WEB_INBOX.md 21.09. "NEUER AUFTRAG -
// Abwesenheitsassistent": "Banner/Hinweis in der UI waehrend aktiv, mit
// direktem 'Jetzt beenden'-Schnellzugriff." Nur gerendert, solange
// App.tsx absenceResponder.active === true ist (siehe dortiger Aufrufer).

import { useState } from "react";
import type { AbsenceResponder } from "../types";
import "./AbsenceResponderBanner.css";

function formatDate(iso: string): string {
  // "YYYY-MM-DD" -> lokal lesbar, ohne Zeitzonen-Verschiebung (new
  // Date("YYYY-MM-DD") interpretiert als UTC-Mitternacht, deshalb reines
  // String-Splitting statt Date-Parsing).
  const [year, month, day] = iso.split("-");
  return `${day}.${month}.${year}`;
}

export function AbsenceResponderBanner({
  absenceResponder,
  onDeactivate,
}: {
  absenceResponder: AbsenceResponder;
  onDeactivate: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);

  async function handleDeactivate() {
    setPending(true);
    try {
      await onDeactivate();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="absence-banner" role="status">
      <span>
        Abwesenheitsassistent ist aktiv{absenceResponder.endDate ? ` bis ${formatDate(absenceResponder.endDate)}` : ""}.
      </span>
      <button type="button" className="absence-banner-button" onClick={handleDeactivate} disabled={pending}>
        {pending ? "…" : "Jetzt beenden"}
      </button>
    </div>
  );
}
