import { Fragment, useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, Card, PageHeader, StatTile, Table } from "../components/ui";
import {
  ByteBars,
  LiveRateChart,
  SeriesLegend,
  Sparkline,
  UsageColumns,
  formatBytes,
  formatRate,
  type RatePoint,
  type UsageBucket,
} from "../components/usage-charts";

const LIVE_POLL_MS = 5_000;
const SUMMARY_POLL_MS = 60_000;

interface LiveApp {
  app: string;
  down: number;
  up: number;
  downBps: number;
  upBps: number;
}

interface LiveDevice {
  macAddress: string;
  ipAddress: string | null;
  hostname: string | null;
  label: string;
  deviceType: string;
  phoneNumber: string | null;
  downBps: number;
  upBps: number;
  totalDown: number;
  totalUp: number;
  history: RatePoint[];
  apps: LiveApp[];
  session: {
    packageName: string;
    speedLimitDownKbps: number;
    expiresAt: string | null;
    dataUsedMb: number;
    dataCapMb: number | null;
  } | null;
}

interface LiveUsage {
  generatedAt: string;
  network: RatePoint[];
  devices: LiveDevice[];
}

interface UsageSummary {
  bucket: "hour" | "day";
  totals: { down: number; up: number; devices: number };
  series: UsageBucket[];
  byApp: Array<{ app: string; down: number; up: number }>;
  byDeviceType: Array<{ deviceType: string; down: number; up: number; devices: number }>;
  topDevices: Array<{ macAddress: string; label: string; deviceType: string; phoneNumber: string | null; hostname: string | null; down: number; up: number }>;
}

const RANGES = [
  { id: "24h", label: "Last 24 hours" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
] as const;

function timeLeft(iso: string | null) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.round(ms / 60_000);
  return mins >= 120 ? `${Math.round(mins / 60)}h left` : `${mins} min left`;
}

function DeviceDetail({ device }: { device: LiveDevice }) {
  return (
    <div className="grid md:grid-cols-5 gap-5 py-3">
      <div className="md:col-span-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-medium text-slate-500">Speed, last 10 minutes</div>
          <SeriesLegend kind="line" />
        </div>
        <LiveRateChart points={device.history} height={180} />
      </div>
      <div className="md:col-span-2">
        <div className="text-xs font-medium text-slate-500 mb-2">Apps this session</div>
        <ByteBars
          rows={device.apps.slice(0, 8).map((a) => ({
            label: a.app,
            value: a.down + a.up,
            detail: a.downBps + a.upBps > 0 ? `now ${formatRate(a.downBps + a.upBps)}` : undefined,
          }))}
          empty="No traffic yet"
        />
        <div className="mt-3 text-xs text-slate-500 space-y-0.5">
          <div>MAC {device.macAddress} · IP {device.ipAddress ?? "—"}</div>
          {device.hostname && <div>Device name: {device.hostname}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Usage() {
  const [live, setLive] = useState<LiveUsage | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("24h");
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const loadLive = useCallback(async () => {
    try {
      setLive(await api.get<LiveUsage>("/usage/live"));
      setLiveError(null);
    } catch (err) {
      setLiveError((err as Error).message);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      setSummary(await api.get<UsageSummary>(`/usage/summary?range=${range}`));
    } finally {
      setSummaryLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void loadLive();
    const id = window.setInterval(() => {
      if (!document.hidden) void loadLive();
    }, LIVE_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadLive]);

  useEffect(() => {
    void loadSummary();
    const id = window.setInterval(() => {
      if (!document.hidden) void loadSummary();
    }, SUMMARY_POLL_MS);
    return () => window.clearInterval(id);
  }, [loadSummary]);

  const now = live?.network[live.network.length - 1];
  const activeNow = live?.devices.filter((d) => d.downBps + d.upBps > 1024).length ?? 0;

  return (
    <div>
      <PageHeader title="Usage" subtitle="Who is using data right now, how fast, and on what — updates every 5 seconds" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile label="Logged-in devices" value={live ? live.devices.length : "—"} />
        <StatTile label="Actively browsing" value={live ? activeNow : "—"} />
        <StatTile label="Download speed now" value={now ? formatRate(now.down) : "—"} />
        <StatTile label="Upload speed now" value={now ? formatRate(now.up) : "—"} />
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-800">Whole network, live</h2>
          <SeriesLegend kind="line" />
        </div>
        {liveError ? (
          <p className="text-sm text-red-600">Live data unavailable: {liveError}</p>
        ) : (
          <LiveRateChart points={live?.network ?? []} />
        )}
      </Card>

      <Card className="mb-6">
        <div className="px-4 pt-4 pb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-800">People online</h2>
          <span className="text-xs text-slate-500">Click a row for their live graph and apps</span>
        </div>
        <Table>
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2 font-medium">Customer / device</th>
              <th className="px-4 py-2 font-medium">Package</th>
              <th className="px-4 py-2 font-medium">Download now</th>
              <th className="px-4 py-2 font-medium">Upload now</th>
              <th className="px-4 py-2 font-medium">Last 10 min</th>
              <th className="px-4 py-2 font-medium">Used this session</th>
              <th className="px-4 py-2 font-medium">Top app</th>
            </tr>
          </thead>
          <tbody>
            {live?.devices.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Nobody is logged in right now.
                </td>
              </tr>
            )}
            {live?.devices.map((d) => {
              const open = expanded === d.macAddress;
              const left = timeLeft(d.session?.expiresAt ?? null);
              return (
                <Fragment key={d.macAddress}>
                  <tr
                    className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${open ? "bg-slate-50" : ""}`}
                    onClick={() => setExpanded(open ? null : d.macAddress)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-900">{d.label}</div>
                      <div className="text-xs text-slate-500">
                        {d.deviceType}
                        {d.hostname && d.hostname !== d.label ? ` · ${d.hostname}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {d.session ? (
                        <>
                          <div className="text-slate-800">{d.session.packageName}</div>
                          <div className="text-xs text-slate-500">
                            {left}
                            {d.session.dataCapMb ? ` · ${Math.max(0, Math.round(d.session.dataCapMb - d.session.dataUsedMb))} MB left` : ""}
                          </div>
                        </>
                      ) : (
                        <Badge tone="gray">No session</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-900">{formatRate(d.downBps)}</td>
                    <td className="px-4 py-2.5 text-slate-700">{formatRate(d.upBps)}</td>
                    <td className="px-4 py-2.5">
                      <Sparkline points={d.history} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-700">{formatBytes(d.totalDown + d.totalUp)}</td>
                    <td className="px-4 py-2.5 text-slate-700">{d.apps[0]?.app ?? "—"}</td>
                  </tr>
                  {open && (
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <td colSpan={7} className="px-4">
                        <DeviceDetail device={d} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-base font-semibold text-slate-900 mr-2">History</h2>
        {RANGES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRange(r.id)}
            className={`px-3 py-1.5 rounded-md text-sm border ${
              range === r.id ? "bg-accent text-white border-transparent" : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className={summaryLoading && summary ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <StatTile label="Total data used" value={summary ? formatBytes(summary.totals.down + summary.totals.up) : "—"} />
          <StatTile label="Downloaded / uploaded" value={summary ? `${formatBytes(summary.totals.down)} / ${formatBytes(summary.totals.up)}` : "—"} />
          <StatTile label="Devices that used data" value={summary ? summary.totals.devices : "—"} />
        </div>

        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-800">Data used per {summary?.bucket ?? "hour"}</h3>
            <SeriesLegend kind="rect" />
          </div>
          {summary && <UsageColumns data={summary.series} bucket={summary.bucket} />}
        </Card>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">By app</h3>
            <ByteBars rows={(summary?.byApp ?? []).slice(0, 12).map((a) => ({ label: a.app, value: a.down + a.up }))} />
            <p className="text-xs text-slate-400 mt-3">
              Apps are recognised from the sites a device looks up. "Other" is traffic that couldn't be matched.
            </p>
          </Card>
          <Card className="p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">By device type</h3>
            <ByteBars
              rows={(summary?.byDeviceType ?? []).map((t) => ({
                label: t.deviceType,
                value: t.down + t.up,
                detail: `${t.devices} device${t.devices === 1 ? "" : "s"}`,
              }))}
            />
          </Card>
        </div>

        <Card className="mb-4">
          <h3 className="text-sm font-semibold text-slate-800 px-4 pt-4 pb-2">Top users</h3>
          <Table>
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2 font-medium">Customer / device</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Downloaded</th>
                <th className="px-4 py-2 font-medium">Uploaded</th>
                <th className="px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {summary?.topDevices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                    No usage recorded in this period yet.
                  </td>
                </tr>
              )}
              {summary?.topDevices.map((d) => (
                <tr key={d.macAddress} className="border-b border-slate-100">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{d.label}</div>
                    <div className="text-xs text-slate-500">{d.hostname ?? d.macAddress}</div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{d.deviceType}</td>
                  <td className="px-4 py-2.5 text-slate-700">{formatBytes(d.down)}</td>
                  <td className="px-4 py-2.5 text-slate-700">{formatBytes(d.up)}</td>
                  <td className="px-4 py-2.5 font-medium text-slate-900">{formatBytes(d.down + d.up)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
