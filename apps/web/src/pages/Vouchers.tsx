import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, Button, Table } from "../components/ui";
import type { Package, Voucher } from "../lib/types";

export default function Vouchers() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ packageId: "", count: "10", batchLabel: "" });
  const [statusFilter, setStatusFilter] = useState("");

  async function load() {
    const query = statusFilter ? `?status=${statusFilter}` : "";
    const [v, p] = await Promise.all([
      api.get<Voucher[]>(`/vouchers${query}`),
      api.get<Package[]>("/packages?activeOnly=true"),
    ]);
    setVouchers(v);
    setPackages(p);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function generate() {
    if (!form.packageId || !form.count) return;
    await api.post("/vouchers/generate", {
      packageId: form.packageId,
      count: Number(form.count),
      batchLabel: form.batchLabel || undefined,
    });
    setForm({ packageId: "", count: "10", batchLabel: "" });
    setShowForm(false);
    load();
  }

  async function suspend(id: string) {
    const reason = window.prompt("Reason for suspending this voucher?") ?? "manual suspension";
    await api.patch(`/vouchers/${id}/suspend`, { reason });
    load();
  }

  const toneFor: Record<Voucher["status"], "green" | "gray" | "red" | "amber"> = {
    ACTIVE: "green",
    UNUSED: "gray",
    EXPIRED: "amber",
    DEPLETED: "amber",
    SUSPENDED: "red",
  };

  return (
    <div>
      <PageHeader
        title="Vouchers"
        subtitle="Generate printable batches or track individually purchased codes"
        action={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "Generate batch"}</Button>}
      />

      {showForm && (
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <select className="border border-slate-300 rounded-md px-3 py-2 text-sm" value={form.packageId} onChange={(e) => setForm({ ...form, packageId: e.target.value })}>
              <option value="">Select package</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Count" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Batch label (optional)" value={form.batchLabel} onChange={(e) => setForm({ ...form, batchLabel: e.target.value })} />
          </div>
          <Button onClick={generate}>Generate</Button>
        </Card>
      )}

      <div className="mb-3 flex gap-2">
        {["", "UNUSED", "ACTIVE", "EXPIRED", "SUSPENDED"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${statusFilter === s ? "bg-accent text-white" : "bg-white border border-slate-300 text-slate-600"}`}
          >
            {s || "All"}
          </button>
        ))}
      </div>

      <Card>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Package</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Devices</th>
              <th className="px-4 py-2">Expires</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {vouchers.map((v) => (
              <tr key={v.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-mono text-xs">{v.code}</td>
                <td className="px-4 py-2.5">{v.package.name}</td>
                <td className="px-4 py-2.5"><Badge tone={toneFor[v.status]}>{v.status}</Badge></td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{v.devices?.length ?? 0}/{v.package.deviceLimit}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{v.expiresAt ? new Date(v.expiresAt).toLocaleString() : "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  {v.status === "ACTIVE" && <Button variant="danger" onClick={() => suspend(v.id)}>Suspend</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {vouchers.length === 0 && <p className="text-sm text-slate-400 p-4">No vouchers found.</p>}
      </Card>
    </div>
  );
}
