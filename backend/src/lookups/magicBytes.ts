// Magic-Bytes-Pruefung (WEB_INBOX.md 21.09. "WICHTIGE LUECKE ENTDECKT -
// echter Malware-Scan", Punkt 3): erkennt den klassischen Trick, eine
// ausfuehrbare Datei durch Umbenennen als .jpg/.pdf/etc. zu tarnen --
// prueft den TATSAECHLICHEN Dateityp anhand der ersten Bytes, nicht nur
// die behauptete Dateiendung. Bewusst kein npm-Paket (z.B. `file-type`) --
// das ist reines ESM und wuerde in diesem CommonJS-Backend nur per
// dynamischem import() gehen; fuer die paar sicherheitsrelevanten
// Signaturen hier (Programmcode-Formate) reicht eine kleine, selbst
// gepflegte Liste, keine vollstaendige Dateityp-Erkennung noetig.

const EXECUTABLE_SIGNATURES: Array<{ name: string; match: (buf: Buffer) => boolean }> = [
  // Windows PE (.exe/.dll/.scr/.com etc.) -- "MZ"-Header.
  { name: "pe_executable", match: (b) => b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a },
  // Linux ELF-Binaries.
  { name: "elf_executable", match: (b) => b.length >= 4 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46 },
  // macOS Mach-O (32/64-Bit, big/little-endian) + Fat-/Universal-Binaries.
  {
    name: "macho_executable",
    match: (b) => {
      if (b.length < 4) return false;
      const magic = b.readUInt32BE(0);
      return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic);
    },
  },
  // Shell-Skripte mit Shebang ("#!/bin/sh" etc.).
  { name: "shell_script", match: (b) => b.length >= 2 && b[0] === 0x23 && b[1] === 0x21 },
];

// Nur fuer Dateiendungen relevant, die selbst KEIN Programmcode sind (sonst
// waere z.B. eine .exe-Datei mit echtem PE-Header ein Fehlalarm -- die wird
// bereits ueber die Endungs-Blockliste abgefangen, siehe
// attachmentScanClamAv.ts DANGEROUS_EXTENSIONS).
const HARMLESS_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "bmp", "webp", "heic", "heif", "svg",
  "pdf", "txt", "csv", "rtf",
  "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "mp3", "mp4", "mov", "wav", "zip",
]);

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
}

/** true, wenn eine als harmlos ausgegebene Datei tatsaechlich Programmcode
 * (PE/ELF/Mach-O/Shell-Skript) ist -- der Kern-Erkennungsfall aus dem
 * Auftrag ("Trick, eine ausfuehrbare Datei durch Umbenennen als .jpg/.pdf/
 * etc. zu tarnen"). */
export function isDisguisedExecutable(filename: string, buffer: Buffer): boolean {
  if (!HARMLESS_EXTENSIONS.has(extensionOf(filename))) return false;
  return EXECUTABLE_SIGNATURES.some((sig) => sig.match(buffer));
}
