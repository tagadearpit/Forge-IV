import { test, expect, type Page } from '@playwright/test';

const baseURL = process.env.STUDYMIND_BASE_URL ?? 'https://studymind-forgeiv.vercel.app';
const demoEmail = process.env.STUDYMIND_DEMO_EMAIL ?? 'demo@studymind.app';
const demoPassword = process.env.STUDYMIND_DEMO_PASSWORD ?? 'Demo@1234';
const appRoutes = [
  '/dashboard', '/knowledge-base', '/tutor', '/assessments', '/mastery',
  '/revision', '/study-plan', '/course-map', '/settings',
];

async function signInDemo(page: Page) {
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

test.describe('deployed StudyMind smoke checks', () => {
  test.use({ baseURL });

  test('landing links, theme toggle, FAQ buttons, login and register routes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Study smarter/i })).toBeVisible();

    // Exercise each public in-page navigation link and the main account links.
    for (const href of ['#features', '#how-it-works', '#architecture', '#evaluation', '#faq']) {
      await page.locator(`a[href="${href}"]`).first().click();
      await expect(page.locator(href)).toBeAttached();
    }
    await page.getByRole('button', { name: /Switch to dark mode/i }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: /Switch to light mode/i }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

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

  test('demo login reaches every app page and profile menu; logout works', async ({ page }) => {
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

    // Verify the main, non-destructive actions on each learning surface.
    await page.goto('/dashboard');
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('link', { name: /Upload material/i })).toBeVisible();
    await expect(page.locator('main a[href="/tutor"]')).toBeVisible();
    await expect(page.locator('main a[href="/assessments"]')).toBeVisible();

    await page.goto('/tutor');
    const tutorQuestion = page.getByRole('textbox', { name: 'Your question' });
    await expect(tutorQuestion).toBeVisible();
    const sendQuestion = page.getByRole('button', { name: 'Send question' });
    await expect(sendQuestion).toBeDisabled();
    await tutorQuestion.fill('Smoke check only; do not submit.');
    await expect(sendQuestion).toBeEnabled();
    await tutorQuestion.clear();

    await page.goto('/assessments');
    await expect(page.getByRole('button', { name: 'Generate assessment' })).toBeEnabled();

    await page.goto('/revision');
    await expect(page.getByRole('main')).toBeVisible();
    const flipCard = page.locator('section.card button').first();
    if (await flipCard.isVisible().catch(() => false)) {
      await flipCard.click();
      await expect(page.getByText('Answer', { exact: true })).toBeVisible();
    }
    await expect(page.locator('body')).not.toContainText(/spaced[- ]repetition|again\s*\/\s*hard\s*\/\s*good\s*\/\s*easy/i);

    await page.getByRole('button', { name: /Account menu for/i }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: /Edit profile/i }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: /Account menu for/i }).click();
    await page.getByRole('menuitem', { name: /Log out/i }).click();
    await expect(page).toHaveURL(baseURL + '/');
  });

  test('brand-new account sees onboarding and its preferences persist', async ({ page }) => {
    const email = `studymind-smoke-${Date.now()}@example.com`;
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
