// useAppLock — [2026-09-21] WEB_INBOX.md 19.09. Punkt 3: Web-Äquivalent zur
// iOS Face-ID/Touch-ID-App-Sperre (siehe ios/DriftmailApp/Security/
// BiometricLock.swift + Views/AppLockGateView.swift).
//
// WICHTIGE GRENZE (bitte vor Wiederverwendung lesen, auch in web/README.md
// dokumentiert): iOS nutzt LocalAuthentication rein lokal, um eine bereits
// eingeloggte UI vor physischem Geräte-Zugriff zu schützen -- das ist genau
// die Rolle, die dieser Hook mit der WebAuthn-Plattform-Authenticator-API
// (Touch ID/Windows Hello/Android-Biometrie) im Browser nachbildet: eine
// rein lokale "ist gerade die berechtigte Person am Gerät"-Geste, KEIN
// Server-Roundtrip, KEIN neues Backend-Konzept. ABER anders als bei iOS
// (Keychain/Secure Enclave) kann diese Geste den Session-Token in
// localStorage nicht kryptografisch schützen (siehe api.ts-Kommentar zu
// TOKEN_STORAGE_KEY) -- wer per Dev-Tools/XSS bereits im selben Origin
// ausführen kann, kommt am Sperrbildschirm vorbei. Es ist also eine
// Blickschutz-/Shoulder-Surfing-Maßnahme (UI wird geblankt, bis die Geste
// gelingt), keine kryptografische Zugriffskontrolle wie ein echtes
// Betriebssystem-Login. Deshalb bewusst mit einem Abmelden-Fallback im
// Sperrbildschirm (AppLockGate.tsx), statt den User bei einem defekten
// Sensor/abgelehnter Geste dauerhaft auszusperren.

import { useCallback, useEffect, useRef, useState } from "react";

const ENABLED_KEY = "driftmail.appLockEnabled";
const CREDENTIAL_ID_KEY = "driftmail.appLockCredentialId";
const IDLE_MINUTES = 5;
const IDLE_MS = IDLE_MINUTES * 60 * 1000;
// Kurze Karenzzeit beim Tab-Wechsel/Minimieren -- ein kurzer Blick auf ein
// anderes Fenster soll nicht sofort sperren (anders als iOS, wo JEDER
// Wechsel aus .active sperrt -- im Browser wäre das bei normaler Multitasking-
// Nutzung störend), ein längeres Weglegen/Wechseln schon.
const HIDDEN_GRACE_MS = 15_000;

function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuffer(b64: string): ArrayBuffer {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

function randomChallenge(): Uint8Array<ArrayBuffer> {
  const c = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(c);
  return c;
}

async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  const pkc = window.PublicKeyCredential as
    | (typeof window.PublicKeyCredential & { isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean> })
    | undefined;
  if (!pkc?.isUserVerifyingPlatformAuthenticatorAvailable) return false;
  try {
    return await pkc.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// Einmalige lokale "Registrierung" beim Aktivieren der App-Sperre: legt ein
// Passkey im Plattform-Authenticator an (kein Server beteiligt, keine
// eigene Public-Key-Prüfung -- wir merken uns nur die Credential-ID lokal),
// damit spätere Entsperrungen dieselbe Geste per navigator.credentials.get()
// abfragen können, statt bei JEDER Entsperrung einen neuen Passkey anzulegen.
async function registerLocalCredential(): Promise<string | null> {
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: "driftmail (lokale App-Sperre)" },
        user: { id: randomChallenge(), name: "app-lock", displayName: "driftmail App-Sperre" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "required" },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;
    if (!cred) return null;
    return bufferToBase64(cred.rawId);
  } catch {
    return null;
  }
}

async function verifyLocalCredential(credentialIdB64: string): Promise<boolean> {
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials: [{ id: base64ToBuffer(credentialIdB64), type: "public-key" }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
    return assertion != null;
  } catch {
    return false;
  }
}

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // siehe api.ts setStoredToken-Kommentar: localStorage kann fehlen (privates Fenster o.ä.)
  }
}

export function useAppLock() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(() => readLocal(ENABLED_KEY) === "1" && readLocal(CREDENTIAL_ID_KEY) !== null);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const idleTimer = useRef<number | null>(null);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    platformAuthenticatorAvailable().then(setSupported);
  }, []);

  const lock = useCallback(() => {
    setLocked(true);
    setUnlockError(null);
  }, []);

  const setEnabled = useCallback(async (value: boolean) => {
    if (!value) {
      setEnabledState(false);
      setLocked(false);
      writeLocal(ENABLED_KEY, "0");
      writeLocal(CREDENTIAL_ID_KEY, null);
      return true;
    }
    const credentialId = await registerLocalCredential();
    if (!credentialId) return false;
    writeLocal(CREDENTIAL_ID_KEY, credentialId);
    writeLocal(ENABLED_KEY, "1");
    setEnabledState(true);
    return true;
  }, []);

  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    if (!enabled) return;
    idleTimer.current = window.setTimeout(lock, IDLE_MS);
  }, [enabled, lock]);

  // Inaktivitäts-Sperre: Aktivität setzt den Timer zurück, nach IDLE_MINUTES
  // ohne Aktivität wird gesperrt ("beim Aufwachen aus Inaktivität" laut Auftrag).
  useEffect(() => {
    if (!enabled) return;
    const events: Array<keyof WindowEventMap> = ["mousedown", "keydown", "touchstart", "scroll"];
    const onActivity = () => resetIdleTimer();
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    resetIdleTimer();
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, [enabled, resetIdleTimer]);

  // Tab-Wechsel/Minimieren länger als HIDDEN_GRACE_MS zählt ebenfalls als
  // "weggelegt" (Annäherung an iOS' Sperre bei jedem Verlassen von .active).
  useEffect(() => {
    if (!enabled) return;
    function onVisibilityChange() {
      if (document.hidden) {
        hiddenAt.current = Date.now();
      } else if (hiddenAt.current !== null) {
        const away = Date.now() - hiddenAt.current;
        hiddenAt.current = null;
        if (away > HIDDEN_GRACE_MS) lock();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [enabled, lock]);

  const unlock = useCallback(async () => {
    const credentialId = readLocal(CREDENTIAL_ID_KEY);
    if (!credentialId) {
      // Inkonsistenter Zustand (z.B. localStorage teilweise geleert) -- App-
      // Sperre lieber sauber deaktivieren als den User auszusperren.
      await setEnabled(false);
      return true;
    }
    setUnlocking(true);
    setUnlockError(null);
    try {
      const ok = await verifyLocalCredential(credentialId);
      if (ok) {
        setLocked(false);
        resetIdleTimer();
      } else {
        setUnlockError("Entsperren fehlgeschlagen. Bitte erneut versuchen.");
      }
      return ok;
    } finally {
      setUnlocking(false);
    }
  }, [resetIdleTimer, setEnabled]);

  return { supported, enabled, setEnabled, locked: enabled && locked, unlocking, unlockError, unlock };
}
