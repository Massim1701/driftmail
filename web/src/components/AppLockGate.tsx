// AppLockGate — [2026-09-21] WEB_INBOX.md 19.09. Punkt 3: Sperrbildschirm-
// Wrapper für das Web-Äquivalent der iOS Face-ID/Touch-ID-App-Sperre (siehe
// useAppLock.ts für die Herleitung/Grenzen und
// ios/DriftmailApp/Views/AppLockGateView.swift für das iOS-Vorbild: dort
// gated derselbe Gedanke -- content() hinter isUnlocked -- den Rest der UI).
// Rendert bei locked=true GAR NICHT die Kinder (nicht nur überdeckt), analog
// zum iOS-Vorbild, das den eigentlichen Inhalt ebenfalls durch die Sperre
// ersetzt statt nur zu verstecken.

import type { ReactNode } from "react";
import { clearStoredToken } from "../api";
import { LockIcon } from "../icons";
import "./AppLockGate.css";

export function AppLockGate({
  locked,
  unlocking,
  unlockError,
  onUnlock,
  children,
}: {
  locked: boolean;
  unlocking: boolean;
  unlockError: string | null;
  onUnlock: () => Promise<boolean>;
  children: ReactNode;
}) {
  if (!locked) return <>{children}</>;

  return (
    <div className="app-lock-shell">
      <div className="app-lock-card">
        <LockIcon width={28} height={28} />
        <h1 className="app-lock-title">driftmail ist gesperrt</h1>
        <p className="app-lock-subtitle">Entsperre mit Face ID, Touch ID oder deinem Gerätepasscode.</p>
        {unlockError && <div className="app-lock-error">{unlockError}</div>}
        <button type="button" className="app-lock-button" onClick={() => onUnlock()} disabled={unlocking}>
          {unlocking ? "Entsperre…" : "Entsperren"}
        </button>
        {/* Bewusster Fallback statt Dauer-Aussperren (siehe useAppLock.ts-
            Kopfkommentar): eine rein lokale WebAuthn-Geste kann fehlschlagen
            (Sensor, Browser-Support, abgebrochener Dialog) -- ohne diesen
            Weg käme der User dann gar nicht mehr in die App. */}
        <button
          type="button"
          className="app-lock-logout"
          onClick={() => {
            if (window.confirm("Abmelden? Du musst dich danach erneut anmelden.")) {
              clearStoredToken();
              window.location.reload();
            }
          }}
        >
          Stattdessen abmelden
        </button>
      </div>
    </div>
  );
}
