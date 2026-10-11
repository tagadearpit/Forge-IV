'use client';

import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { cn } from '@/lib/utils';

/**
 * Markdown + LaTeX renderer for tutor answers, quiz questions and explanations.
 *
 * Raw HTML is deliberately DISABLED: no `rehype-raw`, no
 * `dangerouslySetInnerHTML`, no `skipHtml` bypass. Model output is untrusted,
 * and allowing raw HTML here would be a stored-XSS vector on every answer.
 * `skipHtml` DROPS any HTML tag rather than rendering it.
 */
export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn('text-sm leading-relaxed', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        skipHtml
        components={{
          a: ({ children: c, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">
              {c}
            </a>
          ),
          code: ({ className: cls, children: c, ...props }) => {
            const isBlock = /language-/.test(cls ?? '');
            return isBlock ? (
              <code
                {...props}
                className={cn(
                  'block overflow-x-auto rounded-lg bg-[color:rgb(var(--surface))] p-3 font-mono text-xs',
                  cls
                )}
              >
                {c}
              </code>
            ) : (
              <code
                {...props}
                className="rounded bg-[color:rgb(var(--surface))] px-1 py-0.5 font-mono text-[0.85em]"
              >
                {c}
              </code>
            );
          },
          p: ({ children: c }) => <p className="mb-2 last:mb-0">{c}</p>,
          ul: ({ children: c }) => <ul className="mb-2 list-disc pl-5">{c}</ul>,
          ol: ({ children: c }) => <ol className="mb-2 list-decimal pl-5">{c}</ol>,
          table: ({ children: c }) => (
            <div className="mb-2 overflow-x-auto">
              <table className="w-full text-xs">{c}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}