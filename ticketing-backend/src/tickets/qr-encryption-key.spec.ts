import { Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { loadQrEncryptionKey } from './qr-encryption-key';
import { TicketsService } from './tickets.service';

const buildService = () =>
  new TicketsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

// The key derivation the service used before this change.
const legacyKeyBytes = (oldValue: string) =>
  Buffer.from(oldValue.padEnd(32, '0').slice(0, 32));

const legacyEncrypt = (oldValue: string, token: string) => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    legacyKeyBytes(oldValue),
    iv,
  );
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
};

describe('loadQrEncryptionKey', () => {
  it('accepts exactly 64 hex characters and returns the 32 decoded bytes', () => {
    const hex = crypto.randomBytes(32).toString('hex');
    const key = loadQrEncryptionKey(hex);
    expect(key).toHaveLength(32);
    expect(key.equals(Buffer.from(hex, 'hex'))).toBe(true);
  });

  it('accepts uppercase hex', () => {
    expect(
      loadQrEncryptionKey(crypto.randomBytes(32).toString('hex').toUpperCase()),
    ).toHaveLength(32);
  });

  it.each([undefined, ''])('rejects a missing key (%p)', (value) => {
    expect(() => loadQrEncryptionKey(value)).toThrow(
      /QR_ENCRYPTION_KEY is not set/,
    );
  });

  it.each([
    ['too short', 'a'.repeat(63)],
    ['too long', 'a'.repeat(65)],
    ['32 raw characters (old format)', 'a'.repeat(32)],
    ['the example placeholder', 'replace-with-64-hex-characters'],
    ['64 non-hex characters', 'z'.repeat(64)],
    ['surrounding whitespace', ` ${'a'.repeat(64)} `],
  ])(
    'rejects a key that is %s instead of padding or truncating it',
    (_label, value) => {
      expect(() => loadQrEncryptionKey(value)).toThrow(
        /QR_ENCRYPTION_KEY is invalid: expected exactly 64 hexadecimal characters/,
      );
    },
  );

  it('never echoes the configured value in the error', () => {
    const secretish = 'my-super-secret-value-that-is-not-hex';
    expect(() => loadQrEncryptionKey(secretish)).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(secretish),
      }),
    );
  });
});

describe('TicketsService QR key configuration', () => {
  const originalKey = process.env.QR_ENCRYPTION_KEY;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.QR_ENCRYPTION_KEY;
    } else {
      process.env.QR_ENCRYPTION_KEY = originalKey;
    }
  });

  it('fails to construct (and so fails app startup) when the key is missing', () => {
    delete process.env.QR_ENCRYPTION_KEY;
    expect(buildService).toThrow(/QR_ENCRYPTION_KEY is not set/);
  });

  it('fails to construct when the key is invalid', () => {
    process.env.QR_ENCRYPTION_KEY = 'default-insecure-key-change-in-production';
    expect(buildService).toThrow(/QR_ENCRYPTION_KEY is invalid/);
  });

  it('round-trips tokens it generates', () => {
    process.env.QR_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const service: any = buildService();
    const { token, encryptedToken } = service.generateQrToken();
    expect(service.decryptQrToken(encryptedToken)).toBe(token);
  });

  it('cannot decrypt tokens made with a different key', () => {
    process.env.QR_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const { encryptedToken } = (buildService() as any).generateQrToken();

    process.env.QR_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    expect((buildService() as any).decryptQrToken(encryptedToken)).toBeNull();
  });

  it.each([
    [
      'a 64-hex key as documented in .env.example',
      crypto.randomBytes(32).toString('hex'),
    ],
    [
      'the removed hard-coded fallback',
      'default-insecure-key-change-in-production',
    ],
  ])(
    'decrypts QR codes issued under the old derivation from %s once the key is migrated',
    (_label, oldValue) => {
      const token = crypto.randomBytes(32).toString('hex');
      const legacyQr = legacyEncrypt(oldValue, token);

      process.env.QR_ENCRYPTION_KEY = legacyKeyBytes(oldValue).toString('hex');
      expect((buildService() as any).decryptQrToken(legacyQr)).toBe(token);
    },
  );
});
