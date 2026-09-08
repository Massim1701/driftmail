// driftmail — lokaler Mock-Server (Track F)
//
// Implementiert die Endpunkte aus contracts/api-spec.yaml gegen die
// Beispieldaten in data.mjs. Bewusst ohne externe Abhängigkeiten
// (nur Node-Bordmittel), damit "npm install" schlank bleibt.
//
// Start: node mock-server/server.mjs   (siehe README.md)

import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  accounts,
  messages,
  contracts,
  messageSummary,
  messageDetail,
  contractSummary,
  summaryFor,
} from "./data.mjs";

const PORT = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 4000;

// In-Memory-Mutationen (gehen beim Neustart verloren, das reicht für den Skeleton-Zweck)
const quarantineLog = [];
const capabilityLog = [];

function send(res, status, body) {
  const json = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

function notFound(res) {
  send(res, 404, { error: "not_found" });
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split("/").filter(Boolean); // z.B. ["messages", "<id>", "summary"]

  // simulierte Netzwerklatenz, damit Loading-States im UI sichtbar sind
  await new Promise((r) => setTimeout(r, 150));

  if (req.method === "OPTIONS") {
    return send(res, 204, null);
  }

  // GET /accounts
  if (req.method === "GET" && parts.length === 1 && parts[0] === "accounts") {
    return send(res, 200, accounts);
  }

  // GET /messages?folder=&accountId=
  if (req.method === "GET" && parts.length === 1 && parts[0] === "messages") {
    const folder = url.searchParams.get("folder");
    let result = messages;
    if (folder) result = result.filter((m) => m.folder === folder);
    return send(
      res,
      200,
      result
        .slice()
        .sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
        .map(messageSummary)
    );
  }

  // /messages/{id}...
  if (parts[0] === "messages" && parts.length >= 2) {
    const id = parts[1];
    const msg = messages.find((m) => m.id === id);

    // GET /messages/{id}
    if (req.method === "GET" && parts.length === 2) {
      if (!msg) return notFound(res);
      return send(res, 200, messageDetail(msg));
    }

    // POST /messages/{id}/quarantine
    if (req.method === "POST" && parts.length === 3 && parts[2] === "quarantine") {
      if (!msg) return notFound(res);
      msg.folder = "quarantaene";
      const entry = {
        id: randomUUID(),
        messageId: msg.id,
        quarantinedAt: new Date().toISOString(),
        reason: "manuell durch Nutzer in Quarantäne verschoben",
        autoDeleteAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        userReviewed: false,
      };
      quarantineLog.push(entry);
      return send(res, 200, entry);
    }

    // GET /messages/{id}/summary
    if (req.method === "GET" && parts.length === 3 && parts[2] === "summary") {
      if (!msg) return notFound(res);
      return send(res, 200, summaryFor(msg));
    }

    // POST /messages/{id}/reply-draft
    if (req.method === "POST" && parts.length === 3 && parts[2] === "reply-draft") {
      if (!msg) return notFound(res);
      const draftText = buildDraft(msg);
      return send(res, 200, { draftText });
    }
  }

  // GET /contracts
  if (req.method === "GET" && parts.length === 1 && parts[0] === "contracts") {
    return send(res, 200, contracts.map(contractSummary));
  }

  // POST /contracts/{id}/confirm
  if (req.method === "POST" && parts[0] === "contracts" && parts.length === 3 && parts[2] === "confirm") {
    const id = parts[1];
    const contract = contracts.find((c) => c.id === id);
    if (!contract) return notFound(res);
    const body = await readJsonBody(req);
    if (body) Object.assign(contract, body, { id: contract.id, messageId: contract.messageId });
    contract.status = "active";
    return send(res, 200, contractSummary(contract));
  }

  // POST /capability-check
  if (req.method === "POST" && parts.length === 1 && parts[0] === "capability-check") {
    const body = await readJsonBody(req);
    capabilityLog.push({ ...body, checkedAt: new Date().toISOString() });
    return send(res, 200, { saved: true });
  }

  return notFound(res);
});

function buildDraft(msg) {
  const firstName = "Massimo";
  return `Hallo,\n\nvielen Dank für Ihre Nachricht "${msg.subject}".\n\nIch melde mich in Kürze mit weiteren Details.\n\nViele Grüße\n${firstName}`;
}

server.listen(PORT, () => {
  console.log(`driftmail mock-server läuft auf http://localhost:${PORT}`);
  console.log(`Beispiel: http://localhost:${PORT}/messages?folder=wichtig`);
});
