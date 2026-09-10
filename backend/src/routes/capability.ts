import { Router } from "express";
import { store } from "../db/store";
import type { ApiUserAiCapability } from "../types";

export const capabilityRouter = Router();

// POST /capability-check — siehe api-spec.yaml
// Meldet das Ergebnis des On-Device-KI-Checks einer Plattform ans Backend
// (user_ai_capability, db-schema.sql). userId ist im Contract nicht Teil
// des Bodys -> [2026-09-10] echte Auth: kommt jetzt aus req.userId
// (requireAuth), vorher aus dem fest verdrahteten Demo-User.
capabilityRouter.post("/capability-check", async (req, res) => {
  const body = req.body as Partial<ApiUserAiCapability>;
  if (!body.platform || !body.activeMode) {
    return res.status(400).json({ error: "platform und activeMode sind erforderlich" });
  }

  await store.setUserAiCapability({
    userId: req.userId,
    platform: body.platform,
    deviceModel: body.deviceModel ?? null,
    osVersion: body.osVersion ?? null,
    onDeviceSupported: body.onDeviceSupported ?? false,
    activeMode: body.activeMode,
    checkedAt: new Date().toISOString(),
  });

  res.json({ status: "gespeichert" });
});
