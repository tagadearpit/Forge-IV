import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signFileToken, verifyFileToken, signToken } from '../middleware/auth.js';
import { env } from '../config/env.js';

/**
 * FIX 2 — file tokens for <iframe>/<video>/<audio> src URLs.
 *
 * Those elements cannot send an Authorization header, so the viewer needs a
 * token in the query string. The security requirement is that the long-lived
 * login JWT must NEVER be used for that, and a file token must not be able to
 * authenticate any other route or any other source.
 */

describe('file tokens are scoped and short-lived', () => {
  const sourceA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const sourceB = 'bbbbbbbbbbbbbbbbbbbbbbbb';

  test('a valid file token verifies for its own source', () => {
    const t = signFileToken('user1', sourceA, 300);
    const p = verifyFileToken(t, sourceA);
    assert.ok(p);
    assert.equal(p!.sub, 'user1');
    assert.equal(p!.sid, sourceA);
    assert.equal(p!.purpose, 'file');
  });

  test('a file token is REJECTED for a different source', () => {
    const t = signFileToken('user1', sourceA, 300);
    assert.equal(
      verifyFileToken(t, sourceB),
      null,
      'a token bound to source A must not fetch source B'
    );
  });

  test('an EXPIRED file token is rejected', () => {
    // expiresIn: -1 is already expired at signing time.
    const t = jwt.sign({ sub: 'user1', sid: sourceA, purpose: 'file' }, env.JWT_SECRET, {
      expiresIn: -10,
    });
    assert.equal(verifyFileToken(t, sourceA), null);
  });

  test('the long-lived LOGIN token cannot be used as a file token', () => {
    const login = signToken('user1', 'u@test.local');
    assert.equal(
      verifyFileToken(login, sourceA),
      null,
      'a login JWT has no purpose/sid and must not authorise a file'
    );
  });

  test('a file token cannot authenticate a non-file route', () => {
    // requireAuth only understands login JWTs (sub + email, no purpose scoping).
    const fileTok = signFileToken('user1', sourceA, 300);
    let decoded: any = null;
    try {
      decoded = jwt.verify(fileTok, env.JWT_SECRET);
    } catch {
      throw new Error('file token should verify as a JWT; it is purpose-scoped, not secret-scoped');
    }
    // It decodes, but it carries no email and its purpose is 'file'.
    assert.equal(decoded.purpose, 'file');
    assert.equal(decoded.email, undefined);
  });

  test('a token with a tampered payload fails signature verification', () => {
    const t = signFileToken('user1', sourceA, 300);
    const parts = t.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'attacker', sid: sourceA, purpose: 'file' })
    ).toString('base64url');
    assert.equal(verifyFileToken(`${parts[0]}.${forged}.${parts[2]}`, sourceA), null);
  });

  test('missing token is rejected', () => {
    assert.equal(verifyFileToken(undefined, sourceA), null);
    assert.equal(verifyFileToken('', sourceA), null);
  });

  test('file tokens expire in 5 minutes by default', () => {
    const t = signFileToken('user1', sourceA);
    const decoded = jwt.decode(t) as any;
    assert.ok(decoded.exp && decoded.iat);
    const ttl = decoded.exp - decoded.iat;
    assert.ok(ttl <= 300 && ttl >= 290, `expected ~300s ttl, got ${ttl}`);
  });
});