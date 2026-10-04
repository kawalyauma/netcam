import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { PageHeader, StatTile, Card, Badge, Button, Table } from "../components/ui";
import type { LiveDevice, LiveRouter, NetworkLive } from "../lib/types";

const REFRESH_MS = 20_000;

type Filter = "ALL" | LiveDevice["access"];

function statusTone(status: LiveRouter["status"]) {
  return status === "ONLINE" ? "green" : status === "OFFLINE" ? "red" : "gray";
}

function RouterChain({ node, depth }: { node: LiveRouter; depth: number }) {
  return (
    <div>
      <div className="flex items-center gap-2 py-2 border-b border-slate-100" style={{ paddingLeft: depth * 22 }}>
        {depth > 0 && <span className="text-slate-300 text-xs" aria-hidden>└─</span>}
        <span className="text-sm font-medium">{node.name}</span>
        <Badge tone={statusTone(node.status)}>{node.status}</Badge>
        {node.isSegmentRoot && <span className="text-xs text-slate-400">wired to box</span>}
        {node.onlineReason && node.onlineReason !== "ping" && (
          <span className="text-xs text-slate-400">
            {node.onlineReason === "clients" ? "· users are connecting through it" : "· a router further down the chain is up"}
          </span>
        )}
        <span className="ml-auto text-xs text-slate-500 font-mono">
          {node.ipAddress ?? "no IP set"}
          {node.pingMs !== null && ` · ${node.pingMs.toFixed(0)} ms`}
        </span>
      </div>
      {node.children.map((child) => (
        <RouterChain key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function countUnprobed(nodes: LiveRouter[]): number {
  return nodes.reduce((n, r) => n + (r.status === "UNKNOWN" ? 1 : 0) + countUnprobed(r.children), 0);
}

export default function Network() {
  const [data, setData] = useState<NetworkLive | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("ALL");

  async function load() {
    setLoading(true);
    try {
      setData(await api.get<NetworkLive>("/network/live"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError && err.status >= 500
        ? "Couldn't reach the network agent on the box. Check that netcam-network-agent is running."
        : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const devices = data?.devices.filter((d) => filter === "ALL" || d.access === filter) ?? [];
  const unprobed = data ? countUnprobed(data.routers) : 0;

  return (
    <div>
      <PageHeader
        title="Network"
        subtitle={data ? `Live · updated ${new Date(data.generatedAt).toLocaleTimeString()}` : "Live routers and connected devices"}
        action={<Button variant="secondary" onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</Button>}
      />

      {error && (
        <Card className="p-4 mb-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </Card>
      )}

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatTile label="Routers online" value={`${data.summary.routersOnline}/${data.summary.routersTotal}`} />
          <StatTile label="On the WiFi now" value={data.summary.devicesOnline} />
          <StatTile label="Paid & online" value={`${data.summary.devicesPaid} of ${data.summary.paidTotal} paid`} />
          <StatTile label="Held at sign-in page" value={data.summary.devicesBlocked} />
        </div>
      )}

      <Card className="p-4 mb-4">
        <h2 className="text-sm font-semibold mb-1">Router chain</h2>
        <p className="text-xs text-slate-500 mb-3">
          A router is online if it answers a ping, if users are connecting through it, or if a router further down its chain is up. Set a management IP on the Routers page to check a router directly.
        </p>
        {data?.routers.map((root) => <RouterChain key={root.id} node={root} depth={0} />)}
        {data && data.routers.length === 0 && <p className="text-sm text-slate-400">No routers configured yet.</p>}
        {unprobed > 0 && (
          <p className="text-xs text-amber-700 mt-3">
            {unprobed} router{unprobed > 1 ? "s have" : " has"} no IP or MAC set, so {unprobed > 1 ? "their" : "its"} status can't be checked.
          </p>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <h2 className="text-sm font-semibold">Connected devices</h2>
          <div className="flex gap-1" role="tablist" aria-label="Filter devices">
            {([
              ["ALL", `All (${data?.devices.length ?? 0})`],
              ["PAID", `Paid (${data?.summary.paidTotal ?? 0})`],
              ["BLOCKED", `Held at portal (${data?.summary.devicesBlocked ?? 0})`],
            ] as Array<[Filter, string]>).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${filter === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Device</th>
              <th className="px-4 py-2">IP</th>
              <th className="px-4 py-2">MAC</th>
              <th className="px-4 py-2">Access</th>
              <th className="px-4 py-2">Voucher / package</th>
              <th className="px-4 py-2">Expires</th>
              <th className="px-4 py-2">Phone</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.macAddress} className={`border-t border-slate-100 ${d.online ? "" : "text-slate-400"}`}>
                <td className="px-4 py-2.5">{d.hostname ?? <span className="text-slate-400">Unknown device</span>}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{d.ipAddress ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{d.macAddress}</td>
                <td className="px-4 py-2.5">
                  {d.access === "BLOCKED" ? (
                    <Badge tone="amber">Held at portal</Badge>
                  ) : d.online ? (
                    <Badge tone="green">Paid · online</Badge>
                  ) : (
                    <Badge tone="gray">Paid · not connected</Badge>
                  )}
                  {d.isBlockedByAdmin && <span className="ml-1"><Badge tone="red">Blocked by admin</Badge></span>}
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {d.voucher ? (
                    <>
                      <span className="font-mono">{d.voucher.code}</span>
                      <span className="text-slate-500"> · {d.voucher.packageName}</span>
                    </>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {d.voucher?.expiresAt ? new Date(d.voucher.expiresAt).toLocaleString() : "—"}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">{d.voucher?.customerPhone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {data && devices.length === 0 && (
          <p className="text-sm text-slate-400 p-4">
            {filter === "BLOCKED" ? "No one is waiting at the sign-in page." : filter === "PAID" ? "No paid devices online." : "No devices online right now."}
          </p>
        )}
      </Card>
    </div>
  );
}
