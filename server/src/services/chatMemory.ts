export interface PromptMessage { role: 'user' | 'assistant'; content: string }

/** Keep the most recent eight chat messages under an approximate 3,000-token character budget. */
export function promptHistory(rows: PromptMessage[]): PromptMessage[] {
  const selected = rows.slice(-8).map((m) => ({ role: m.role, content: m.content.length > 1600 ? `${m.content.slice(0, 1600)}… [truncated]` : m.content }));
  let budget = 12_000;
  const result: PromptMessage[] = [];
  for (const m of selected.reverse()) {
    if (budget <= 0) break;
    const content = m.content.slice(0, budget);
    result.unshift({ role: m.role, content });
    budget -= content.length;
  }
  return result;
}
