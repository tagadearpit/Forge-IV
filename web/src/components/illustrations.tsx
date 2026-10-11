/**
 * Original SVG illustrations (no external image dependencies — nothing here can
 * 404 or require a licence). Each is inline so it themes correctly via
 * currentColor / CSS variables in both light and dark mode.
 */

export function ArchitectureDiagram({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 860 300" className={className} role="img" aria-label="System architecture diagram">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#94A3B8" />
        </marker>
      </defs>

      {/* layers */}
      {[
        { x: 16, label: 'Browser', sub: 'Next.js 14 · Vercel', color: '#4F46E5' },
        { x: 236, label: 'Express API', sub: 'TypeScript · Replit', color: '#6366F1' },
        { x: 456, label: 'MongoDB Atlas', sub: 'Mongoose', color: '#22C55E' },
        { x: 676, label: 'Gemini API', sub: 'text · vision · embed', color: '#F59E0B' },
      ].map((b) => (
        <g key={b.label}>
          <rect x={b.x} y="100" width="168" height="82" rx="14" fill="#fff" stroke={b.color} strokeWidth="1.6" />
          <rect x={b.x} y="100" width="168" height="6" rx="3" fill={b.color} />
          <text x={b.x + 16} y="136" fontSize="14" fontWeight="600" fill="#0F172A">{b.label}</text>
          <text x={b.x + 16} y="158" fontSize="11" fill="#64748B">{b.sub}</text>
        </g>
      ))}

      <g stroke="#94A3B8" strokeWidth="1.6" markerEnd="url(#arrow)" fill="none">
        <path d="M188 141 L 232 141" />
        <path d="M408 141 L 452 141" />
        <path d="M560 182 C 560 240, 760 240, 760 190" />
      </g>

      <text x="196" y="132" fontSize="10" fill="#64748B" fontFamily="ui-monospace, monospace">HTTPS + JWT</text>

      {/* ingestion lane */}
      <g>
        <rect x="236" y="222" width="168" height="56" rx="12" fill="#F8FAFC" stroke="#CBD5E1" strokeDasharray="4 3" />
        <text x="252" y="246" fontSize="12" fontWeight="600" fill="#334155">Ingestion workers</text>
        <text x="252" y="264" fontSize="10" fill="#64748B">PDF · PPTX · video → chunks</text>
      </g>
      <g stroke="#94A3B8" strokeWidth="1.6" markerEnd="url(#arrow)" fill="none">
        <path d="M320 222 L 320 190" />
        <path d="M452 250 L 410 250" />
      </g>
    </svg>
  );
}

/** Small step icon for the How It Works timeline. */
export function StepIcon({ index }: { index: number }) {
  const icons = [
    <path key="a" d="M12 16V4m0 0L8 8m4-4 4 4M4 20h16" />,
    <path key="b" d="M4 6h16M4 12h10M4 18h7" />,
    <path key="c" d="M8 10h8M9 15h6M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />,
    <path key="d" d="M4 19V9m5 10V5m5 14v-7m5 7V8" />,
  ];
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {icons[index % icons.length]}
    </svg>
  );
}