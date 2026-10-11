/**
 * Original SVG illustrations (no external image dependencies — nothing here can
 * 404 or require a licence). Each is inline so it themes correctly via
 * currentColor / CSS variables in both light and dark mode.
 */

export function HeroArt({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 520 420"
      className={className}
      role="img"
      aria-label="A document being ingested into a knowledge graph, with cited answers flowing back"
    >
      <defs>
        <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
        <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818CF8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#818CF8" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* soft background wash */}
      <circle cx="260" cy="200" r="180" fill="url(#g2)" />

      {/* --- source documents --- */}
      <g>
        <rect x="28" y="96" width="104" height="128" rx="12" fill="#fff" stroke="#CBD5E1" />
        <rect x="42" y="116" width="76" height="7" rx="3.5" fill="#CBD5E1" />
        <rect x="42" y="132" width="62" height="7" rx="3.5" fill="#CBD5E1" />
        <rect x="42" y="148" width="70" height="7" rx="3.5" fill="#CBD5E1" />
        <rect x="42" y="164" width="48" height="7" rx="3.5" fill="#E2E8F0" />
        <text x="44" y="204" fontSize="11" fill="#64748B" fontFamily="ui-monospace, monospace">PDF p.87</text>
      </g>

      <g>
        <rect x="28" y="244" width="104" height="82" rx="12" fill="#fff" stroke="#CBD5E1" />
        <rect x="42" y="260" width="76" height="7" rx="3.5" fill="#CBD5E1" />
        <rect x="42" y="276" width="58" height="7" rx="3.5" fill="#E2E8F0" />
        <text x="44" y="308" fontSize="11" fill="#64748B" fontFamily="ui-monospace, monospace">Slide 12</text>
      </g>

      {/* --- ingestion arrow --- */}
      <path
        d="M142 180 C 178 180, 186 190, 214 200"
        stroke="#94A3B8"
        strokeWidth="2"
        strokeDasharray="5 5"
        fill="none"
      />
      <circle cx="220" cy="202" r="4" fill="#94A3B8" />

      {/* --- knowledge core --- */}
      <g>
        <circle cx="288" cy="200" r="66" fill="url(#g1)" />
        <circle cx="288" cy="200" r="66" fill="none" stroke="#4F46E5" strokeWidth="0" />
        <g stroke="#fff" strokeOpacity="0.65" strokeWidth="1.6" fill="none">
          <circle cx="288" cy="200" r="44" />
          <circle cx="288" cy="200" r="26" />
        </g>
        <g fill="#fff">
          <circle cx="288" cy="156" r="6" />
          <circle cx="332" cy="200" r="6" />
          <circle cx="288" cy="244" r="6" />
          <circle cx="244" cy="200" r="6" />
          <circle cx="288" cy="174" r="3.5" />
          <circle cx="314" cy="200" r="3.5" />
          <circle cx="288" cy="226" r="3.5" />
          <circle cx="262" cy="200" r="3.5" />
        </g>
      </g>

      {/* --- cited answer card --- */}
      <g>
        <rect x="366" y="120" width="132" height="160" rx="14" fill="#fff" stroke="#CBD5E1" />
        <rect x="382" y="138" width="74" height="9" rx="4.5" fill="#4F46E5" />
        <rect x="382" y="158" width="100" height="6" rx="3" fill="#E2E8F0" />
        <rect x="382" y="170" width="88" height="6" rx="3" fill="#E2E8F0" />
        <rect x="382" y="182" width="94" height="6" rx="3" fill="#E2E8F0" />

        <rect x="382" y="204" width="74" height="20" rx="10" fill="#EEF2FF" />
        <text x="392" y="218" fontSize="10" fill="#4338CA" fontFamily="ui-monospace, monospace">
          p.87 · cited
        </text>
        <rect x="460" y="204" width="24" height="20" rx="10" fill="#F1F5F9" />
        <text x="465" y="218" fontSize="10" fill="#64748B" fontFamily="ui-monospace, monospace">
          4:12
        </text>

        <rect x="382" y="236" width="100" height="6" rx="3" fill="#E2E8F0" />
        <rect x="382" y="248" width="72" height="6" rx="3" fill="#F1F5F9" />
      </g>

      <path
        d="M358 190 C 366 190, 368 200, 372 202"
        stroke="#94A3B8"
        strokeWidth="2"
        strokeDasharray="5 5"
        fill="none"
      />
    </svg>
  );
}

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