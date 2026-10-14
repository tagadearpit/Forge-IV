import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const apiRoot = (process.env.STUDYMIND_API_URL ?? 'http://127.0.0.1:3001/api').replace(/\/$/, '');
const geminiKeyAvailable = Boolean(process.env.GEMINI_API_KEY);
const fixture = path.join(__dirname, 'fixtures', 'section-two.pdf');
const thresholds = [
  'GROUNDING_SIMILARITY_THRESHOLD_GEMINI', 'GROUNDING_LEXICAL_THRESHOLD_GEMINI',
  'GROUNDING_SIMILARITY_THRESHOLD', 'GROUNDING_SIMILARITY_THRESHOLD_LEGACY',
];

async function ask(page: Page, text: string) {
  const input = page.getByLabel('Your question');
  await input.fill(text);
  await input.press('Enter');
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Read answer aloud/i })).toBeVisible({ timeout: 90_000 });
}

async function registerTestUser(request: APIRequestContext) {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const response = await request.post(`${apiRoot}/auth/register`, {
    data: { name: 'Local E2E Learner', email: `e2e_${nonce}@studymind.test`, phone: `+919${Date.now().toString().slice(-9)}`, password: 'LocalE2E1234' },
  });
  expect(response.status(), 'local API must accept a fresh test account').toBe(201);
  return await response.json() as { token: string; user: Record<string, unknown> };
}

test('local Gemini: upload, section citations, follow-up restore, PDF attachment, and unscoped concept query', async ({ page, request }, testInfo) => {
  test.skip(!geminiKeyAvailable, 'NOT VERIFIED: GEMINI_API_KEY is required to run this live Gemini flow.');
  expect(thresholds.filter((key) => Boolean(process.env[key])), 'Gemini grounding thresholds must remain unset for this test').toEqual([]);
  test.setTimeout(300_000);

  const session = await registerTestUser(request);
  const auth = { Authorization: `Bearer ${session.token}` };
  try {
    await page.addInitScript(({ token, user }) => {
      localStorage.setItem('studymind.token', token);
      localStorage.setItem('studymind.user', JSON.stringify(user));
    }, session);

    await page.goto('/knowledge-base');
    await page.locator('input[type="file"]').setInputFiles(fixture);
    const sourceName = path.basename(fixture);
    const sourceRow = page.getByRole('row').filter({ hasText: sourceName });
    await expect(sourceRow).toBeVisible({ timeout: 30_000 });
    await expect(sourceRow.getByText('ready', { exact: false })).toBeVisible({ timeout: 120_000 });

    const sourcesResponse = await request.get(`${apiRoot}/sources`, { headers: auth });
    expect(sourcesResponse.ok()).toBeTruthy();
    const sources = (await sourcesResponse.json()).sources as Array<{ id: string; title: string; status: string }>;
    const source = sources.find((row) => row.title === sourceName && row.status === 'ready');
    expect(source, 'the uploaded PDF should be indexed and ready').toBeTruthy();

    await page.goto('/tutor');
    await page.locator('#scope').selectOption(`source:${source!.id}`);
    await expect(page.getByText(`Using: ${sourceName}`)).toBeVisible();
    await ask(page, 'explain section 2 of my upload');
    await expect(page.getByRole('button', { name: new RegExp(`${sourceName}.*p\\.2`, 'i') })).toBeVisible();
    await expect(page.getByText(`Using: ${sourceName}`).first()).toBeVisible();

    await ask(page, 'go deeper on that');
    await expect(page.getByRole('button', { name: new RegExp(`${sourceName}.*p\\.2`, 'i') })).toBeVisible();

    await page.reload();
    await expect(page.getByText('go deeper on that', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: new RegExp(`${sourceName}.*p\\.2`, 'i') })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await ask(page, 'make a PDF of this');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
    const downloadedPath = testInfo.outputPath('tutor-report.pdf');
    await download.saveAs(downloadedPath);
    expect((await fs.stat(downloadedPath)).size).toBeGreaterThan(500);
    await expect(page.getByRole('button', { name: /Download attached PDF/i })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: /Download attached PDF/i })).toBeVisible({ timeout: 30_000 });
    await page.locator('#scope').selectOption('All sources');
    const finalRequest = page.waitForRequest((req) => {
      if (req.method() !== 'POST' || !req.url().includes('/api/tutor/ask')) return false;
      try { return JSON.parse(req.postData() ?? '{}').question === 'What is page replacement?'; } catch { return false; }
    });
    await ask(page, 'What is page replacement?');
    const requestBody = JSON.parse((await finalRequest).postData() ?? '{}');
    expect(requestBody.scope?.sourceIds ?? []).toEqual([]);
    await expect(page.getByText('What is page replacement?', { exact: true })).toBeVisible();
  } finally {
    await request.delete(`${apiRoot}/auth/me/data`, { headers: auth, data: { confirm: 'DELETE' } }).catch(() => undefined);
  }
});
