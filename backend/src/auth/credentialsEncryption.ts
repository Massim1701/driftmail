// At-Rest-Verschlüsselung für `mail_accounts.encrypted_oauth_token` /
// `encrypted_imap_credentials` (WEB_INBOX.md 15.09., "ECHTE LUECKE
// ENTDECKT" -- Provider-Support, geprüft 19.09.).
//
// Fund beim Bauen: beide Spalten heißen "encrypted_*", enthielten aber
// bisher entweder gar nichts (IMAP-Zugangsdaten wurden nie ausgewertet)
// oder den rohen, unverschlüsselten Gmail-Refresh-Token direkt
// (`routes/auth.ts` GET /auth/google/callback, seit 10.09.) -- der
// Spaltenname versprach etwas, das der Code nicht einhielt. Ab hier echt:
// AES-256-GCM statt eines reinen Namensversprechens.
//
// Zero-Config-Fallback (gleiches Muster wie ALLOWED_EMAILS/DATABASE_URL):
// ohne CREDENTIALS_ENCRYPTION_KEY wird ein fest verdrahteter Dev-Schlüssel
// verwendet -- funktioniert lokal ohne Setup, verschlüsselt aber mit einem
// öffentlich in diesem Repo stehenden Schlüssel, ist also faktisch KEINE
// echte Absicherung. MUSS vor einem öffentlich erreichbaren Deploy gesetzt
// werden, siehe README.md "Auth".

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const DEV_FALLBACK_KEY = "driftmail-dev-only-insecure-default-key-do-not-use-in-production";
const KEY_DERIVATION_SALT = "driftmail-credentials-v1"; // fest, nur zur Schlüsselableitung, kein Geheimnis für sich genommen
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12; // empfohlene GCM-Nonce-Länge

function deriveKey(): Buffer {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY ?? DEV_FALLBACK_KEY;
  return scryptSync(secret, KEY_DERIVATION_SALT, 32);
}

/** Verschlüsselt einen Klartext (Refresh-Token, IMAP-Zugangsdaten-JSON) für
 * die DB-Ablage. Format: `<iv>.<authTag>.<ciphertext>`, alle drei Base64 --
 * ein einzelner TEXT-String, passend zu den bestehenden
 * `encrypted_*`-Spalten (kein Schema-Change nötig). */
export function encryptCredentials(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(".");
}

/** Kehrt `encryptCredentials()` um. Wirft, wenn `stored` nicht im
 * erwarteten Format ist oder der Auth-Tag nicht passt (z.B. falscher
 * Schlüssel, z.B. nach einer CREDENTIALS_ENCRYPTION_KEY-Rotation ohne
 * Neu-Verschlüsselung der Bestandsdaten -- bewusst kein stiller
 * Fallback-Klartext-Versuch, ein Fehler hier ist ein Signal, nicht etwas,
 * das sich verschweigen lässt). */
export function decryptCredentials(stored: string): string {
  const parts = stored.split(".");
  if (parts.length !== 3) {
    throw new Error("encryptedCredentials: unerwartetes Format (erwartet <iv>.<authTag>.<ciphertext>)");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const key = deriveKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]);
  return plaintext.toString("utf8");
}
