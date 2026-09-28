// [2026-09-28] Testverbindung fuer den Einrichtungsassistenten (Massimo:
// "dadrin soll auch eine Testverbindung hergestellt werden, ob der
// Maildienst ueberhaupt antwortet"). Baut eine Verbindung zum Mailserver
// auf, liest die Begruessung (z.B. "* OK Gimap ready") und trennt wieder --
// OHNE Anmeldung. So sieht der User vor der Passworteingabe, dass der
// Dienst erreichbar ist, und nach einer abgelehnten Anmeldung, dass es an
// den Zugangsdaten liegt und nicht an der Verbindung.
//
// Der Endpunkt ist vor dem Login erreichbar, deshalb eng begrenzt: nur
// uebliche Mail-Ports, keine privaten/lokalen Adressen (sonst liesse sich
// der Server als Port-Scanner fuers eigene Netz missbrauchen), kurze
// Zeitlimits, Begruessung gekuerzt.

import { lookup } from "node:dns/promises";
import { isIP, Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export const MAIL_PORTS = new Set([25, 110, 143, 465, 587, 993, 995, 2525]);
const TIMEOUT_MS = 6000;

export interface ProbeResult {
  host: string;
  port: number;
  ok: boolean;
  /** Erste Zeile, die der Server schickt, z.B. "* OK Gimap ready". */
  greeting: string | null;
  /** Grund, falls nicht erreichbar -- in verstaendlichem Deutsch. */
  error: string | null;
  latencyMs: number | null;
}

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    if (v6.startsWith("::ffff:")) return isPrivateAddress(v6.slice(7));
    return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
  );
}

export async function probeMailServer(host: string, port: number, secure: boolean): Promise<ProbeResult> {
  const base = { host, port, ok: false, greeting: null, latencyMs: null };
  let address: string;
  try {
    address = isIP(host) ? host : (await lookup(host)).address;
  } catch {
    return { ...base, error: `Die Serveradresse „${host}“ gibt es nicht.` };
  }
  if (isPrivateAddress(address)) {
    return { ...base, error: "Diese Adresse zeigt in ein lokales Netz und wird nicht geprüft." };
  }

  const started = Date.now();
  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let socket: Socket | TLSSocket;
    const finish = (result: Omit<ProbeResult, "host" | "port">) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ host, port, ...result });
    };
    const onData = (chunk: Buffer) => {
      const line = chunk.toString("utf-8").split(/\r?\n/)[0].trim().slice(0, 160);
      finish({ ok: true, greeting: line || null, error: null, latencyMs: Date.now() - started });
    };
    const onError = (err: NodeJS.ErrnoException) => {
      const reason =
        err.code === "ECONNREFUSED"
          ? "Der Server lehnt Verbindungen auf diesem Port ab."
          : err.code === "ETIMEDOUT" || err.code === "EHOSTUNREACH"
            ? "Der Server antwortet nicht."
            : err.code?.startsWith("ERR_TLS") || /certificate|ssl|tls/i.test(err.message)
              ? "Verschlüsselte Verbindung fehlgeschlagen (TLS-Einstellung prüfen)."
              : `Verbindung fehlgeschlagen (${err.code ?? err.message}).`;
      finish({ ok: false, greeting: null, error: reason, latencyMs: null });
    };

    // Zur bereits aufgeloesten Adresse verbinden (kein zweites DNS, das
    // zwischendurch auf eine andere Adresse zeigen koennte), TLS-Pruefung
    // aber gegen den Hostnamen.
    socket = secure
      ? tlsConnect({ host: address, port, servername: isIP(host) ? undefined : host })
      : new Socket().connect(port, address);
    socket.setTimeout(TIMEOUT_MS, () => finish({ ok: false, greeting: null, error: "Der Server antwortet nicht.", latencyMs: null }));
    socket.once("data", onData);
    socket.once("error", onError);
  });
}
