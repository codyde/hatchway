import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Get the encryption key from environment variable
 * Key must be 32 bytes (64 hex characters)
 * 
 * Uses RAILWAY_TOKEN_ENCRYPTION_KEY for now (shared across integrations)
 */
function getEncryptionKey(): Buffer {
  const key = process.env.RAILWAY_TOKEN_ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error(
      'RAILWAY_TOKEN_ENCRYPTION_KEY environment variable is required for token encryption. ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
  
  if (key.length !== 64) {
    throw new Error(
      'RAILWAY_TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex characters). ' +
      'Generate one with: openssl rand -hex 32'
    );
  }
  
  return Buffer.from(key, 'hex');
}

/**
 * Encrypt a token for secure storage in the database
 * Returns format: iv:authTag:encryptedData (all hex encoded)
 */
export function encryptToken(token: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  
  const cipher = createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt a token from the database
 * Expects format: iv:authTag:encryptedData (all hex encoded)
 */
export function decryptToken(encryptedData: string): string {
  const key = getEncryptionKey();
  
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format');
  }
  
  const [ivHex, authTagHex, encrypted] = parts;
  
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex')
  );
  
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Check if encryption is properly configured
 */
export function isEncryptionConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a string appears to be an encrypted token
 * (has the iv:authTag:data format)
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && 
    parts[0].length === 32 && // IV is 16 bytes = 32 hex chars
    parts[1].length === 32;   // Auth tag is 16 bytes = 32 hex chars
}
