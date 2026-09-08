import { describe, expect, it } from "vitest";
import { computeImageToTextRatio } from "../src/imageToTextRatio.js";

describe("computeImageToTextRatio", () => {
  it("returns null for plain text without any HTML markup", () => {
    expect(computeImageToTextRatio("Hallo, das ist eine ganz normale Text-Mail ohne HTML.")).toBeNull();
  });

  it("does not mistake a bare '<' comparison in plain text for HTML markup", () => {
    expect(computeImageToTextRatio("Der Preis ist 5 < 10 Euro, also ein Schnäppchen.")).toBeNull();
  });

  it("returns 0 for HTML with visible text but no <img> tags", () => {
    const rawText = "<p>Hallo, anbei Ihre Rechnung für September. Bei Fragen antworten Sie gern.</p>";
    expect(computeImageToTextRatio(rawText)).toBe(0);
  });

  it("returns 0 (not null) for HTML markup that contains neither text nor images", () => {
    expect(computeImageToTextRatio("<div>   </div>")).toBe(0);
  });

  it("returns 1 when the mail is only images with no visible text", () => {
    const rawText = '<html><body><img src="a.jpg"><img src="b.jpg"></body></html>';
    expect(computeImageToTextRatio(rawText)).toBe(1);
  });

  it("computes a ratio between 0 and 1 for a mix of one image and some text", () => {
    const rawText =
      '<p>Hallo dies ist ein Test mit fünf Wörtern und einem Bild.</p><img src="y.jpg">';
    // 1 <img>, 11 sichtbare Wörter -> 1 / (1 + 11)
    expect(computeImageToTextRatio(rawText)).toBeCloseTo(1 / 12, 5);
  });

  it("computes a ratio for two images against a short text", () => {
    const rawText =
      '<div>Nur ein kurzer Satz mit vier Wörtern.</div><img src="a.jpg"><img src="b.jpg">';
    // 2 <img>, 7 sichtbare Wörter -> 2 / (2 + 7)
    expect(computeImageToTextRatio(rawText)).toBeCloseTo(2 / 9, 5);
  });

  it("ignores content inside <script>/<style> blocks when counting visible text", () => {
    const withScript = '<div><script>var x = "viele extra wörter hier drin";</script></div><img src="a.jpg">';
    // Kein sichtbarer Text (nur Script-Inhalt, wird ausgeschlossen) -> ratio 1
    expect(computeImageToTextRatio(withScript)).toBe(1);
  });

  it("a heavily image-laden mail with little text has a high ratio (evasion pattern)", () => {
    const rawText = '<div>Angebot</div><img src="1.jpg"><img src="2.jpg"><img src="3.jpg">';
    // 3 <img>, 1 Wort -> 3/4 = 0.75, klar über 0.5
    expect(computeImageToTextRatio(rawText)).toBeGreaterThan(0.5);
  });
});
