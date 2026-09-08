import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const randomBytes = promisify(crypto.randomBytes);

export async function hashPassword(password) {
  const salt = await randomBytes(16);
  const derivedKey = await scrypt(password, salt, 64);
  return salt.toString('hex') + ':' + derivedKey.toString('hex');
}

export async function verifyPassword(password, hash) {
  const [salt, key] = hash.split(':');
  const saltBuffer = Buffer.from(salt, 'hex');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = await scrypt(password, saltBuffer, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}
