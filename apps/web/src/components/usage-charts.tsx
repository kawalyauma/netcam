import { useState, type PointerEvent } from "react";

// Reference categorical slots 1 and 2, validated as a pair on the light
// surface (CVD ΔE 24.7, contrast >= 3:1). Download is always blue, upload
// always orange, on every chart on the page.
export const DOWN_COLOR = "#2a78d6";
export const UP_COLOR = "#eb6834";
const GRID = "#e2e8f0";
const INK_MUTED = "#64748b";
const SURFACE = "#ffffff";

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(bytes >= 100 * 1024 ** 2 ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

/** bytes/second -> network speed in bits, the unit packages are sold in. */
export function formatRate(bytesPerSecond: number): string {
  const bits = bytesPerSecond * 8;
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(bits >= 10_000_000 ? 0 : 1)} Mbps`;
  if (bits >= 1_000) return `${Math.round(bits / 1_000)} kbps`;
  return bits > 0 ? `${Math.round(bits)} bps` : "0";
}

function niceMax(max: number) {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude * 4 >= max) ?? 10;
  return step * magnitude * 4;
}

export function SeriesLegend({ kind }: { kind: "line" | "rect" }) {
  return (
    <div className="flex gap-4 text-xs text-slate-600">
      {[
        { label: "Download", color: DOWN_COLOR },
        { label: "Upload", color: UP_COLOR },
      ].map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          {kind === "line" ? (
            <span className="inline-block w-4 h-0.5 rounded" style={{ background: s.color }} />
          ) : (
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
          )}
          {s.label}
        </span>
      ))}
    </div>
  );
}

export interface RatePoint {
  t: number;
  down: number; // bytes/s
  up: number;
}

/** Live download/upload speed, one shared bits/s axis, with a crosshair readout. */
export function LiveRateChart({ points, height = 220 }: { points: RatePoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const pad = { top: 10, right: 12, bottom: 24, left: 64 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  if (points.length < 2) {
    return <div className="h-40 flex items-center justify-center text-sm text-slate-400">Collecting live data…</div>;
  }

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const max = niceMax(Math.max(...points.map((p) => Math.max(p.down, p.up))));
  const x = (t: number) => pad.left + ((t - t0) / span) * plotW;
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const path = (key: "down" | "up") => points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const minutesAgo = (t: number) => Math.round((t1 - t) / 60_000);

  function onMove(e: PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const tAt = t0 + ((e.clientX - rect.left) / rect.width) * span;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(p.t - tAt) < Math.abs(points[best].t - tAt)) best = i;
    });
    setHover(best);
  }

  const h = hover !== null ? points[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Live download and upload speed">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
              {formatRate(t)}
            </text>
          </g>
        ))}
        {[t0, t0 + span / 2, t1].map((t) => (
          <text key={t} x={x(t)} y={height - 6} textAnchor={t === t0 ? "start" : t === t1 ? "end" : "middle"} fontSize={11} fill={INK_MUTED}>
            {t === t1 ? "now" : `${minutesAgo(t)} min ago`}
          </text>
        ))}
        <path d={path("up")} fill="none" stroke={UP_COLOR} strokeWidth={2} strokeLinejoin="round" />
        <path d={path("down")} fill="none" stroke={DOWN_COLOR} strokeWidth={2} strokeLinejoin="round" />
        {h && (
          <g>
            <line x1={x(h.t)} x2={x(h.t)} y1={pad.top} y2={pad.top + plotH} stroke={INK_MUTED} strokeWidth={1} />
            <circle cx={x(h.t)} cy={y(h.up)} r={4} fill={UP_COLOR} stroke={SURFACE} strokeWidth={2} />
            <circle cx={x(h.t)} cy={y(h.down)} r={4} fill={DOWN_COLOR} stroke={SURFACE} strokeWidth={2} />
          </g>
        )}
        <rect
          x={pad.left}
          y={pad.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {h && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow"
          style={{ left: `${Math.min(85, Math.max(15, (x(h.t) / width) * 100))}%` }}
        >
          <div className="text-slate-300">{new Date(h.t).toLocaleTimeString()}</div>
          {(["down", "up"] as const).map((k) => (
            <div key={k} className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5" style={{ background: k === "down" ? DOWN_COLOR : UP_COLOR }} />
              <span className="font-semibold">{formatRate(h[k])}</span>
              <span className="text-slate-300">{k === "down" ? "download" : "upload"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tiny single-series download trend for a table row; the row's text carries the numbers. */
export function Sparkline({ points }: { points: RatePoint[] }) {
  if (points.length < 2) return <span className="text-xs text-slate-400">—</span>;
  const w = 96;
  const h = 24;
  const max = Math.max(1, ...points.map((p) => p.down));
  const d = points
    .map((p, i) => `${i ? "L" : "M"}${((i / (points.length - 1)) * w).toFixed(1)},${(h - 1 - (p.down / max) * (h - 2)).toFixed(1)}`)
    .join("");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} fill="none" stroke={DOWN_COLOR} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

function topRoundedBar(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export interface UsageBucket {
  t: string; // local "YYYY-MM-DDTHH:MM"
  down: number; // bytes
  up: number;
}

/** Data used per hour/day, download stacked under upload, per-column hover readout. */
export function UsageColumns({ data, bucket }: { data: UsageBucket[]; bucket: "hour" | "day" }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 240;
  const pad = { top: 12, right: 8, bottom: 26, left: 60 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.down + d.up)));
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, band - 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.ceil(data.length / 8);
  const label = (t: string) => {
    const d = new Date(t);
    return bucket === "hour"
      ? d.toLocaleTimeString(undefined, { hour: "numeric" })
      : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  };
  const hovered = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Data used over time">
        {ticks.map((t) => {
          const yy = pad.top + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={yy} y2={yy} stroke={GRID} strokeWidth={1} />
              <text x={pad.left - 6} y={yy + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
                {t === 0 ? "0" : formatBytes(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = pad.left + band * i + (band - barW) / 2;
          const downH = (d.down / max) * plotH;
          const upH = (d.up / max) * plotH;
          const base = pad.top + plotH;
          const gap = downH > 0 && upH > 0 ? 2 : 0; // surface gap between stacked segments
          const dim = hover !== null && hover !== i ? 0.45 : 1;
          return (
            <g key={d.t} opacity={dim}>
              {downH > 0 && (
                upH > 0 ? (
                  <rect x={x} y={base - downH} width={barW} height={downH} fill={DOWN_COLOR} />
                ) : (
                  <path d={topRoundedBar(x, base - downH, barW, downH, 4)} fill={DOWN_COLOR} />
                )
              )}
              {upH > 0 && <path d={topRoundedBar(x, base - downH - gap - upH, barW, upH, 4)} fill={UP_COLOR} />}
              {i % labelEvery === 0 && (
                <text x={pad.left + band * i + band / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
                  {label(d.t)}
                </text>
              )}
              <rect
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow"
          style={{ left: `${Math.min(85, Math.max(15, ((pad.left + band * hover + band / 2) / width) * 100))}%` }}
        >
          <div className="text-slate-300">
            {bucket === "hour" ? new Date(hovered.t).toLocaleString(undefined, { weekday: "short", hour: "numeric" }) : label(hovered.t)}
          </div>
          <div className="font-semibold">{formatBytes(hovered.down + hovered.up)} total</div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5" style={{ background: DOWN_COLOR }} />
            {formatBytes(hovered.down)} <span className="text-slate-300">download</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5" style={{ background: UP_COLOR }} />
            {formatBytes(hovered.up)} <span className="text-slate-300">upload</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ranked bars in one color (bar length is the magnitude), value in text ink. */
export function ByteBars({ rows, empty = "No data yet" }: { rows: Array<{ label: string; value: number; detail?: string }>; empty?: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-400">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex justify-between text-sm mb-1 gap-3">
            <span className="text-slate-700 truncate">{r.label}</span>
            <span className="text-slate-900 font-medium whitespace-nowrap">
              {formatBytes(r.value)}
              {r.detail && <span className="ml-2 text-xs font-normal text-slate-500">{r.detail}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full" style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, background: DOWN_COLOR }} />
          </div>
        </div>
      ))}
    </div>
  );
}
