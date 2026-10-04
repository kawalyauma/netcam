import { useState } from "react";

const ACCENT = "#1d6f42";
const GRID = "#e2e8f0";
const INK_MUTED = "#64748b";

export function formatUgxCompact(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

function niceMax(max: number) {
  if (max <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * magnitude * 4 >= max) ?? 10;
  return step * magnitude * 4;
}

/** Top-rounded bar anchored flat on the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  revenueUgx: number;
  mobileMoneyUgx?: number;
  voucherUgx?: number;
  payments: number;
}

/** Single-series daily revenue columns with a per-day hover tooltip. */
export function DailyRevenueChart({ data }: { data: DailyPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const height = 240;
  const pad = { top: 12, right: 8, bottom: 26, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...data.map((d) => d.revenueUgx)));
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, band - 2); // 2px surface gap between neighbours
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.ceil(data.length / 8);
  const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

  const hovered = hover !== null ? data[hover] : null;
  const hoverLeftPct = hover !== null ? ((pad.left + band * hover + band / 2) / width) * 100 : 0;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Daily revenue">
        {ticks.map((t) => {
          const y = pad.top + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
                {formatUgxCompact(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const h = (d.revenueUgx / max) * plotH;
          const x = pad.left + band * i + (band - barW) / 2;
          return (
            <g key={d.date}>
              {h > 0 && (
                <path
                  d={barPath(x, pad.top + plotH - h, barW, h, 4)}
                  fill={ACCENT}
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={pad.left + band * i + band / 2} y={height - 8} textAnchor="middle" fontSize={11} fill={INK_MUTED}>
                  {fmtDay(d.date)}
                </text>
              )}
              {/* Hit target spans the whole column, much larger than the bar itself. */}
              <rect
                x={pad.left + band * i}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow"
          style={{ left: `${Math.min(88, Math.max(12, hoverLeftPct))}%` }}
        >
          <div className="font-medium">{fmtDay(hovered.date)}</div>
          <div>UGX {hovered.revenueUgx.toLocaleString()}</div>
          {hovered.voucherUgx !== undefined && hovered.mobileMoneyUgx !== undefined && hovered.revenueUgx > 0 && (
            <div className="text-slate-300">
              Mobile money {hovered.mobileMoneyUgx.toLocaleString()} · Vouchers {hovered.voucherUgx.toLocaleString()}
            </div>
          )}
          <div className="text-slate-300">
            {hovered.payments} sale{hovered.payments === 1 ? "" : "s"}
          </div>
        </div>
      )}
    </div>
  );
}

/** Ranked horizontal bars with the value direct-labelled in text ink. */
export function RankedBars({ rows }: { rows: Array<{ label: string; value: number; detail?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} title={r.detail}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-700">{r.label}</span>
            <span className="text-slate-900 font-medium">UGX {r.value.toLocaleString()}</span>
          </div>
          <div className="h-2.5 rounded-full bg-slate-100">
            <div className="h-2.5 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: ACCENT }} />
          </div>
          {r.detail && <div className="text-xs text-slate-500 mt-0.5">{r.detail}</div>}
        </div>
      ))}
    </div>
  );
}
