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
  folders,
  messages,
  contracts,
  folderSummary,
  folderById,
  folderBySystemKey,
  isRenamable,
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
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(json);
}

function sendNoContent(res) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end();
}

function notFound(res) {
  send(res, 404, { error: "not_found" });
}

function badRequest(res, message) {
  send(res, 400, { error: "bad_request", message });
}

function forbidden(res, message) {
  send(res, 403, { error: "forbidden", message });
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

  // GET /folders
  if (req.method === "GET" && parts.length === 1 && parts[0] === "folders") {
    return send(
      res,
      200,
      folders
        .slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(folderSummary)
    );
  }

  // POST /folders
  if (req.method === "POST" && parts.length === 1 && parts[0] === "folders") {
    const body = await readJsonBody(req);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) return badRequest(res, "name ist erforderlich");
    const icon = typeof body?.icon === "string" && body.icon.trim() ? body.icon.trim() : "folder";
    const maxSort = folders.reduce((m, f) => Math.max(m, f.sort_order), -1);
    const folder = {
      id: randomUUID(),
      name,
      icon,
      is_system: false,
      system_key: null,
      sort_order: maxSort + 1,
    };
    folders.push(folder);
    return send(res, 201, folderSummary(folder));
  }

  // /folders/{folderId}
  if (parts[0] === "folders" && parts.length === 2) {
    const folderId = parts[1];
    const folder = folderById(folderId);

    // PATCH /folders/{folderId}
    if (req.method === "PATCH") {
      if (!folder) return notFound(res);
      const body = await readJsonBody(req);
      if (!body) return badRequest(res, "leerer Body");

      const wantsRename = typeof body.name === "string" || typeof body.icon === "string";
      if (wantsRename && !isRenamable(folder)) {
        return forbidden(res, "Dieser System-Ordner kann nicht umbenannt werden");
      }

      if (typeof body.name === "string") {
        const name = body.name.trim();
        if (!name) return badRequest(res, "name darf nicht leer sein");
        folder.name = name;
      }
      if (typeof body.icon === "string" && body.icon.trim()) {
        folder.icon = body.icon.trim();
      }
      if (typeof body.sortOrder === "number") {
        folder.sort_order = body.sortOrder;
      }
      return send(res, 200, folderSummary(folder));
    }

    // DELETE /folders/{folderId}
    if (req.method === "DELETE") {
      if (!folder) return notFound(res);
      if (folder.is_system) {
        return forbidden(res, "System-Ordner können nicht gelöscht werden");
      }
      // Design-Entscheidung (08.09., Track F): api-spec.yaml sagt nichts darüber,
      // was mit enthaltenen Nachrichten beim Löschen eines Ordners passiert.
      // Statt sie zu verlieren, verschieben wir sie in "Sonstiges" (Fallback-Inbox),
      // analog zum Verhalten vieler Mail-Clients beim Löschen eines Ordners.
      const fallback = folderBySystemKey("sonstiges");
      for (const msg of messages) {
        if (msg.folderId === folder.id) {
          msg.folderId = fallback.id;
        }
      }
      const idx = folders.findIndex((f) => f.id === folder.id);
      folders.splice(idx, 1);
      return sendNoContent(res);
    }
  }

  // POST /messages/send (WEB_INBOX.md 09.09. "Fehlender Senden-Endpunkt").
  // Vereinfachter Mock: kein echter Provider-Call, kein Phishing-Check
  // (dieser Mock-Server bildet den Phishing-Check ohnehin nirgends nach,
  // siehe fehlender /messages/draft/phishing-check-Endpunkt) -- prüft nur
  // dieselbe Eingabe-Validierung wie der echte Backend-Endpunkt
  // (backend/src/routes/messages.ts), damit der Composer im Web-UI auch
  // ohne den echten Track-A-Server durchgetestet werden kann.
  if (req.method === "POST" && parts.length === 2 && parts[0] === "messages" && parts[1] === "send") {
    const body = (await readJsonBody(req)) ?? {};
    const to = Array.isArray(body.to) ? body.to.filter((x) => typeof x === "string" && x.trim()) : [];
    const bodyText = typeof body.bodyText === "string" ? body.bodyText : "";
    if (to.length === 0 || !bodyText.trim()) {
      return badRequest(res, "to (mindestens 1 Empfänger) und bodyText sind erforderlich");
    }
    if (body.inReplyToMessageId) {
      const original = messages.find((m) => m.id === body.inReplyToMessageId);
      if (!original) return notFound(res);
    } else if (!accounts.some((a) => a.id === body.accountId)) {
      return badRequest(res, "accountId ist erforderlich, wenn keine inReplyToMessageId angegeben ist");
    }
    return send(res, 200, { sentMessageId: randomUUID() });
  }

  // GET /messages?folderId=&accountId=
  if (req.method === "GET" && parts.length === 1 && parts[0] === "messages") {
    const folderId = url.searchParams.get("folderId");
    let result = messages;
    if (folderId) result = result.filter((m) => m.folderId === folderId);
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

    // DELETE /messages/{id} (soft delete -> Papierkorb, siehe WEB_INBOX.md
    // "Fehlende Basis-Funktion entdeckt" / Contract-Commit 156f0fd). Kein
    // eigener Mechanismus, verhält sich wie POST /messages/{id}/move mit
    // fest verdrahtetem Ziel-Ordner "papierkorb".
    if (req.method === "DELETE" && parts.length === 2) {
      if (!msg) return notFound(res);
      msg.folderId = folderBySystemKey("papierkorb").id;
      return send(res, 200, messageSummary(msg));
    }

    // DELETE /messages/{id}/permanent (endgültiges Löschen, entfernt den
    // Mock-Datensatz komplett — kein Undo).
    if (req.method === "DELETE" && parts.length === 3 && parts[2] === "permanent") {
      if (!msg) return notFound(res);
      const idx = messages.findIndex((m) => m.id === msg.id);
      messages.splice(idx, 1);
      return send(res, 200, { id, deleted: true });
    }

    // POST /messages/{id}/quarantine
    if (req.method === "POST" && parts.length === 3 && parts[2] === "quarantine") {
      if (!msg) return notFound(res);
      msg.folderId = folderBySystemKey("quarantaene").id;
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

    // POST /messages/{id}/move
    if (req.method === "POST" && parts.length === 3 && parts[2] === "move") {
      if (!msg) return notFound(res);
      const body = await readJsonBody(req);
      const folderId = body?.folderId;
      if (typeof folderId !== "string" || !folderId) return badRequest(res, "folderId ist erforderlich");
      const target = folderById(folderId);
      if (!target) return badRequest(res, "unbekannter Ziel-Ordner");
      msg.folderId = target.id;
      return send(res, 200, messageSummary(msg));
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
  console.log(`Beispiel: http://localhost:${PORT}/messages?folderId=${folderBySystemKey("wichtig").id}`);
});
