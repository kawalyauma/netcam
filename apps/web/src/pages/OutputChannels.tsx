import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, Button, Table } from "../components/ui";
import type { OutputChannel } from "../lib/types";

export default function OutputChannels() {
  const [channels, setChannels] = useState<OutputChannel[]>([]);
  const [form, setForm] = useState({ name: "", interfaceName: "", type: "ETHERNET" as OutputChannel["type"] });
  const [showForm, setShowForm] = useState(false);

  async function load() {
    setChannels(await api.get<OutputChannel[]>("/output-channels"));
  }

  useEffect(() => {
    load();
  }, []);

  async function activate(id: string) {
    await api.patch(`/output-channels/${id}/activate`);
    load();
  }

  async function create() {
    if (!form.name || !form.interfaceName) return;
    await api.post("/output-channels", form);
    setForm({ name: "", interfaceName: "", type: "ETHERNET" });
    setShowForm(false);
    load();
  }

  return (
    <div>
      <PageHeader
        title="Output Channels"
        subtitle="Pick which physical LAN port/adapter is actively distributing internet"
        action={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "Add channel"}</Button>}
      />

      {showForm && (
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="Name (e.g. Primary LAN)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              placeholder="Interface (e.g. eth0)"
              value={form.interfaceName}
              onChange={(e) => setForm({ ...form, interfaceName: e.target.value })}
            />
            <select
              className="border border-slate-300 rounded-md px-3 py-2 text-sm"
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as OutputChannel["type"] })}
            >
              <option value="ETHERNET">Ethernet</option>
              <option value="USB_ETHERNET">USB Ethernet</option>
              <option value="WIFI_AP">WiFi AP</option>
            </select>
          </div>
          <Button onClick={create}>Save</Button>
        </Card>
      )}

      <Card>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Interface</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{c.interfaceName}</td>
                <td className="px-4 py-2.5">{c.type}</td>
                <td className="px-4 py-2.5">
                  {c.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Standby</Badge>}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {!c.isActive && (
                    <Button variant="secondary" onClick={() => activate(c.id)}>
                      Make active
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {channels.length === 0 && <p className="text-sm text-slate-400 p-4">No output channels yet.</p>}
      </Card>
    </div>
  );
}
