import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, Button, Table } from "../components/ui";
import type { Package } from "../lib/types";

const emptyForm = {
  name: "",
  description: "",
  priceUgx: "",
  limitType: "DURATION" as Package["limitType"],
  durationMinutes: "",
  dataCapMb: "",
  downKbps: "2048",
  upKbps: "1024",
  deviceLimit: "1",
};

export default function Packages() {
  const [packages, setPackages] = useState<Package[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);

  async function load() {
    setPackages(await api.get<Package[]>("/packages"));
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!form.name || !form.priceUgx) return;
    await api.post("/packages", {
      name: form.name,
      description: form.description || undefined,
      priceUgx: Number(form.priceUgx),
      limitType: form.limitType,
      durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : undefined,
      dataCapMb: form.dataCapMb ? Number(form.dataCapMb) : undefined,
      downKbps: Number(form.downKbps),
      upKbps: Number(form.upKbps),
      deviceLimit: Number(form.deviceLimit),
    });
    setForm(emptyForm);
    setShowForm(false);
    load();
  }

  async function remove(id: string) {
    await api.delete(`/packages/${id}`);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Packages"
        subtitle="Plans sold on the captive portal — price, duration/data, speed caps, device limit"
        action={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "Add package"}</Button>}
      />

      {showForm && (
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-4 gap-3 mb-3">
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Price (UGX)" value={form.priceUgx} onChange={(e) => setForm({ ...form, priceUgx: e.target.value })} />
            <select className="border border-slate-300 rounded-md px-3 py-2 text-sm" value={form.limitType} onChange={(e) => setForm({ ...form, limitType: e.target.value as Package["limitType"] })}>
              <option value="DURATION">Duration</option>
              <option value="DATA_CAP">Data cap</option>
              <option value="DURATION_AND_DATA_CAP">Duration + data cap</option>
            </select>
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Device limit" value={form.deviceLimit} onChange={(e) => setForm({ ...form, deviceLimit: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Duration (minutes)" value={form.durationMinutes} onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Data cap (MB)" value={form.dataCapMb} onChange={(e) => setForm({ ...form, dataCapMb: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Download Kbps" value={form.downKbps} onChange={(e) => setForm({ ...form, downKbps: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Upload Kbps" value={form.upKbps} onChange={(e) => setForm({ ...form, upKbps: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm col-span-4" placeholder="Description (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <Button onClick={create}>Save</Button>
        </Card>
      )}

      <Card>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Limit</th>
              <th className="px-4 py-2">Speed</th>
              <th className="px-4 py-2">Device limit</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-medium">{p.name}</td>
                <td className="px-4 py-2.5">UGX {p.priceUgx.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">
                  {p.durationMinutes ? `${p.durationMinutes}min ` : ""}
                  {p.dataCapMb ? `${p.dataCapMb}MB` : ""}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{p.downKbps}/{p.upKbps} Kbps</td>
                <td className="px-4 py-2.5">{p.deviceLimit}</td>
                <td className="px-4 py-2.5">{p.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                <td className="px-4 py-2.5 text-right">
                  {p.isActive && <Button variant="danger" onClick={() => remove(p.id)}>Deactivate</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {packages.length === 0 && <p className="text-sm text-slate-400 p-4">No packages yet.</p>}
      </Card>
    </div>
  );
}
