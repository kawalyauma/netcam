import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Badge, Button, Card, PageHeader, Table } from "../components/ui";

type Severity = "INFO" | "WARNING" | "CRITICAL";

interface Recipient {
  id: string;
  name: string;
  phoneNumber: string;
  categories: string[];
  minSeverity: Severity;
  whatsapp: boolean;
  sms: boolean;
  enabled: boolean;
}

interface AlertEvent {
  id: string;
  category: string;
  severity: Severity;
  title: string;
  message: string;
  createdAt: string;
  deliveries: Array<{ name: string; ok: boolean; channel: string; error?: string }> | null;
}

interface Meta {
  categories: Array<{ key: string; label: string }>;
  whatsappConfigured: boolean;
}

const SEVERITY_LABEL: Record<Severity, string> = {
  INFO: "Everything",
  WARNING: "Warnings and urgent",
  CRITICAL: "Urgent only",
};

const SEVERITY_TONE: Record<Severity, "gray" | "amber" | "red"> = { INFO: "gray", WARNING: "amber", CRITICAL: "red" };

const EMPTY_FORM = { name: "", phoneNumber: "", categories: [] as string[], minSeverity: "INFO" as Severity, whatsapp: true, sms: false };

export default function Alerts() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [m, r, e] = await Promise.all([
      api.get<Meta>("/alerts/meta"),
      api.get<Recipient[]>("/alerts/recipients"),
      api.get<AlertEvent[]>("/alerts/events?limit=100"),
    ]);
    setMeta(m);
    setRecipients(r);
    setEvents(e);
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => !document.hidden && void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const categoryLabel = (key: string) => meta?.categories.find((c) => c.key === key)?.label ?? key;

  function startEdit(r: Recipient) {
    setEditingId(r.id);
    setForm({ name: r.name, phoneNumber: r.phoneNumber, categories: r.categories, minSeverity: r.minSeverity, whatsapp: r.whatsapp, sms: r.sms });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (editingId) await api.patch(`/alerts/recipients/${editingId}`, form);
      else await api.post("/alerts/recipients", form);
      setForm(EMPTY_FORM);
      setEditingId(null);
      setMessage({ kind: "ok", text: "Saved." });
      await load();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: Recipient) {
    await api.patch(`/alerts/recipients/${r.id}`, { enabled: !r.enabled });
    await load();
  }

  async function remove(r: Recipient) {
    if (!window.confirm(`Stop alerting ${r.name} (${r.phoneNumber})?`)) return;
    await api.delete(`/alerts/recipients/${r.id}`);
    await load();
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.post<{ deliveries: Array<{ name: string; ok: boolean; channel: string; error?: string }> }>("/alerts/test");
      const failed = res.deliveries.filter((d) => !d.ok);
      setMessage(
        res.deliveries.length === 0
          ? { kind: "error", text: "No enabled recipients to test." }
          : failed.length
            ? { kind: "error", text: `Not delivered to: ${failed.map((f) => `${f.name} (${f.error})`).join(", ")}` }
            : { kind: "ok", text: `Test sent to ${res.deliveries.map((d) => `${d.name} via ${d.channel}`).join(", ")}.` },
      );
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function toggleCategory(key: string) {
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(key) ? f.categories.filter((c) => c !== key) : [...f.categories, key],
    }));
  }

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle="Who gets told when something happens, and what they're told about"
        action={
          <Button onClick={sendTest} disabled={busy || recipients.length === 0}>
            Send test alert
          </Button>
        }
      />

      {meta && !meta.whatsappConfigured && (
        <Card className="p-4 mb-4 border-amber-300 bg-amber-50">
          <p className="text-sm text-amber-800">
            WhatsApp isn't connected yet, so alerts only go out by SMS (for recipients with SMS turned on). Add the
            WhatsApp hub API key to the server configuration to switch it on.
          </p>
        </Card>
      )}
      {message && (
        <p className={`text-sm mb-4 ${message.kind === "ok" ? "text-green-700" : "text-red-600"}`}>{message.text}</p>
      )}

      <div className="grid md:grid-cols-5 gap-4 mb-6">
        <Card className="md:col-span-3">
          <h2 className="text-sm font-semibold text-slate-800 px-4 pt-4 pb-2">Recipients</h2>
          <Table>
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2 font-medium">Who</th>
                <th className="px-4 py-2 font-medium">Gets</th>
                <th className="px-4 py-2 font-medium">Via</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {recipients.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    Nobody is assigned yet. Add someone on the right.
                  </td>
                </tr>
              )}
              {recipients.map((r) => (
                <tr key={r.id} className={`border-b border-slate-100 ${r.enabled ? "" : "opacity-50"}`}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{r.name}</div>
                    <div className="text-xs text-slate-500">+{r.phoneNumber}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    <div>{SEVERITY_LABEL[r.minSeverity]}</div>
                    <div>{r.categories.length === 0 ? "All categories" : r.categories.map(categoryLabel).join(", ")}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-600">
                    {[r.whatsapp && "WhatsApp", r.sms && "SMS"].filter(Boolean).join(" + ") || "Nothing"}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-2">
                    <button className="text-xs text-slate-600 hover:underline" onClick={() => startEdit(r)}>
                      Edit
                    </button>
                    <button className="text-xs text-slate-600 hover:underline" onClick={() => toggle(r)}>
                      {r.enabled ? "Pause" : "Resume"}
                    </button>
                    <button className="text-xs text-red-600 hover:underline" onClick={() => remove(r)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card className="md:col-span-2 p-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">{editingId ? "Edit recipient" : "Add recipient"}</h2>
          <form onSubmit={save} className="space-y-3 text-sm">
            <input
              className="w-full border border-slate-300 rounded-md px-3 py-2"
              placeholder="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              className="w-full border border-slate-300 rounded-md px-3 py-2"
              placeholder="WhatsApp number, e.g. 256746363932"
              value={form.phoneNumber}
              onChange={(e) => setForm({ ...form, phoneNumber: e.target.value.replace(/\D/g, "") })}
              required
            />
            <select
              className="w-full border border-slate-300 rounded-md px-3 py-2 bg-white"
              value={form.minSeverity}
              onChange={(e) => setForm({ ...form, minSeverity: e.target.value as Severity })}
            >
              {(Object.keys(SEVERITY_LABEL) as Severity[]).map((s) => (
                <option key={s} value={s}>
                  {SEVERITY_LABEL[s]}
                </option>
              ))}
            </select>
            <fieldset>
              <legend className="text-xs text-slate-500 mb-1">Categories (none ticked = all)</legend>
              <div className="grid grid-cols-2 gap-1">
                {meta?.categories.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={form.categories.includes(c.key)} onChange={() => toggleCategory(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-4 text-xs text-slate-700">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} />
                WhatsApp
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.sms} onChange={(e) => setForm({ ...form, sms: e.target.checked })} />
                SMS {form.whatsapp ? "if WhatsApp fails" : ""} (costs per message)
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                {editingId ? "Save changes" : "Add recipient"}
              </Button>
              {editingId && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setEditingId(null);
                    setForm(EMPTY_FORM);
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-slate-800 px-4 pt-4 pb-2">Recent alerts</h2>
        <Table>
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Alert</th>
              <th className="px-4 py-2 font-medium">Delivered</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                  No alerts yet.
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr key={e.id} className="border-b border-slate-100 align-top">
                <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge tone={SEVERITY_TONE[e.severity]}>{e.severity.toLowerCase()}</Badge>
                    <span className="font-medium text-slate-900">{e.title}</span>
                    <span className="text-xs text-slate-400">{categoryLabel(e.category)}</span>
                  </div>
                  <div className="text-xs text-slate-600 mt-1">{e.message}</div>
                </td>
                <td className="px-4 py-2.5 text-xs">
                  {!e.deliveries || e.deliveries.length === 0 ? (
                    <span className="text-slate-400">nobody assigned</span>
                  ) : (
                    e.deliveries.map((d, i) => (
                      <div key={i} className={d.ok ? "text-green-700" : "text-red-600"} title={d.error}>
                        {d.name}: {d.ok ? d.channel : "failed"}
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
