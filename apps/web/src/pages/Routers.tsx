import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, Button } from "../components/ui";
import type { OutputChannel, RouterNode } from "../lib/types";

function RouterTree({ node, depth, onSelect }: { node: RouterNode; depth: number; onSelect: (id: string) => void }) {
  return (
    <div style={{ marginLeft: depth * 20 }}>
      <button
        onClick={() => onSelect(node.id)}
        className="flex items-center gap-2 py-1.5 text-left w-full hover:bg-slate-50 rounded px-2"
      >
        <span className="text-sm font-medium">{node.name}</span>
        <Badge tone={node.status === "ONLINE" ? "green" : node.status === "OFFLINE" ? "red" : "gray"}>
          {node.status}
        </Badge>
        {node.vlanId && <span className="text-xs text-slate-400">VLAN {node.vlanId}</span>}
      </button>
      {node.children?.map((child) => <RouterTree key={child.id} node={child} depth={depth + 1} onSelect={onSelect} />)}
    </div>
  );
}

const emptyForm = {
  name: "",
  macAddress: "",
  model: "",
  location: "",
  vlanId: "",
  subnetCidr: "",
  apSsid: "",
  apPassword: "",
  outputChannelId: "",
  parentRouterId: "",
};

export default function Routers() {
  const [topology, setTopology] = useState<RouterNode[]>([]);
  const [flatRouters, setFlatRouters] = useState<RouterNode[]>([]);
  const [channels, setChannels] = useState<OutputChannel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeUsers, setActiveUsers] = useState<Array<{ id: string; device: { macAddress: string }; voucher: { code: string } }>>([]);

  async function load() {
    const [t, f, c] = await Promise.all([
      api.get<RouterNode[]>("/routers/topology"),
      api.get<RouterNode[]>("/routers"),
      api.get<OutputChannel[]>("/output-channels"),
    ]);
    setTopology(t);
    setFlatRouters(f);
    setChannels(c);
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    api.get<typeof activeUsers>(`/routers/${selectedId}/active-users`).then(setActiveUsers);
  }, [selectedId]);

  async function create() {
    if (!form.name) return;
    await api.post("/routers", {
      name: form.name,
      macAddress: form.macAddress || undefined,
      model: form.model || undefined,
      location: form.location || undefined,
      vlanId: form.vlanId ? Number(form.vlanId) : undefined,
      subnetCidr: form.subnetCidr || undefined,
      apSsid: form.apSsid || undefined,
      apPassword: form.apPassword || undefined,
      outputChannelId: form.outputChannelId || undefined,
      parentRouterId: form.parentRouterId || undefined,
    });
    setForm(emptyForm);
    setShowForm(false);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Routers"
        subtitle="Chained topology — each router's users are attributed by its VLAN segment"
        action={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "Add router"}</Button>}
      />

      {showForm && (
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="MAC address" value={form.macAddress} onChange={(e) => setForm({ ...form, macAddress: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Location" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="VLAN ID" value={form.vlanId} onChange={(e) => setForm({ ...form, vlanId: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Subnet CIDR (e.g. 10.50.10.0/24)" value={form.subnetCidr} onChange={(e) => setForm({ ...form, subnetCidr: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="AP SSID" value={form.apSsid} onChange={(e) => setForm({ ...form, apSsid: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="AP password" type="password" value={form.apPassword} onChange={(e) => setForm({ ...form, apPassword: e.target.value })} />
            <select className="border border-slate-300 rounded-md px-3 py-2 text-sm" value={form.outputChannelId} onChange={(e) => setForm({ ...form, outputChannelId: e.target.value })}>
              <option value="">Output channel (root only)</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select className="border border-slate-300 rounded-md px-3 py-2 text-sm" value={form.parentRouterId} onChange={(e) => setForm({ ...form, parentRouterId: e.target.value })}>
              <option value="">No parent (root of chain)</option>
              {flatRouters.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <Button onClick={create}>Save</Button>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Chain topology</h2>
          {topology.map((root) => (
            <RouterTree key={root.id} node={root} depth={0} onSelect={setSelectedId} />
          ))}
          {topology.length === 0 && <p className="text-sm text-slate-400">No routers configured yet.</p>}
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Active users {selectedId ? "" : "(select a router)"}</h2>
          <div className="space-y-1.5">
            {activeUsers.map((s) => (
              <div key={s.id} className="flex justify-between text-sm border-b border-slate-100 py-1.5">
                <span className="font-mono text-xs">{s.device.macAddress}</span>
                <span className="text-slate-500">{s.voucher.code}</span>
              </div>
            ))}
            {selectedId && activeUsers.length === 0 && <p className="text-sm text-slate-400">No active users on this router.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}
