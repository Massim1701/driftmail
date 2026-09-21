// GET /link-check?url=... (WEB_INBOX.md 21.09. "ZWEI ENTERPRISE-SICHERHEITS-
// FEATURES - echtes Alleinstellungsmerkmal", Punkt 2, "Klick-Zeit-Link-
// Pruefung"). Bisherige Link-Sicherheitspruefung (Homoglyph-Erkennung,
// Domain-Reputation) laeuft nur EINMAL beim Empfang der Mail
// (mail/sync.ts). Enterprise-Loesungen (Proofpoint/Mimecast) pruefen
// zusaetzlich im Moment des tatsaechlichen Klicks erneut, da Angreifer eine
// zunaechst harmlose Zielseite registrieren, die erste Pruefung bestehen,
// und die Seite danach gegen eine boesartige tauschen ("verzoegerte
// Bewaffnung"/"time-of-click"-Angriff).
//
// BEWUSST UNAUTHENTIFIZIERT (siehe app.ts-Mount-Reihenfolge, vor
// requireAuth, gleiches Prinzip wie mailProviders.ts): dieser Endpunkt wird
// durch eine ECHTE Browser-Navigation aufgerufen (Klick auf einen Link in
// einer Mail), nicht per fetch() mit Authorization-Header -- ein Browser
// haengt beim Navigieren keinen Bearer-Token an. Die Pruefung selbst ist
// ausserdem nutzerunabhaengig (eine URL ist fuer jeden gleich sicher/
// unsicher), es gibt also inhaltlich nichts, das einen Login braeuchte.
//
// Offener Redirect zu einer beliebigen (vom Mail-Absender vorgegebenen) URL
// ist hier ABSICHTLICHES Design, kein Versehen -- genau das ist der Zweck
// von URL-Rewriting-Loesungen wie Proofpoint URL Defense/Mimecast: der Link
// in der Mail zeigt auf diesen Endpunkt, der nach einer erneuten Pruefung
// zur eigentlichen (durch den Absender bestimmten) Zielseite weiterleitet.
//
// REALISTISCHE AUFWANDS-EINSCHAETZUNG (wie im Auftrag verlangt): dieser
// Endpunkt ist die BACKEND-Haelfte des Features und funktioniert bereits
// vollstaendig eigenstaendig testbar. Fuer die VOLLE Funktion fehlt noch
// eine groessere Client-Aenderung, die NICHT Teil dieses Schritts ist:
// driftmail zeigt Mail-Text aktuell als reinen Klartext an (siehe
// backend/README.md "Tracking-Schutz" -- kein HTML-Rendering), URLs im
// Nachrichtentext sind dadurch aktuell gar nicht klickbar/verlinkt, weder
// in Web noch iOS. Damit dieser Endpunkt im echten Klick-Fluss ueberhaupt
// erreicht wird, muesste die Client-UI zusaetzlich (a) URLs im Klartext
// erkennen/verlinken (Auto-Linkify) und (b) deren href auf
// `${API_BASE}/link-check?url=<encodeURIComponent(url)>` umschreiben statt
// direkt auf die Original-URL zu zeigen -- ein eigener, groesserer
// UI-Auftrag, siehe SYNC.md fuer die vollstaendige Einordnung.

import { Router } from "express";
import { domainReputationLookup } from "../lookups";
import { extractDomains, isHomoglyphDomain } from "@driftmail/security-classification";

export const linkCheckRouter = Router();

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function warningPage(url: string, reason: string): string {
  const safeUrl = escapeHtml(url);
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Warnung — driftmail Link-Prüfung</title>
<style>
  body { margin:0; background:#141414; color:#fafaf8; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
  .card { max-width:480px; background:#1e1e1e; border:1px solid #2a2a2a; border-radius:16px; padding:28px 24px; }
  h1 { font-size:18px; margin:0 0 12px; color:#efa93f; }
  p { color:#c9c9c4; line-height:1.6; font-size:14px; word-break:break-all; }
  .actions { margin-top:20px; display:flex; gap:12px; flex-wrap:wrap; }
  a.primary { background:#1D9E75; color:#0b1b14; text-decoration:none; padding:10px 18px; border-radius:10px; font-weight:600; font-size:14px; }
  a.secondary { color:#9a9a94; text-decoration:none; padding:10px 18px; font-size:14px; }
</style>
</head>
<body>
  <div class="card">
    <h1>⚠️ Dieser Link wurde als verdächtig eingestuft</h1>
    <p><strong>Grund:</strong> ${escapeHtml(reason)}</p>
    <p><strong>Ziel-URL:</strong> ${safeUrl}</p>
    <p>Öffne diesen Link nur, wenn du ihm wirklich vertraust — insbesondere bei Zahlungsaufforderungen oder Login-Seiten lieber die Webseite direkt im Browser aufrufen statt diesem Link zu folgen.</p>
    <div class="actions">
      <a class="secondary" href="javascript:history.back()">Zurück</a>
      <a class="primary" href="${safeUrl}" rel="noopener">Trotzdem öffnen</a>
    </div>
  </div>
</body>
</html>`;
}

linkCheckRouter.get("/link-check", async (req, res) => {
  const url = typeof req.query.url === "string" ? req.query.url : null;
  if (!url) {
    return res.status(400).type("text/plain").send("Fehlender oder ungültiger 'url'-Parameter.");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).type("text/plain").send("Fehlender oder ungültiger 'url'-Parameter.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return res.status(400).type("text/plain").send("Nur http(s)-URLs werden unterstützt.");
  }

  const domains = extractDomains(parsed.hostname);
  const homoglyphSuspicious = domains.some((domain) => isHomoglyphDomain(domain));

  const reputation = await domainReputationLookup.lookup(parsed.hostname);
  // Schwelle analog zur eigenen Definition in domainReputationMock.ts
  // ("junge, schlecht bewertete Domain" -> 0.00-0.24 Score).
  const reputationSuspicious = reputation.domainReputationScore < 0.3;

  if (homoglyphSuspicious) {
    return res.status(200).type("text/html").send(warningPage(url, "Die Zieldomain enthält verdächtig ähnliche Zeichen (Homoglyph-Verschleierung)."));
  }
  if (reputationSuspicious) {
    return res.status(200).type("text/html").send(warningPage(url, "Die Zieldomain hat eine niedrige Reputationsbewertung (möglicherweise neu registriert)."));
  }

  res.redirect(302, url);
});
