import { Router } from "express";
import { store, ensureDemoUser } from "../db/store";
import type { ApiUserAiCapability } from "../types";

export const capabilityRouter = Router();

// POST /capability-check — siehe api-spec.yaml
// Meldet das Ergebnis des On-Device-KI-Checks einer Plattform ans Backend
// (user_ai_capability, db-schema.sql). userId ist im Contract nicht Teil
// des Bodys -> in diesem Skeleton wird der Demo-User verwendet
// (siehe README "Annahmen" / SYNC.md "Offene Fragen").
capabilityRouter.post("/capability-check", (req, res) => {
  const body = req.body as Partial<ApiUserAiCapability>;
  if (!body.platform || !body.activeMode) {
    return res.status(400).json({ error: "platform und activeMode sind erforderlich" });
  }

  const { user } = ensureDemoUser();
  store.setUserAiCapability({
    userId: user.id,
    platform: body.platform,
    deviceModel: body.deviceModel ?? null,
    osVersion: body.osVersion ?? null,
    onDeviceSupported: body.onDeviceSupported ?? false,
    activeMode: body.activeMode,
    checkedAt: new Date().toISOString(),
  });

  res.json({ status: "gespeichert" });
});
