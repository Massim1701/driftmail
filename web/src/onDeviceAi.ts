// Browser-eigene On-Device-KI (TERMINAL_INBOX.md 21.09. KORREKTUR, ersetzt
// WEB_INBOX.md "ECHTE KI-ANBINDUNG" c3ec563): primäre KI-Quelle, versucht
// VOR jedem Backend-Aufruf für summarize/draftReply zu laufen. Nutzt
// Chromes "Prompt API" (globales `LanguageModel`), feature-detected -- kein
// Fehler in Browsern ohne diese API (praktisch alle ausser aktuellem
// Chrome/Chromium).
//
// Verifiziert in dieser Umgebung (Chrome 153 via Simulator/Browser-Tool):
// `typeof LanguageModel === "function"` ist wahr, `LanguageModel.
// availability()` liefert real "downloadable" zurück (Modell hier nicht
// vorinstalliert, würde erst bei `.create()` heruntergeladen). Ein STILLER
// Mehrere-GB-Modell-Download beim ersten Klick auf "Zusammenfassen"/
// "KI-Entwurf vorschlagen" wäre schlechtes Verhalten für eine Aktion, die
// der User als schnell/lokal erwartet -- deshalb wird `.create()` hier NUR
// versucht, wenn `availability()` bereits "available" liefert (Modell
// schon vorhanden). "downloadable"/"downloading"/"unavailable" gelten alle
// als "gerade nicht nutzbar" -> sauberer, sofortiger Fallback auf den
// Backend-Aufruf (GET /messages/{id}/summary, POST .../reply-draft), kein
// Download-Trigger. Massimo hat das explizit als akzeptabel benannt,
// falls On-Device "zu aufwendig/neu" ist -- dieser Code aktiviert sich
// automatisch, sobald ein User-Browser das Modell bereits geladen hat,
// ohne dass driftmail selbst einen Download anstösst.
//
// Chrome bietet daneben auch eine dedizierte `Summarizer`-API (ebenfalls
// verifiziert vorhanden) -- bewusst NICHT genutzt, weil ihr Output eine
// feste Zusammenfassungsform ist, keine strukturierten Felder
// (actionRequired/actionDescription/deadline) wie hier gebraucht. Für eine
// spätere Ausbaustufe denkbar, nicht Teil dieses Schritts.

interface PromptSession {
  prompt(input: string): Promise<string>;
  destroy?: () => void;
}

interface LanguageModelStatic {
  availability(): Promise<"unavailable" | "downloadable" | "downloading" | "available">;
  create(options?: { initialPrompts?: Array<{ role: "system" | "user" | "assistant"; content: string }> }): Promise<PromptSession>;
}

declare global {
  // eslint-disable-next-line no-var
  var LanguageModel: LanguageModelStatic | undefined;
}

async function isReady(): Promise<boolean> {
  if (typeof LanguageModel === "undefined") return false;
  try {
    return (await LanguageModel.availability()) === "available";
  } catch {
    return false;
  }
}

function extractJsonObject(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return JSON.parse(fenced ? fenced[1] : text) as Record<string, unknown>;
}

export interface OnDeviceSummary {
  summaryText: string;
  actionRequired: boolean;
  actionDescription: string | null;
  deadline: string | null;
}

// `null` heisst "nicht verfuegbar oder fehlgeschlagen" -- Aufrufer fallen
// dann auf den bestehenden Backend-Weg zurueck, kein Fehler nach aussen.
export async function trySummarizeOnDevice(rawText: string): Promise<OnDeviceSummary | null> {
  if (!(await isReady())) return null;
  try {
    const session = await LanguageModel!.create({
      initialPrompts: [{ role: "system", content: "Du fasst E-Mails für den Empfänger auf Deutsch kurz zusammen." }],
    });
    const raw = await session.prompt(
      `Fasse die folgende E-Mail in einem Satz auf Deutsch zusammen und bestimme, ob eine Aktion von mir nötig ist. ` +
        `Antworte AUSSCHLIESSLICH mit einem einzigen JSON-Objekt, kein Fliesstext.\n` +
        `Format: {"summaryText": string, "actionRequired": boolean, "actionDescription": string|null, "deadline": "YYYY-MM-DD"|null}.\n\n` +
        `Mail-Text:\n"""\n${rawText}\n"""`,
    );
    session.destroy?.();
    const parsed = extractJsonObject(raw);
    if (typeof parsed.summaryText !== "string") return null;
    return {
      summaryText: parsed.summaryText,
      actionRequired: typeof parsed.actionRequired === "boolean" ? parsed.actionRequired : false,
      actionDescription: typeof parsed.actionDescription === "string" ? parsed.actionDescription : null,
      deadline: typeof parsed.deadline === "string" ? parsed.deadline : null,
    };
  } catch {
    return null;
  }
}

export async function tryDraftReplyOnDevice(original: { fromAddress: string; subject: string; bodyText: string }): Promise<string | null> {
  if (!(await isReady())) return null;
  try {
    const session = await LanguageModel!.create();
    const raw = await session.prompt(
      `Schreibe einen höflichen, kurzen Antwortentwurf auf Deutsch für die folgende E-Mail. ` +
        `Antworte AUSSCHLIESSLICH mit dem Antworttext selbst -- keine Anrede-Floskeln wie "Hier ist dein Entwurf".\n\n` +
        `Von: ${original.fromAddress}\nBetreff: ${original.subject}\n\nMail-Text:\n"""\n${original.bodyText}\n"""`,
    );
    session.destroy?.();
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
