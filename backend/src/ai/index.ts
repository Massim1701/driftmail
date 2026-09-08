import { MockAiAdapter } from "./mockAdapter";
import type { AiAdapter } from "./types";

// Einziger AI-Adapter dieses Skeletons. Austausch gegen die echte
// Implementierung von Track B/D/E (oder On-Device via Plattform-Track)
// betrifft nur diese eine Zeile — der Rest des Backends kennt nur das
// AiAdapter-Interface.
export const aiAdapter: AiAdapter = new MockAiAdapter();
