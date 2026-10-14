'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { EmptyState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { SafeImage } from '@/components/safe-image';

/**
 * Topic prerequisite graph, laid out by level with original SVG edges.
 * A full force-directed layout (React Flow / D3) is a stretch goal; this is a
 * deterministic layered graph that renders with zero extra dependencies and
 * stays readable on a 375px screen.
 */
export default function CourseMapPage() {
  const [flat, setFlat] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    api.topics().then((r) => setFlat(r.flat)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const { nodes, edges, byId } = useMemo(() => {
    const byId = new Map(flat.map((t) => [t.id, t]));
    const edges: Array<{ from: string; to: string }> = [];
    for (const t of flat) {
      for (const p of t.prerequisiteIds ?? []) edges.push({ from: p, to: t.id });
    }
    // Depth = longest prerequisite chain, so prerequisites always sit above.
    const depth = new Map<string, number>();
    const calc = (id: string, guard = new Set<string>()): number => {
      if (depth.has(id)) return depth.get(id)!;
      if (guard.has(id)) return 0;
      guard.add(id);
      const t = byId.get(id);
      const deps = (t?.prerequisiteIds ?? []).filter((p: string) => byId.has(p));
      const d = deps.length ? Math.max(...deps.map((p: string) => calc(p, guard))) + 1 : 0;
      depth.set(id, d);
      return d;
    };
    flat.forEach((t) => calc(t.id));

    const levels: Record<number, any[]> = {};
    flat.forEach((t) => {
      const d = depth.get(t.id) ?? 0;
      (levels[d] ??= []).push(t);
    });

    const NODE_W = 168, NODE_H = 56, GAP_X = 28, GAP_Y = 92;
    const nodes = Object.entries(levels).flatMap(([d, items]) =>
      items.map((t, i) => ({
        ...t,
        x: 40 + i * (NODE_W + GAP_X),
        y: 40 + Number(d) * (NODE_H + GAP_Y),
        w: NODE_W,
        h: NODE_H,
      }))
    );

    const map = new Map(nodes.map((n) => [n.id, n]));
    const validEdges = edges.filter((e) => map.has(e.from) && map.has(e.to));
    return { nodes, edges: validEdges, byId: map };
  }, [flat]);

  if (loading) return <div className="space-y-3">{[0,1,2].map(i => <Skeleton key={i} className="h-24" />)}</div>;
  if (!flat.length)
    return <EmptyState icon={<SafeImage src="/images/empty-map.webp" alt="Clay-style open book with connected topic bubbles illustrating a course map" width={1024} height={1024} sizes="(max-width: 640px) 70vw, 280px" wrapperClassName="mx-auto w-full max-w-[280px] rounded-2xl" className="h-full w-full object-cover" />} title="Your course map is waiting for its first topic" description="Add study material and I’ll sketch out how the ideas connect." />;

  const width = Math.max(...nodes.map((n) => n.x + n.w)) + 40;
  const height = Math.max(...nodes.map((n) => n.y + n.h)) + 40;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Course map</h1>
        <p className="mt-1 text-sm text-muted">
          Topics and prerequisites, coloured by your mastery. Node height reflects mastery; dashed
          arrows are prerequisite links.
        </p>
      </div>

      <div className="card overflow-x-auto p-4">
        <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[640px] w-full" role="img" aria-label="Course prerequisite map">
          <defs>
            <marker id="prereq" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
              <path d="M0,0 L0,6 L7,3 z" fill="#94A3B8" />
            </marker>
          </defs>

          {edges.map((e, i) => {
            const a = byId.get(e.from)!, b = byId.get(e.to)!;
            const x1 = a.x + a.w / 2, y1 = a.y + a.h;
            const x2 = b.x + b.w / 2, y2 = b.y;
            return (
              <path key={i} d={`M${x1},${y1} C ${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`}
                    fill="none" stroke="#94A3B8" strokeWidth="1.4" strokeDasharray="4 3" markerEnd="url(#prereq)"
                    opacity={hover && hover !== e.from && hover !== e.to ? 0.2 : 0.8} />
            );
          })}

          {nodes.map((n) => {
            const fill = n.pLearned < 0.4 ? '#ef4444' : n.pLearned <= 0.7 ? '#f59e0b' : '#22c55e';
            return (
              <g key={n.id} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
                 className="cursor-pointer" opacity={hover && hover !== n.id ? 0.45 : 1}>
                <rect x={n.x} y={n.y} width={n.w} height={n.h} rx="12" fill="rgb(var(--card))" stroke={fill} strokeWidth="2" />
                <rect x={n.x} y={n.y} width={n.w} height="5" rx="2.5" fill={fill} />
                <text x={n.x + 12} y={n.y + 28} fontSize="12" fontWeight="600" fill="rgb(var(--fg))">
                  {n.name.length > 20 ? `${n.name.slice(0, 19)}…` : n.name}
                </text>
                <text x={n.x + 12} y={n.y + 45} fontSize="11" fill="rgb(var(--muted))" fontFamily="ui-monospace, monospace">
                  {Math.round(n.pLearned * 100)}% · {n.attempts} attempts
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {hover && byId.get(hover) && (
        <div className="card p-4">
          <h2 className="flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4 text-brand-600" aria-hidden /> {byId.get(hover)!.name}</h2>
          {byId.get(hover)!.summary && <p className="mt-2 text-sm text-muted">{byId.get(hover)!.summary}</p>}
          {byId.get(hover)!.keyConcepts?.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {byId.get(hover)!.keyConcepts.map((c: string) => (
                <span key={c} className="chip bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-300">{c}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs text-muted">
        {[['weak','#ef4444'],['developing','#f59e0b'],['strong','#22c55e']].map(([l, c]) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c }} aria-hidden />{l}
          </span>
        ))}
      </div>
    </div>
  );
}
