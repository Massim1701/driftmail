// Auth-Middleware ([2026-09-10] echte Auth, siehe TERMINAL_INBOX.md 09.09.
// + db-schema.sql "sessions"-Kommentar). Prüft den `Authorization: Bearer
// <token>`-Header gegen `sessions` (store.getSessionByToken) und hängt die
// aufgelöste `userId` an `req` -- ab hier ersetzt `req.userId` überall das
// bisherige `ensureDemoUser()`. Nicht auf `POST /accounts`/`POST /auth/session`
// angewendet (siehe app.ts-Mount-Reihenfolge), da genau die den Token erst
// ausstellen bzw. erneuern.

import type { NextFunction, Request, Response } from "express";
import { store } from "../db/store";

declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.header("authorization");
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  if (!token) {
    res.status(401).json({ error: "Authorization: Bearer <token> erforderlich" });
    return;
  }

  const session = await store.getSessionByToken(token);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    res.status(401).json({ error: "Token ungültig oder abgelaufen" });
    return;
  }

  req.userId = session.userId;
  next();
}
