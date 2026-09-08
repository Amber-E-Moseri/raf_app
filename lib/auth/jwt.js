import crypto from 'node:crypto';

function getSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (process.env.NODE_ENV === 'production' || process.env.RAF_AUTH_REQUIRED === 'true' || process.env.RAF_AUTH_REQUIRED === '1') {
    throw new Error('JWT_SECRET is required for local JWT auth.');
  }

  // Dev-only fallback: generate a random secret per process so tokens never survive restarts in dev.
  if (!getSecret._devSecret) {
    getSecret._devSecret = crypto.randomBytes(32).toString('hex');
  }
  return getSecret._devSecret;
}

function base64UrlEncode(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64UrlDecode(str) {
  const padded = str + '='.repeat((4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString();
}

export function createToken(payload, expiresInSeconds = 86400) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    ...payload,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + expiresInSeconds,
  };
  const body = base64UrlEncode(JSON.stringify(claims));
  const message = `${header}.${body}`;
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', getSecret()).update(message).digest()
  );
  return `${message}.${signature}`;
}

function verifiedClaims(token, { ignoreExpiration = false } = {}) {
  try {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) {
      return null;
    }

    const message = `${header}.${body}`;
    const expectedSignature = base64UrlEncode(
      crypto.createHmac('sha256', getSecret()).update(message).digest()
    );

    const sigBuf = Buffer.from(signature, 'ascii');
    const expBuf = Buffer.from(expectedSignature, 'ascii');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const claims = JSON.parse(base64UrlDecode(body));
    const now = Math.floor(Date.now() / 1000);
    if (!ignoreExpiration && claims.exp < now) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}

export async function blacklistToken(token, { db } = {}) {
  const claims = verifiedClaims(token, { ignoreExpiration: true });
  if (!claims?.jti || !claims?.exp || !db?.transaction) {
    return false;
  }

  await db.transaction((tx) => tx.insertBlacklistedToken({
    jti: claims.jti,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  }));
  return true;
}

export async function isBlacklisted(token, { db } = {}) {
  const claims = verifiedClaims(token, { ignoreExpiration: true });
  if (!claims?.jti || !db?.transaction) {
    return false;
  }

  return db.transaction((tx) => tx.isTokenBlacklisted({ jti: claims.jti }));
}

export async function verifyToken(token, { db, skipBlacklist = false } = {}) {
  const claims = verifiedClaims(token);
  if (!claims) {
    return null;
  }

  try {
    if (!skipBlacklist && await isBlacklisted(token, { db })) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}
