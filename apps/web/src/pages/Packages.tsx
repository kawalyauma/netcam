import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, Button, Table } from "../components/ui";
import type { Package } from "../lib/types";

type PackageRow = Package & { inUse?: boolean };
type DurationUnit = "minutes" | "hours" | "days";

const UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 1440 };
const MIN_MOBILE_MONEY_UGX = 500;

const emptyForm = {
  name: "",
  description: "",
  priceUgx: "",
  limitType: "DURATION" as Package["limitType"],
  duration: "",
  durationUnit: "hours" as DurationUnit,
  dataCapMb: "",
  downKbps: "2048",
  upKbps: "1024",
  deviceLimit: "1",
};

type Form = typeof emptyForm;

function toForm(p: Package): Form {
  const minutes = p.durationMinutes ?? 0;
  const unit: DurationUnit = minutes && minutes % 1440 === 0 ? "days" : minutes && minutes % 60 === 0 ? "hours" : "minutes";
  return {
    name: p.name,
    description: p.description ?? "",
    priceUgx: String(p.priceUgx),
    limitType: p.limitType,
    duration: minutes ? String(minutes / UNIT_MINUTES[unit]) : "",
    durationUnit: unit,
    dataCapMb: p.dataCapMb ? String(p.dataCapMb) : "",
    downKbps: String(p.downKbps),
    upKbps: String(p.upKbps),
    deviceLimit: String(p.deviceLimit),
  };
}

function formatDuration(minutes: number) {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} min`;
}

function formatData(mb: number) {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

/** Client-side checks so the admin gets a clear message before the API does. */
function validate(form: Form): string | null {
  const usesDuration = form.limitType !== "DATA_CAP";
  const usesData = form.limitType !== "DURATION";
  const positiveInt = (v: string) => /^\d+$/.test(v.trim()) && Number(v) > 0;
  if (!form.name.trim()) return "Give the package a name.";
  if (!/^\d+$/.test(form.priceUgx.trim())) return "Price must be a whole number of UGX.";
  if (usesDuration && !(Number(form.duration) > 0)) return "Enter how long the package lasts.";
  if (usesDuration && !Number.isInteger(Number(form.duration) * UNIT_MINUTES[form.durationUnit])) return "Duration must be a whole number of minutes.";
  if (usesData && !positiveInt(form.dataCapMb)) return "Enter the data allowance in MB.";
  if (!positiveInt(form.downKbps) || !positiveInt(form.upKbps)) return "Speeds must be whole numbers above 0.";
  if (!positiveInt(form.deviceLimit)) return "Device limit must be at least 1.";
  return null;
}

function toPayload(form: Form) {
  const usesDuration = form.limitType !== "DATA_CAP";
  const usesData = form.limitType !== "DURATION";
  return {
    name: form.name.trim(),
    description: form.description.trim() || undefined,
    priceUgx: Number(form.priceUgx),
    limitType: form.limitType,
    durationMinutes: usesDuration ? Math.round(Number(form.duration) * UNIT_MINUTES[form.durationUnit]) : undefined,
    dataCapMb: usesData ? Number(form.dataCapMb) : undefined,
    downKbps: Number(form.downKbps),
    upKbps: Number(form.upKbps),
    deviceLimit: Number(form.deviceLimit),
  };
}

const inputClass = "border border-slate-300 rounded-md px-3 py-2 text-sm w-full";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}

export default function Packages() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setPackages(await api.get<PackageRow[]>("/packages"));
  }

  useEffect(() => {
    load();
  }, []);

  function openNew() {
    setForm(emptyForm);
    setEditingId("new");
    setError(null);
  }

  function openEdit(p: Package) {
    setForm(toForm(p));
    setEditingId(p.id);
    setError(null);
  }

  async function save() {
    const problem = validate(form);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      if (editingId === "new") await api.post("/packages", toPayload(form));
      else await api.patch(`/packages/${editingId}`, toPayload(form));
      setNotice(editingId === "new" ? `Package "${form.name.trim()}" created.` : `Package "${form.name.trim()}" updated.`);
      setEditingId(null);
      setError(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(p: PackageRow, isActive: boolean) {
    try {
      await api.patch(`/packages/${p.id}`, { isActive });
      setNotice(`"${p.name}" ${isActive ? "is now on sale" : "is hidden from the portal"}.`);
      await load();
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  async function remove(p: PackageRow) {
    const message = p.inUse
      ? `"${p.name}" has sales or vouchers, so it can't be erased. It will be deactivated (hidden from the portal) instead. Continue?`
      : `Delete "${p.name}" permanently?`;
    if (!window.confirm(message)) return;
    try {
      const result = await api.delete<{ deleted: boolean }>(`/packages/${p.id}`);
      setNotice(result.deleted ? `"${p.name}" deleted.` : `"${p.name}" deactivated; its sales history is kept.`);
      if (editingId === p.id) setEditingId(null);
      await load();
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  const usesDuration = form.limitType !== "DATA_CAP";
  const usesData = form.limitType !== "DURATION";
  const price = Number(form.priceUgx);

  return (
    <div>
      <PageHeader
        title="Packages"
        subtitle="Plans sold on the captive portal: price, time/data, speed and device limit"
        action={editingId ? <Button variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button> : <Button onClick={openNew}>Add package</Button>}
      />

      {notice && (
        <div className="mb-4 flex items-center justify-between rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate-500 hover:text-slate-800" aria-label="Dismiss">✕</button>
        </div>
      )}

      {editingId && (
        <Card className="p-4 mb-4">
          <h2 className="text-sm font-semibold mb-3">{editingId === "new" ? "New package" : "Edit package"}</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
            <Field label="Name">
              <input className={inputClass} placeholder="e.g. Daily 1 GB" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field
              label="Price (UGX)"
              hint={form.priceUgx && price < MIN_MOBILE_MONEY_UGX ? `Mobile money needs at least UGX ${MIN_MOBILE_MONEY_UGX}; use printed vouchers for this price.` : undefined}
            >
              <input className={inputClass} inputMode="numeric" placeholder="1000" value={form.priceUgx} onChange={(e) => setForm({ ...form, priceUgx: e.target.value })} />
            </Field>
            <Field label="Limit type">
              <select className={inputClass} value={form.limitType} onChange={(e) => setForm({ ...form, limitType: e.target.value as Package["limitType"] })}>
                <option value="DURATION">Time only</option>
                <option value="DATA_CAP">Data only</option>
                <option value="DURATION_AND_DATA_CAP">Time + data</option>
              </select>
            </Field>
            <Field label="Devices per voucher">
              <input className={inputClass} inputMode="numeric" value={form.deviceLimit} onChange={(e) => setForm({ ...form, deviceLimit: e.target.value })} />
            </Field>
            {usesDuration && (
              <Field label="Duration">
                <div className="flex gap-2">
                  <input className={inputClass} inputMode="decimal" placeholder="24" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
                  <select className="border border-slate-300 rounded-md px-2 py-2 text-sm" value={form.durationUnit} onChange={(e) => setForm({ ...form, durationUnit: e.target.value as DurationUnit })}>
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                    <option value="days">days</option>
                  </select>
                </div>
              </Field>
            )}
            {usesData && (
              <Field label="Data allowance (MB)" hint="1 GB = 1024 MB">
                <input className={inputClass} inputMode="numeric" placeholder="1024" value={form.dataCapMb} onChange={(e) => setForm({ ...form, dataCapMb: e.target.value })} />
              </Field>
            )}
            <Field label="Download speed (Kbps)" hint="2048 Kbps ≈ 2 Mbps">
              <input className={inputClass} inputMode="numeric" value={form.downKbps} onChange={(e) => setForm({ ...form, downKbps: e.target.value })} />
            </Field>
            <Field label="Upload speed (Kbps)">
              <input className={inputClass} inputMode="numeric" value={form.upKbps} onChange={(e) => setForm({ ...form, upKbps: e.target.value })} />
            </Field>
            <div className="md:col-span-4">
              <Field label="Description (optional, shown on the portal)">
                <input className={inputClass} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </Field>
            </div>
          </div>
          {error && <p className="text-sm text-red-600 mb-3" role="alert">{error}</p>}
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : editingId === "new" ? "Create package" : "Save changes"}</Button>
        </Card>
      )}

      <Card>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Gives</th>
              <th className="px-4 py-2">Speed</th>
              <th className="px-4 py-2">Devices</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {packages.map((p) => (
              <tr key={p.id} className={`border-t border-slate-100 ${p.isActive ? "" : "text-slate-400"}`}>
                <td className="px-4 py-2.5 font-medium">{p.name}</td>
                <td className="px-4 py-2.5">UGX {p.priceUgx.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-xs">
                  {[p.durationMinutes ? formatDuration(p.durationMinutes) : null, p.dataCapMb ? formatData(p.dataCapMb) : null].filter(Boolean).join(" + ")}
                </td>
                <td className="px-4 py-2.5 text-xs">{p.downKbps}/{p.upKbps} Kbps</td>
                <td className="px-4 py-2.5">{p.deviceLimit}</td>
                <td className="px-4 py-2.5">{p.isActive ? <Badge tone="green">On sale</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => openEdit(p)}>Edit</Button>
                    <Button variant="secondary" onClick={() => setActive(p, !p.isActive)}>{p.isActive ? "Deactivate" : "Activate"}</Button>
                    <Button variant="danger" onClick={() => remove(p)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {packages.length === 0 && <p className="text-sm text-slate-400 p-4">No packages yet. Add one to start selling.</p>}
      </Card>
    </div>
  );
}
