import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, StatTile, Card, Badge } from "../components/ui";
import type { DashboardOverview, RouterUserCount } from "../lib/types";

export default function Dashboard() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [routerUsers, setRouterUsers] = useState<RouterUserCount[]>([]);

  async function load() {
    const [o, u] = await Promise.all([
      api.get<DashboardOverview>("/dashboard/overview"),
      api.get<RouterUserCount[]>("/dashboard/users-per-router"),
    ]);
    setOverview(o);
    setRouterUsers(u);
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div>
      <PageHeader title="Overview" subtitle="Live status across your hotspot" />

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatTile label="Routers online" value={`${overview.routers.online}/${overview.routers.total}`} />
          <StatTile label="Active sessions" value={overview.activeSessions} />
          <StatTile label="Active vouchers" value={overview.activeVouchers} />
          <StatTile label="Today's revenue" value={`UGX ${overview.todayRevenueUgx.toLocaleString()}`} />
          <StatTile label="SMS sent today" value={overview.todaySmsSent} />
          <StatTile label="Suspected re-sharing" value={overview.suspectedResharing} />
        </div>
      )}

      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">Users per router</h2>
        <div className="space-y-2">
          {routerUsers.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-slate-100 last:border-0 py-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{r.name}</span>
                <Badge tone={r.status === "ONLINE" ? "green" : r.status === "OFFLINE" ? "red" : "gray"}>
                  {r.status}
                </Badge>
                {r.vlanId && <span className="text-xs text-slate-400">VLAN {r.vlanId}</span>}
              </div>
              <span className="text-sm text-slate-600">{r.activeUsers} active</span>
            </div>
          ))}
          {routerUsers.length === 0 && <p className="text-sm text-slate-400">No routers configured yet.</p>}
        </div>
      </Card>
    </div>
  );
}
