// Echte Cloud-KI-Anbindung (TERMINAL_INBOX.md 21.09., ersetzt WEB_INBOX.md
// "ECHTE KI-ANBINDUNG" c3ec563 vollstaendig): NUR erreichbar, wenn ein User
// selbst einen eigenen API-Key hinterlegt hat ("BYOK", siehe routes/
// aiSettings.ts + db-schema.sql user_ai_preference) -- kein driftmail-
// finanzierter Key, keine Standard-Cloud-KI fuer alle. Diese Klasse wird
// deshalb NIE als Singleton instanziiert (anders als MockAiAdapter),
// sondern pro Request neu mit dem entschluesselten Key des jeweiligen
// Users, siehe getAiAdapterForUser() in index.ts.
//
// Anbieter-Umfang (bewusst so belassen, kein stiller Fehlschlag): nur
// 'anthropic'/'openai' sind hier wirklich angebunden. 'google'/'other'
// existieren im Contract/DB-Enum fuer spaetere Erweiterung, werden aber
// bereits bei PUT /ai-settings mit 400 abgelehnt ("noch nicht
// implementiert") -- diese Klasse muesste sie also nie tatsaechlich
// behandeln, hat aber trotzdem eine explizite Fehlermeldung dafuer, falls
// doch mal ein ungueltiger Provider-Wert bis hierher durchrutscht.

import { analyzeMail as trackBAnalyzeMail } from "@driftmail/security-classification";
import type { AiAdapter, AiProvider, ContractData, MailSummary, MailThread, SecurityResult } from "./types";

export interface CloudAiAdapterOptions {
  provider: Extract<AiProvider, "anthropic" | "openai">;
  apiKey: string;
  /** Fuer Tests injizierbar (siehe smoketest.ts) -- Standard ist das echte globale fetch. */
  fetchImpl?: typeof fetch;
}

// Bewusst kleine/guenstige Modelle -- diese drei Funktionen sind kurze,
// on-demand ausgeloeste Aktionen (Klick auf "Inhalt"/"KI-Entwurf
// vorschlagen"), kein Grund für ein teures Modell auf Kosten des Users.
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const OPENAI_MODEL = "gpt-4o-mini";

function extractJsonObject(text: string): unknown {
  // Modelle antworten trotz Anweisung manchmal mit ```json ... ``` drumherum
  // -- robuster Strip statt striktem JSON.parse auf die Rohantwort.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate);
}

export class CloudAiAdapter implements AiAdapter {
  private readonly provider: "anthropic" | "openai";
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CloudAiAdapterOptions) {
    this.provider = opts.provider;
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // Sicherheitsklassifikation ist bewusst NICHT Teil dieser KI-Anbindung
  // (WEB_INBOX.md 21.09. "Umfang der drei Funktionen" nennt nur
  // extractContract/summarize/draftReply) -- dieselbe deterministische
  // Track-B-Logik wie MockAiAdapter, unabhaengig von BYOK-Konfiguration.
  // Phishing-/Spam-Erkennung soll nicht davon abhaengen, ob ein User einen
  // eigenen KI-Key hinterlegt hat.
  async analyzeMail(rawText: string, headers: Record<string, string>): Promise<SecurityResult> {
    return trackBAnalyzeMail(rawText, headers);
  }

  async extractContract(rawText: string): Promise<ContractData | null> {
    const prompt =
      `Analysiere die folgende E-Mail auf Vertrags-/Abonnement-Daten (Mitgliedschaft, Abo, Vertrag).\n` +
      `Antworte AUSSCHLIESSLICH mit einem einzigen JSON-Objekt, kein Fliesstext, keine Erklaerung.\n` +
      `Format: {"hasContract": boolean, "providerName": string|null, "contractStart": "YYYY-MM-DD"|null, ` +
      `"contractEnd": "YYYY-MM-DD"|null, "cancellationDeadline": "YYYY-MM-DD"|null, ` +
      `"cancellationPeriodDays": number|null, "confidence": number zwischen 0 und 1}.\n` +
      `Wenn die Mail keinen Vertragsbezug hat: hasContract=false, alle anderen Felder null.\n\n` +
      `Mail-Text:\n"""\n${rawText}\n"""`;

    const raw = await this.complete(prompt, 400);
    const parsed = extractJsonObject(raw) as Record<string, unknown>;
    if (typeof parsed.hasContract !== "boolean") {
      throw new Error(`${this.provider}: extractContract-Antwort ohne gueltiges hasContract-Feld`);
    }
    if (!parsed.hasContract) return null;

    return {
      providerName: typeof parsed.providerName === "string" ? parsed.providerName : "Unbekannter Anbieter",
      contractStart: typeof parsed.contractStart === "string" ? parsed.contractStart : null,
      contractEnd: typeof parsed.contractEnd === "string" ? parsed.contractEnd : null,
      cancellationDeadline: typeof parsed.cancellationDeadline === "string" ? parsed.cancellationDeadline : null,
      cancellationPeriodDays: typeof parsed.cancellationPeriodDays === "number" ? parsed.cancellationPeriodDays : null,
      extractedConfidence:
        typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7,
    };
  }

  async summarize(rawText: string): Promise<MailSummary> {
    const prompt =
      `Fasse die folgende E-Mail fuer den Empfaenger in einem Satz auf Deutsch zusammen und bestimme, ` +
      `ob eine Aktion von ihm noetig ist.\n` +
      `Antworte AUSSCHLIESSLICH mit einem einzigen JSON-Objekt, kein Fliesstext.\n` +
      `Format: {"summaryText": string, "actionRequired": boolean, "actionDescription": string|null, ` +
      `"deadline": "YYYY-MM-DD"|null}.\n\n` +
      `Mail-Text:\n"""\n${rawText}\n"""`;

    const raw = await this.complete(prompt, 300);
    const parsed = extractJsonObject(raw) as Record<string, unknown>;
    if (typeof parsed.summaryText !== "string") {
      throw new Error(`${this.provider}: summarize-Antwort ohne gueltiges summaryText-Feld`);
    }

    return {
      summaryText: parsed.summaryText,
      actionRequired: typeof parsed.actionRequired === "boolean" ? parsed.actionRequired : false,
      actionDescription: typeof parsed.actionDescription === "string" ? parsed.actionDescription : null,
      deadline: typeof parsed.deadline === "string" ? parsed.deadline : null,
    };
  }

  async draftReply(thread: MailThread): Promise<string> {
    const last = thread.messages[thread.messages.length - 1];
    if (!last) throw new Error(`${this.provider}: draftReply ohne Nachrichten im Thread aufgerufen`);

    const prompt =
      `Schreibe einen hoeflichen, kurzen Antwortentwurf auf Deutsch fuer die folgende E-Mail. ` +
      `Antworte AUSSCHLIESSLICH mit dem Antworttext selbst -- keine Anrede-Floskeln wie ` +
      `"Hier ist dein Entwurf", keine Erklaerungen drumherum.\n\n` +
      `Von: ${last.fromAddress}\nBetreff: ${last.subject}\n\nMail-Text:\n"""\n${last.bodyText}\n"""`;

    const raw = await this.complete(prompt, 400);
    return raw.trim();
  }

  private async complete(prompt: string, maxTokens: number): Promise<string> {
    if (this.provider === "anthropic") return this.completeAnthropic(prompt, maxTokens);
    if (this.provider === "openai") return this.completeOpenAi(prompt, maxTokens);
    throw new Error(`CloudAiAdapter: Anbieter "${this.provider}" ist nicht implementiert`);
  }

  private async completeAnthropic(prompt: string, maxTokens: number): Promise<string> {
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic-API-Fehler ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("Anthropic-API: keine Textantwort erhalten");
    return text;
  }

  private async completeOpenAi(prompt: string, maxTokens: number): Promise<string> {
    const res = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI-API-Fehler ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI-API: keine Textantwort erhalten");
    return text;
  }
}
