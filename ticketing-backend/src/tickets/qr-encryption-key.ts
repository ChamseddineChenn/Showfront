// aes-256-gcm requires a 32-byte key, supplied as 64 hexadecimal characters.
const QR_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

const GENERATE_HINT =
  "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";

export function loadQrEncryptionKey(
  raw: string | undefined = process.env.QR_ENCRYPTION_KEY,
): Buffer {
  if (!raw) {
    throw new Error(
      `QR_ENCRYPTION_KEY is not set. It must be a 64-character hexadecimal string (32 bytes for aes-256-gcm). ${GENERATE_HINT}`,
    );
  }

  if (!QR_KEY_PATTERN.test(raw)) {
    throw new Error(
      `QR_ENCRYPTION_KEY is invalid: expected exactly 64 hexadecimal characters (32 bytes for aes-256-gcm), got ${raw.length} characters${/^[0-9a-fA-F]*$/.test(raw) ? '' : ' including non-hex characters'}. ${GENERATE_HINT}`,
    );
  }

  return Buffer.from(raw, 'hex');
}
