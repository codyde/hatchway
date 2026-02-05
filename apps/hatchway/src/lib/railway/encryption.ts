/**
 * Railway encryption module
 * 
 * Re-exports from the shared encryption utility for backwards compatibility.
 * All integrations (Railway, GitHub, etc.) use the same encryption key.
 */
export { 
  encryptToken, 
  decryptToken, 
  isEncryptionConfigured 
} from '../encryption';
