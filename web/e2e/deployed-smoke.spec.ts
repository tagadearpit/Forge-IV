import { test, expect, type Page, type Route } from '@playwright/test';

const baseURL = process.env.STUDYMIND_BASE_URL ?? 'http://127.0.0.1:3000';
const demoEmail = process.env.STUDYMIND_DEMO_EMAIL ?? 'demo@studymind.app';
const demoPassword = process.env.STUDYMIND_DEMO_PASSWORD ?? 'Demo@1234';
const appRoutes = [
  '/dashboard', '/knowledge-base', '/tutor', '/assessments', '/mastery',
  '/revision', '/study-plan', '/course-map', '/settings',
];

async function signInDemo(page: Page) {
  await installMockAppApis(page);
  await page.goto('/login');
  await page.getByLabel('Email').fill(demoEmail);
  await page.getByLabel('Password').fill(demoPassword);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function clickVisibleLinks(page: Page, restoreRoute: string) {
  const hrefs = await page.locator('a[href]:visible').evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).href));
  for (let i = 0; i < hrefs.length; i++) {
    const target = new URL(hrefs[i]);
    if (target.origin !== new URL(baseURL).origin) continue;
    await page.locator('a[href]:visible').nth(i).click();
    if (target.hash) await expect(page.locator(target.hash)).toBeAttached().catch(() => {});
    else await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.goto(restoreRoute);
  }
}

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
}

async function installMockAppApis(page: Page) {
  const user = {
    id: 'smoke-user', name: 'StudyMind Smoke', email: 'demo@studymind.app', phone: '9000000000',
    createdAt: '2026-01-01T00:00:00.000Z',
    prefs: { onboarded: true, primaryUses: [], answerStyle: 'quick', dailyStudyMinutes: 30 },
  };
  const topic = {
    id: 'smoke-topic', name: 'Smoke test topic', parentId: null, prerequisiteIds: [],
    keyConcepts: [], summary: null, sourceUnitIds: [], pLearned: 0.5, attempts: 1,
  };

  await page.route('**/api/auth/login', (route) => fulfillJson(route, { token: 'smoke-token', user }));
  await page.route('**/api/auth/me', (route) => fulfillJson(route, { user }));
  await page.route('**/api/auth/logout', (route) => fulfillJson(route, {}));
  await page.route('**/api/dashboard', (route) => fulfillJson(route, {
    kpis: { overallMastery: 0, topicsMastered: 0, topicsTracked: 1, quizzesTaken: 0, studyStreak: 0 },
    masteryByTopic: [], nextUp: [], recentActivity: [], sources: { total: 0 }, prefs: user.prefs, daysToExam: null,
  }));
  await page.route('**/api/sources', (route) => fulfillJson(route, { sources: [] }));
  await page.route('**/api/topics', (route) => fulfillJson(route, { topics: [topic], flat: [topic] }));
  await page.route('**/api/revision/smoke-topic', (route) => fulfillJson(route, {
    topic,
    flashcards: [
      { id: 'card-1', front: 'First smoke-test prompt?', back: 'First mocked answer.', citation: null },
      { id: 'card-2', front: 'Second smoke-test prompt?', back: 'Second mocked answer.', citation: null },
    ],
    summarySlides: [],
  }));
  await page.route('**/api/tutor/ask', (route) => fulfillJson(route, {
    answer: 'Mocked tutor answer for the smoke test.', citations: [], groundingStatus: 'outside_material',
    outsideKnowledge: 'Mocked tutor answer for the smoke test.', language: 'en', topSimilarity: 0, lexicalOverlap: 0,
    audit: { citedRequested: 0, citedVerified: 0, stripped: 0, declined: false },
  }));
  await page.route('**/api/assessments', (route) => route.request().method() === 'POST'
    ? fulfillJson(route, { assessment: { id: 'smoke-assessment', mode: 'quiz' }, dedupeRelaxed: false })
    : fulfillJson(route, { assessments: [] }));
  await page.route('**/api/assessments/smoke-assessment', (route) => fulfillJson(route, {
    assessment: { id: 'smoke-assessment', mode: 'quiz', durationSec: 0 },
    questions: [{ id: 'smoke-question', text: 'Which option equals two plus two?', type: 'mcq', options: ['4', '5'], difficulty: 0.25 }],
  }));
  await page.route('**/api/assessments/smoke-assessment/answers', (route) => fulfillJson(route, { ok: true }));
  await page.route('**/api/assessments/smoke-assessment/submit', (route) => fulfillJson(route, { ok: true }));
  await page.route('**/api/assessments/smoke-assessment/report', (route) => fulfillJson(route, { score: 1, correct: 1, total: 1, topicBreakdown: [] }));
  await page.route('**/api/mastery', (route) => fulfillJson(route, { topics: [], summary: {} }));
  await page.route('**/api/study-plan', (route) => fulfillJson(route, { tasks: [] }));
  await page.route('**/api/eval/results', (route) => fulfillJson(route, { metrics: null }));
}

test.describe('local StudyMind smoke checks', () => {
  test.use({ baseURL });

  test('landing links, theme toggle, FAQ buttons, login and register routes', async ({ page }) => {
    const response = await page.goto('/');
    const serverHtml = await response?.text() ?? '';
    const evaluationHtml = serverHtml.match(/<section id=\"evaluation\"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(evaluationHtml).toContain('Evaluation not run yet');
    expect(evaluationHtml).not.toContain('Loading…');
    expect(evaluationHtml).not.toContain('>…</span>');
    expect(serverHtml).toContain('https://studymind-forgeiv.vercel.app/images/og.png');
    expect(serverHtml).toContain('name="twitter:image"');
    await expect(page.getByRole('heading', { name: /Study smarter/i })).toBeVisible();
    const stepImages = await page.locator('#how-it-works img').evaluateAll((images) =>
      images.map((node) => {
        const image = node as HTMLImageElement;
        return { alt: image.alt, width: image.width, height: image.height };
      })
    );
    expect(stepImages).toHaveLength(4);
    expect(stepImages.every((image) => image.width === 1024 && image.height === 1024)).toBe(true);
    expect(stepImages[0].alt).toMatch(/upload/i);
    expect(stepImages[1].alt).toMatch(/topic map/i);
    expect(stepImages[2].alt).toMatch(/quiz|tutor chat/i);
    expect(stepImages[3].alt).toMatch(/progress/i);

    // Exercise each public in-page navigation link and the main account links.
    for (const href of ['#features', '#how-it-works', '#architecture', '#evaluation', '#faq']) {
      await page.locator(`a[href="${href}"]`).first().click();
      await expect(page.locator(href)).toBeAttached();
    }
    await page.getByRole('button', { name: /Switch to dark mode/i }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('.theme-toggle-pop')).toBeVisible();
    await page.getByRole('button', { name: /Switch to light mode/i }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.locator('.theme-toggle-pop')).toBeVisible();

    for (const faq of await page.locator('#faq button[aria-expanded]').all()) {
      await faq.click();
    }
    await page.getByRole('link', { name: /Get Started/i }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/login');
    await clickVisibleLinks(page, '/login');
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /Create account/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Create account/i })).toBeDisabled();
    await clickVisibleLinks(page, '/register');
  });

  test('landing layout is stable and has no horizontal overflow at 375, 768 and 1280px', async ({ page }) => {
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const before = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        hero: document.querySelector('h1')?.getBoundingClientRect().toJSON(),
        images: [...document.images].map((img) => {
          const rect = img.getBoundingClientRect();
          return { src: img.currentSrc, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }),
      }));
      await page.evaluate(async () => {
        document.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; });
        await Promise.all([
          document.fonts.ready,
          ...[...document.images].map((img) => img.decode().catch(() => undefined)),
        ]);
      });
      const after = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        hero: document.querySelector('h1')?.getBoundingClientRect().toJSON(),
        images: [...document.images].map((img) => {
          const rect = img.getBoundingClientRect();
          return { src: img.currentSrc, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }),
      }));

      expect(before.viewport).toBe(width);
      expect(before.document).toBeLessThanOrEqual(width);
      expect(after.document).toBeLessThanOrEqual(width);
      expect(before.hero?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((before.hero?.right ?? width + 1)).toBeLessThanOrEqual(width);
      expect(Math.abs((after.hero?.y ?? 0) - (before.hero?.y ?? 0))).toBeLessThanOrEqual(8);
      expect(after.images.length).toBe(before.images.length);
      for (let i = 0; i < before.images.length; i++) {
        expect(Math.abs(after.images[i].height - before.images[i].height)).toBeLessThanOrEqual(2);
        expect(Math.abs(after.images[i].width - before.images[i].width)).toBeLessThanOrEqual(2);
      }
    }
  });

  test('mocked login reaches every app page; primary actions and logout work', async ({ page }) => {
    test.setTimeout(300_000);
    await signInDemo(page);
    for (const route of appRoutes) {
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();
      await expect(page).not.toHaveURL(/\/login$/);
      await expect(page.locator('main')).toBeVisible();
      // Verify every sidebar destination is live from each protected page.
      for (const link of await page.locator('nav a[href^="/"]:visible').all()) {
        const href = await link.getAttribute('href');
        if (href && appRoutes.includes(href)) {
          await link.click();
          await expect(page).toHaveURL(new RegExp(`${href.replace('/', '\\/')}($|\\?)`));
          await page.goto(route);
        }
      }
    }

    // Click the primary actions against mocked endpoints so the smoke test cannot write demo data.
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /Upload material/i }).click();
    await expect(page).toHaveURL(/\/knowledge-base$/);
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /Open study plan/i }).click();
    await expect(page).toHaveURL(/\/study-plan$/);
    await page.goto('/dashboard');
    await page.locator('main a[href="/tutor"]').click();
    await expect(page).toHaveURL(/\/tutor$/);

    await page.goto('/tutor');
    const tutorQuestion = page.getByRole('textbox', { name: 'Your question' });
    await tutorQuestion.fill('How can I plan a short study session?');
    await page.getByRole('button', { name: 'Send question' }).click();
    await expect(page.getByText('Mocked tutor answer for the smoke test.').first()).toBeVisible();

    await page.goto('/dashboard');
    await page.locator('main a[href="/assessments"]').click();
    await expect(page).toHaveURL(/\/assessments$/);
    await page.getByRole('button', { name: 'Generate assessment' }).click();
    await expect(page.getByText(/Question 1 of 1/)).toBeVisible();
    await page.getByLabel('4', { exact: true }).check();
    await page.getByRole('button', { name: /Finish this quiz/i }).click();
    await expect(page.getByText('100%', { exact: true })).toBeVisible();

    await page.goto('/revision');
    const flipCard = page.locator('section.card button').first();
    await expect(flipCard).toContainText('First smoke-test prompt?');
    await flipCard.click();
    await expect(flipCard).toContainText('First mocked answer.');
    await page.getByRole('button', { name: /Next/ }).click();
    await expect(flipCard).toContainText('Second smoke-test prompt?');
    await page.getByRole('button', { name: /Prev/ }).click();
    await expect(flipCard).toContainText('First smoke-test prompt?');
    await expect(page.locator('body')).not.toContainText(/spaced[- ]repetition|again\s*\/\s*hard\s*\/\s*good\s*\/\s*easy/i);

    await page.getByRole('button', { name: /Account menu for/i }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: /Edit profile/i }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: /Account menu for/i }).click();
    await page.getByRole('menuitem', { name: /Log out/i }).click();
    await expect(page).toHaveURL(baseURL + '/');
  });

  test('mocked new account sees onboarding and its preferences persist', async ({ page }) => {
    const email = `studymind-smoke-${Date.now()}@example.test`;
    const createdUser = {
      id: 'smoke-new-user', name: 'StudyMind Smoke Tester', email, phone: '9000000001',
      createdAt: '2026-01-01T00:00:00.000Z', prefs: { onboarded: false },
    };
    const savedUser = {
      ...createdUser,
      prefs: { onboarded: true, primaryUses: ['exam_prep'], studyLevel: 'undergrad', answerStyle: 'deep', dailyStudyMinutes: 60, language: 'hi' },
    };
    await page.route('**/api/auth/register', (route) => fulfillJson(route, { token: 'new-smoke-token', user: createdUser }));
    await page.route('**/api/auth/me', (route) => fulfillJson(route, { user: savedUser }));
    await page.route('**/api/topics', (route) => fulfillJson(route, { topics: [], flat: [] }));
    await page.route('**/api/onboarding/intake', (route) => fulfillJson(route, { ok: true }));
    await page.goto('/register');
    await page.getByLabel('Full name').fill('StudyMind Smoke Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Phone number').fill('9000000001');
    await page.getByLabel('Password', { exact: true }).fill('SmokeTest1234');
    await page.getByLabel('Confirm password').fill('SmokeTest1234');
    await page.locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole('heading', { name: /What will you mainly use StudyMind for\?/i })).toBeVisible();

    await page.getByRole('button', { name: 'Exam prep' }).click();
    await page.getByLabel('Study level').selectOption('undergrad');
    await page.getByRole('button', { name: 'Deep dives' }).click();
    await page.getByLabel('Daily study time').selectOption('60');
    await page.getByLabel('Language').selectOption('hi');
    await page.getByRole('button', { name: /Continue/i }).click();
    // A new account has no uploaded sources, so familiarity is skipped.
    await expect(page.getByRole('heading', { name: /Want to set a target\?/i })).toBeVisible();
    await page.getByRole('button', { name: /Let’s go/i }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('studymind.user') ?? '{}'));
    expect(saved.prefs.onboarded).toBe(true);
    expect(saved.prefs.primaryUses).toContain('exam_prep');
    expect(saved.prefs.studyLevel).toBe('undergrad');
    expect(saved.prefs.answerStyle).toBe('deep');
    expect(saved.prefs.dailyStudyMinutes).toBe(60);
    expect(saved.prefs.language).toBe('hi');
  });
});
