import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { assertPersistentDatabaseConfig } from '../db/connect.js';

/**
 * FIX 10.1 — production must refuse weak JWT secrets.
 * Exercised by running env.ts in a child process with various NODE_ENV/JWT_SECRET
 * combinations, because the check throws at module load.
 */
describe('production JWT secret hardening', () => {
  // The test runner compiles to .test-dist beside the local server node_modules,
  // so the production environment guard can be exercised without a TS loader.
  const envFile = path.resolve(__dirname, '../config/env.js');

  function boot(jwtSecret: string, nodeEnv: string): { ok: boolean; message: string } {
    try {
      const out = execFileSync(
        process.execPath,
        ['-e', `require(${JSON.stringify(envFile)}); console.log('BOOTED');`],
        {
          env: { ...process.env, NODE_ENV: nodeEnv, JWT_SECRET: jwtSecret },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      return { ok: out.includes('BOOTED'), message: out.trim() };
    } catch (err: any) {
      return { ok: false, message: String(err.stderr ?? err.message) };
    }
  }

  const weakSecrets = [
    'dev-only-insecure-secret-change-me',
    'change-me',
    'please-change-me-now',
    'short',
    'a'.repeat(31),
  ];

  test('production refuses the dev default, "change-me" values, and <32 chars', () => {
    for (const s of weakSecrets) {
      const r = boot(s, 'production');
      assert.equal(r.ok, false, `production should have refused "${s.slice(0, 24)}"`);
      assert.match(r.message, /JWT_SECRET is not acceptable/);
    }
  });

  test('production accepts a strong 32+ char secret', () => {
    const r = boot('0123456789abcdef0123456789abcdef', 'production');
    assert.equal(r.ok, true, `production should accept a strong secret: ${r.message}`);
  });

  test('development tolerates the default (tests and local runs must still work)', () => {
    const r = boot('dev-only-insecure-secret-change-me', 'development');
    assert.equal(r.ok, true);
  });
});

describe('production database persistence', () => {
  test('accepts MONGODB_URL as an alias and prefers MONGODB_URI', () => {
    const envFile = path.resolve(__dirname, '../config/env.js');
    const matchesExpectedUri = (uri: string, url: string, expected: string): boolean => {
      const script = `const { env } = require(${JSON.stringify(envFile)}); console.log(env.MONGODB_URI === process.env.EXPECTED_MONGODB_URI ? 'MATCH' : 'NO_MATCH');`;
      const output = execFileSync(process.execPath, ['-e', script], {
        env: {
          ...process.env,
          NODE_ENV: 'development',
          MONGODB_URI: uri,
          MONGODB_URL: url,
          EXPECTED_MONGODB_URI: expected,
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return output.trim() === 'MATCH';
    };

    assert.equal(matchesExpectedUri('', 'mongodb://alias-test', 'mongodb://alias-test'), true);
    assert.equal(matchesExpectedUri('mongodb://primary-test', 'mongodb://alias-test', 'mongodb://primary-test'), true);
  });

  test('refuses in-memory storage in production', () => {
    assert.throws(() => assertPersistentDatabaseConfig(true, ''), /MONGODB_URI .*required in production/);
  });

  test('keeps the in-memory database available for local development', () => {
    assert.doesNotThrow(() => assertPersistentDatabaseConfig(false, ''));
    assert.doesNotThrow(() => assertPersistentDatabaseConfig(true, 'mongodb+srv://database.example/studymind'));
  });
});
