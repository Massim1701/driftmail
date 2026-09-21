// CORS-Middleware (WEB_INBOX.md 21.09. "BUG - Massimo beim manuellen Test
// gefunden": web/ [Vite-Dev-Server, Port 5173] und backend/ [Port 3000]
// sind aus Browser-Sicht unterschiedliche Origins -- ohne
// Access-Control-Allow-Origin blockiert der Browser JEDE Antwort, auch von
// oeffentlichen Endpunkten wie GET /mail-providers (der direkte
// Server-Request funktioniert, der Browser verwirft aber die Antwort, bevor
// JS sie sieht -- klassisches CORS-Symptom, kein Backend-Fehler im engeren
// Sinn, aber ohne diese Middleware nie im Zwei-Server-Lokalbetrieb nutzbar).
//
// Erlaubte Origins sind eine explizite Liste (kein `Access-Control-Allow-
// Origin: *`), per ENV konfigurierbar (`CORS_ALLOWED_ORIGINS`,
// kommagetrennt) -- Origin wird nur reflektiert, wenn sie exakt in der
// Liste steht. Ohne gesetzte Variable ein Dev-Fallback (Vite-Default-Port
// 5173, gleicher Default wie backend/.env.example FRONTEND_URL), damit der
// lokale Zwei-Server-Betrieb ohne weitere Konfiguration funktioniert --
// MUSS vor einem oeffentlich erreichbaren Deploy mit der echten
// Produktions-Origin (Web-Client-Domain) gesetzt werden, sonst bleibt es
// bei diesem engen Dev-Default.

import type { NextFunction, Request, Response } from "express";

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];

const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
  ? process.env.CORS_ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : DEFAULT_ALLOWED_ORIGINS;

export function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.header("origin");
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    // [2026-09-21] Fund beim Testen der KI-Einstellungen (PUT /ai-settings,
    // TERMINAL_INBOX.md 21.09. "KORREKTUR"): PUT fehlte hier -- curl
    // funktionierte (kein Preflight), ein echter Browser scheiterte aber
    // still am CORS-Preflight (Methode nicht in der erlaubten Liste), bevor
    // der eigentliche Request je rausging. Gleiches CORS-Symptom-Muster wie
    // der urspruengliche Fund oben (WEB_INBOX.md 21.09. "BUG").
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}
