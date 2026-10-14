import { test, expect } from '@playwright/test';

const assessmentId = 'assessment-timer-regression';
const questionId = 'question-timer-regression';

test('timer finalization persists the UI-held answer before submitting exactly once', async ({ page }) => {
  const requests: Array<{ url: string; body?: any }> = [];
  const savedAnswers: any[] = [];
  let submitCount = 0;
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      nativeSetInterval(handler, timeout === 1000 ? 50 : timeout, ...args)) as typeof window.setInterval;
    localStorage.setItem('studymind.token', 'e2e-token');
    localStorage.setItem('studymind.user', JSON.stringify({
      id: 'learner-1', name: 'Timer Test', email: 'timer@example.test', phone: '+919999999999',
      createdAt: new Date().toISOString(), prefs: { onboarded: true },
    }));
  });

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postDataJSON?.() ?? undefined;
    requests.push({ url: url.pathname, body });
    const json = (value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

    if (url.pathname === '/api/auth/me') return json({ user: {
      id: 'learner-1', name: 'Timer Test', email: 'timer@example.test', phone: '+919999999999',
      createdAt: new Date().toISOString(), prefs: { onboarded: true },
    } });
    if (url.pathname === '/api/assessments' && request.method() === 'GET') return json({ assessments: [] });
    if (url.pathname === '/api/assessments' && request.method() === 'POST') return json({ assessment: { id: assessmentId } }, 201);
    if (url.pathname === `/api/assessments/${assessmentId}` && request.method() === 'GET') return json({
      assessment: { id: assessmentId, mode: 'mock', durationSec: 60 },
      questions: [{ id: questionId, type: 'short', text: 'Describe the saved answer.', difficulty: 0.5 }],
    });
    if (url.pathname === `/api/assessments/${assessmentId}/answers` && request.method() === 'POST') {
      savedAnswers.push(body);
      await new Promise((resolve) => setTimeout(resolve, 60));
      return json({ recorded: true, questionId });
    }
    if (url.pathname === `/api/assessments/${assessmentId}/submit` && request.method() === 'POST') {
      submitCount++;
      return json({ assessmentId, score: 1, correct: 1, total: 1, unanswered: 0 });
    }
    if (url.pathname === `/api/assessments/${assessmentId}/report` && request.method() === 'GET') return json({
      score: 1, correct: 1, total: 1, weakTopics: [], topicBreakdown: [], misconceptions: [],
    });
    return json({ error: { code: 'UNEXPECTED_E2E_REQUEST', message: `${request.method()} ${url.pathname}` } }, 500);
  });

  await page.goto('/assessments');
  await page.getByRole('button', { name: 'mock', exact: false }).click();
  await page.getByRole('button', { name: /Generate assessment/i }).click();
  const answer = page.getByPlaceholder('Answer in your own words…');
  await expect(answer).toBeVisible();
  await answer.fill('The UI-held answer survives timer finalization.');
  await expect(page.getByText('0:00')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('100%', { exact: true })).toBeVisible({ timeout: 5_000 });

  expect(savedAnswers).toEqual([{ questionId, answer: 'The UI-held answer survives timer finalization.' }]);
  expect(submitCount).toBe(1);
  const answerPath = `/api/assessments/${assessmentId}/answers`;
  const submitPath = `/api/assessments/${assessmentId}/submit`;
  expect(requests.findIndex((request) => request.url === answerPath)).toBeGreaterThanOrEqual(0);
  expect(requests.findIndex((request) => request.url === answerPath)).toBeLessThan(requests.findIndex((request) => request.url === submitPath));
});
