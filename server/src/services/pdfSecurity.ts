import crypto from 'node:crypto';

export interface DownloadClaims { uid: string; file: string; exp: number }
export function signPdfDownloadToken(claims: DownloadClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function validatePdfDownloadToken(token: string, secret: string, userId: string, now = Date.now()): { claims: DownloadClaims | null; status: 200 | 401 | 403 } {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra) return { claims: null, status: 401 };
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(sig, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return { claims: null, status: 401 };
  let claims: DownloadClaims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as DownloadClaims; } catch { return { claims: null, status: 401 }; }
  if (!claims.uid || !/^[a-f\d-]{36}$/i.test(claims.file) || !Number.isFinite(claims.exp)) return { claims: null, status: 401 };
  if (claims.exp <= now) return { claims: null, status: 401 };
  if (claims.uid !== userId) return { claims: null, status: 403 };
  return { claims, status: 200 };
}
