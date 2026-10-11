/**
 * FIX 9.2 — Markdown + LaTeX rendering with raw HTML disabled.
 *
 * Model output is untrusted, so the renderer must DROP html rather than render
 * it. This is a component-level test (no browser DOM available here); the
 * KaTeX visual rendering itself is only manually verifiable.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';

function render(md: string): string {
  const proc = unified()
    .use(remarkParse)
    .use(remarkMath)
    .use(remarkRehype)          // NOTE: no rehype-raw — raw HTML is NOT enabled
    .use(rehypeKatex)
    .use(rehypeStringify);
  return String(proc.processSync(md));
}

describe('markdown + latex', () => {
  test('renders inline math through katex', () => {
    const html = render('The relation is $E=mc^2$ in physics.');
    assert.match(html, /katex/, 'expected katex markup for $...$');
  });

  test('renders block math through katex', () => {
    const html = render('$$\\frac{a}{b} = c$$');
    assert.match(html, /katex/);
  });

  test('renders a fenced code block', () => {
    const html = render('```python\nprint("hi")\n```');
    assert.match(html, /<pre>/);
    assert.match(html, /language-python/);
  });

  test('does NOT execute raw html (no rehype-raw in the pipeline)', () => {
    const html = render('<img src=x onerror="alert(1)">');
    assert.doesNotMatch(
      html,
      /<img[^>]*onerror/i,
      'raw html with an event handler must not survive into the output'
    );
  });

  test('renders markdown emphasis and lists', () => {
    const html = render('**bold** and _italic_\n\n- one\n- two');
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<li>one<\/li>/);
  });
});
