import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, Table, StatTile } from "../components/ui";
import { DailyRevenueChart, RankedBars } from "../components/charts";
import type { EarningsSummary, Payment } from "../lib/types";

const RANGES = [7, 30, 90] as const;
const ugx = (n: number) => `UGX ${n.toLocaleString()}`;

const SOURCE_LABEL = { SSENTEZO: "Mobile money", MANUAL: "Manual payments", VOUCHER: "Printed vouchers (cash)" } as const;

const toneFor: Record<Payment["status"], "green" | "gray" | "red" | "amber"> = {
  SUCCESS: "green",
  PENDING: "amber",
  FAILED: "red",
  CANCELLED: "gray",
};

export default function Payments() {
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [showTable, setShowTable] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"ALL" | Payment["status"]>("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<EarningsSummary>(`/payments/earnings?days=${range}`).then(setEarnings);
  }, [range]);

  useEffect(() => {
    api.get<Payment[]>("/payments").then(setPayments);
  }, []);

  const visiblePayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payments.filter(
      (p) =>
        (statusFilter === "ALL" || p.status === statusFilter) &&
        (!q || p.customer.phoneNumber.includes(q) || p.package.name.toLowerCase().includes(q) || (p.voucher?.code ?? "").toLowerCase().includes(q)),
    );
  }, [payments, statusFilter, search]);

  const t = earnings?.totals;
  const c = earnings?.counts;

  return (
    <div>
      <PageHeader
        title="Payments"
        subtitle="Your earnings from mobile money and printed vouchers"
        action={
          <div className="flex gap-1" role="tablist" aria-label="Date range">
            {RANGES.map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={range === r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium ${range === r ? "bg-slate-900 text-white" : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
              >
                {r} days
              </button>
            ))}
          </div>
        }
      />

      {t && c && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <StatTile label="Today" value={ugx(t.todayUgx)} />
          <StatTile label="Last 7 days" value={ugx(t.last7DaysUgx)} />
          <StatTile label={`Last ${earnings.rangeDays} days`} value={ugx(t.rangeUgx)} />
          <StatTile label="All time" value={ugx(t.allTimeUgx)} />
          <StatTile label="Average per day" value={ugx(t.averagePerDayUgx)} />
          <StatTile
            label="Payment success rate"
            value={c.successRate === null ? "—" : `${Math.round(c.successRate * 100)}%`}
          />
        </div>
      )}

      {earnings && (
        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <Card className="p-4 md:col-span-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">Daily revenue</h2>
              <button onClick={() => setShowTable((s) => !s)} className="text-xs text-slate-500 hover:text-slate-800 underline">
                {showTable ? "Show chart" : "Show as table"}
              </button>
            </div>
            {showTable ? (
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <thead className="bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5">Date</th>
                      <th className="px-3 py-1.5 text-right">Mobile money</th>
                      <th className="px-3 py-1.5 text-right">Vouchers</th>
                      <th className="px-3 py-1.5 text-right">Total</th>
                      <th className="px-3 py-1.5 text-right">Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...earnings.daily].reverse().map((d) => (
                      <tr key={d.date} className="border-t border-slate-100">
                        <td className="px-3 py-1.5">{d.date}</td>
                        <td className="px-3 py-1.5 text-right">{ugx(d.mobileMoneyUgx)}</td>
                        <td className="px-3 py-1.5 text-right">{ugx(d.voucherUgx)}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{ugx(d.revenueUgx)}</td>
                        <td className="px-3 py-1.5 text-right">{d.payments}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <DailyRevenueChart data={earnings.daily} />
            )}
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3">Earnings by channel</h2>
            {earnings.bySource.length ? (
              <div className="mb-5">
                <RankedBars
                  rows={earnings.bySource.map((s) => ({
                    label: SOURCE_LABEL[s.source] ?? s.source,
                    value: s.revenueUgx,
                    detail: `${s.sales} sale${s.sales === 1 ? "" : "s"}`,
                  }))}
                />
              </div>
            ) : null}
            <h2 className="text-sm font-semibold mb-3">Earnings by package</h2>
            {earnings.byPackage.length ? (
              <RankedBars
                rows={earnings.byPackage.map((p) => ({
                  label: p.name,
                  value: p.revenueUgx,
                  detail: `${p.payments} sale${p.payments === 1 ? "" : "s"}`,
                }))}
              />
            ) : (
              <p className="text-sm text-slate-400">No sales in this period.</p>
            )}
            {c && (
              <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-semibold">{c.success}</div>
                  <div className="text-xs text-slate-500">Mobile money paid</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{c.pending}</div>
                  <div className="text-xs text-slate-500">Pending</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{c.failed + c.cancelled}</div>
                  <div className="text-xs text-slate-500">Failed</div>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-3">
          <h2 className="text-sm font-semibold mr-auto">Mobile-money transactions</h2>
          <input
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm"
            placeholder="Search phone, package, voucher"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="ALL">All statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="PENDING">Pending</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Package</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Voucher</th>
              <th className="px-4 py-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {visiblePayments.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-mono text-xs">{p.customer.phoneNumber}</td>
                <td className="px-4 py-2.5">{p.package.name}</td>
                <td className="px-4 py-2.5">{ugx(p.amountUgx)}</td>
                <td className="px-4 py-2.5"><Badge tone={toneFor[p.status]}>{p.status}</Badge></td>
                <td className="px-4 py-2.5 font-mono text-xs">{p.voucher?.code ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{new Date(p.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {visiblePayments.length === 0 && (
          <p className="text-sm text-slate-400 p-4">{payments.length ? "No payments match these filters." : "No payments yet."}</p>
        )}
      </Card>
    </div>
  );
}
