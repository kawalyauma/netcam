import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, Button, Table, StatTile } from "../components/ui";
import { RankedBars } from "../components/charts";
import type { LedgerEntry, LedgerEntryType, LedgerPaymentMethod, LedgerSummary } from "../lib/types";

const ugx = (n: number) => `UGX ${n.toLocaleString()}`;
const inputClass = "border border-slate-300 rounded-md px-3 py-2 text-sm w-full";
const METHOD_LABEL: Record<LedgerPaymentMethod, string> = { CASH: "Cash", MOBILE_MONEY: "Mobile money", BANK: "Bank", OTHER: "Other" };

/** Local calendar date as YYYY-MM-DD (not UTC, so late-evening entries land on the right day). */
function localDate(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type Preset = "this-month" | "last-month" | "30-days" | "this-year" | "custom";

function presetRange(preset: Exclude<Preset, "custom">): { from: string; to: string } {
  const now = new Date();
  if (preset === "this-month") return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: localDate(now) };
  if (preset === "last-month") {
    return { from: localDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: localDate(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  if (preset === "30-days") return { from: localDate(new Date(now.getTime() - 29 * 86_400_000)), to: localDate(now) };
  return { from: localDate(new Date(now.getFullYear(), 0, 1)), to: localDate(now) };
}

const emptyEntry = (type: LedgerEntryType) => ({
  type,
  category: "",
  amount: "",
  occurredOn: localDate(),
  paymentMethod: "CASH" as LedgerPaymentMethod,
  description: "",
});

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function monthLabel(month: string) {
  return new Date(`${month}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export default function Finance() {
  const [preset, setPreset] = useState<Preset>("this-month");
  const [range, setRange] = useState(presetRange("this-month"));
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [categories, setCategories] = useState<{ income: string[]; expense: string[] }>({ income: [], expense: [] });
  const [editing, setEditing] = useState<{ id: string | null; form: ReturnType<typeof emptyEntry> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | LedgerEntryType>("ALL");

  async function load() {
    const q = `from=${range.from}&to=${range.to}`;
    const [s, e] = await Promise.all([
      api.get<LedgerSummary>(`/finance/ledger/summary?${q}`),
      api.get<LedgerEntry[]>(`/finance/ledger?${q}`),
    ]);
    setSummary(s);
    setEntries(e);
  }

  useEffect(() => {
    api.get<{ income: string[]; expense: string[] }>("/finance/ledger/categories").then(setCategories);
  }, []);

  useEffect(() => {
    load().catch((err) => setNotice((err as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  }

  function openNew(type: LedgerEntryType) {
    setEditing({ id: null, form: emptyEntry(type) });
    setError(null);
  }

  function openEdit(e: LedgerEntry) {
    setEditing({
      id: e.id,
      form: {
        type: e.type,
        category: e.category,
        amount: String(e.amountUgx),
        occurredOn: e.occurredOn.slice(0, 10),
        paymentMethod: e.paymentMethod,
        description: e.description ?? "",
      },
    });
    setError(null);
  }

  async function save() {
    if (!editing) return;
    const f = editing.form;
    const amountUgx = Number(f.amount.replace(/[, ]/g, ""));
    if (!f.category) return setError("Choose a category.");
    if (!Number.isInteger(amountUgx) || amountUgx <= 0) return setError("Amount must be a whole number of UGX above 0.");
    if (!f.occurredOn) return setError("Pick the date.");
    const body = {
      type: f.type,
      category: f.category,
      amountUgx,
      occurredOn: f.occurredOn,
      paymentMethod: f.paymentMethod,
      description: f.description.trim() || undefined,
    };
    try {
      if (editing.id) await api.patch(`/finance/ledger/${editing.id}`, body);
      else await api.post("/finance/ledger", body);
      setNotice(`${f.type === "INCOME" ? "Income" : "Expense"} of ${ugx(amountUgx)} ${editing.id ? "updated" : "recorded"}.`);
      setEditing(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(e: LedgerEntry) {
    if (!window.confirm(`Delete this ${e.type === "INCOME" ? "income" : "expense"} of ${ugx(e.amountUgx)} (${e.category})?`)) return;
    await api.delete(`/finance/ledger/${e.id}`);
    setNotice("Entry deleted.");
    await load();
  }

  function exportCsv() {
    const header = ["Date", "Type", "Category", "Amount (UGX)", "Method", "Description", "Recorded by"];
    const lines = entries.map((e) =>
      [e.occurredOn.slice(0, 10), e.type, e.category, e.amountUgx, METHOD_LABEL[e.paymentMethod], e.description ?? "", e.createdBy.email]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `netcam-income-expenses-${range.from}-to-${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const t = summary?.totals;
  const shown = entries.filter((e) => filter === "ALL" || e.type === filter);
  const f = editing?.form;

  return (
    <div>
      <PageHeader
        title="Income & Expenses"
        subtitle="Portal sales are added automatically; record everything else here"
        action={
          <div className="flex gap-2">
            <Button onClick={() => openNew("EXPENSE")}>Add expense</Button>
            <Button variant="secondary" onClick={() => openNew("INCOME")}>Add income</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4" role="tablist" aria-label="Period">
        {([
          ["this-month", "This month"],
          ["last-month", "Last month"],
          ["30-days", "Last 30 days"],
          ["this-year", "This year"],
          ["custom", "Custom"],
        ] as Array<[Preset, string]>).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={preset === value}
            onClick={() => choosePreset(value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${preset === value ? "bg-slate-900 text-white" : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
          >
            {label}
          </button>
        ))}
        {preset === "custom" && (
          <span className="flex items-center gap-2 text-xs">
            <input type="date" className="border border-slate-300 rounded-md px-2 py-1" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            to
            <input type="date" className="border border-slate-300 rounded-md px-2 py-1" value={range.to} min={range.from} max={localDate()} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </span>
        )}
      </div>

      {notice && (
        <div className="mb-4 flex items-center justify-between rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate-500 hover:text-slate-800" aria-label="Dismiss">✕</button>
        </div>
      )}

      {editing && f && (
        <Card className="p-4 mb-4">
          <h2 className="text-sm font-semibold mb-3">
            {editing.id ? "Edit" : "New"} {f.type === "INCOME" ? "income" : "expense"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
            <Field label="Type">
              <select className={inputClass} value={f.type} onChange={(e) => setEditing({ ...editing, form: { ...f, type: e.target.value as LedgerEntryType, category: "" } })}>
                <option value="EXPENSE">Expense (money out)</option>
                <option value="INCOME">Income (money in)</option>
              </select>
            </Field>
            <Field label="Category">
              <select className={inputClass} value={f.category} onChange={(e) => setEditing({ ...editing, form: { ...f, category: e.target.value } })}>
                <option value="">Choose…</option>
                {(f.type === "INCOME" ? categories.income : categories.expense).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Amount (UGX)">
              <input className={inputClass} inputMode="numeric" placeholder="e.g. 50000" value={f.amount} onChange={(e) => setEditing({ ...editing, form: { ...f, amount: e.target.value } })} />
            </Field>
            <Field label="Date">
              <input type="date" className={inputClass} max={localDate()} value={f.occurredOn} onChange={(e) => setEditing({ ...editing, form: { ...f, occurredOn: e.target.value } })} />
            </Field>
            <Field label="Paid with">
              <select className={inputClass} value={f.paymentMethod} onChange={(e) => setEditing({ ...editing, form: { ...f, paymentMethod: e.target.value as LedgerPaymentMethod } })}>
                {Object.entries(METHOD_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <div className="md:col-span-5">
              <Field label="Description (optional)">
                <input className={inputClass} placeholder="e.g. Umeme token for September" value={f.description} onChange={(e) => setEditing({ ...editing, form: { ...f, description: e.target.value } })} />
              </Field>
            </div>
          </div>
          {error && <p className="text-sm text-red-600 mb-3" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={save}>{editing.id ? "Save changes" : "Save"}</Button>
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatTile label="Income" value={ugx(t.incomeUgx)} />
          <StatTile label="Expenses" value={ugx(t.expenseUgx)} />
          <StatTile label={t.profitUgx >= 0 ? "Profit" : "Loss"} value={`${t.profitUgx < 0 ? "−" : ""}${ugx(Math.abs(t.profitUgx))}`} />
          <StatTile label="Withdrawn to phone" value={ugx(t.withdrawnUgx)} />
        </div>
      )}

      {summary && (
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3">Where money came from</h2>
            {summary.income.length ? (
              <RankedBars rows={summary.income.map((r) => ({ label: r.category, value: r.amountUgx, detail: r.automatic ? `${r.count} ${r.count === 1 ? "sale" : "sales"} · automatic` : `${r.count} ${r.count === 1 ? "entry" : "entries"}` }))} />
            ) : (
              <p className="text-sm text-slate-400">No income in this period.</p>
            )}
          </Card>
          <Card className="p-4">
            <h2 className="text-sm font-semibold mb-3">Where money went</h2>
            {summary.expenses.length ? (
              <RankedBars rows={summary.expenses.map((r) => ({ label: r.category, value: r.amountUgx, detail: `${r.count} ${r.count === 1 ? "entry" : "entries"}${r.automatic ? " · automatic" : ""}` }))} />
            ) : (
              <p className="text-sm text-slate-400">No expenses recorded in this period.</p>
            )}
          </Card>
        </div>
      )}

      {summary && summary.monthly.length > 1 && (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold px-4 pt-4 pb-2">Month by month</h2>
          <Table>
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Month</th>
                <th className="px-4 py-2 text-right">Income</th>
                <th className="px-4 py-2 text-right">Expenses</th>
                <th className="px-4 py-2 text-right">Profit</th>
              </tr>
            </thead>
            <tbody>
              {summary.monthly.map((m) => (
                <tr key={m.month} className="border-t border-slate-100">
                  <td className="px-4 py-2">{monthLabel(m.month)}</td>
                  <td className="px-4 py-2 text-right">{ugx(m.incomeUgx)}</td>
                  <td className="px-4 py-2 text-right">{ugx(m.expenseUgx)}</td>
                  <td className={`px-4 py-2 text-right font-medium ${m.profitUgx < 0 ? "text-red-700" : ""}`}>
                    {m.profitUgx < 0 ? "−" : ""}{ugx(Math.abs(m.profitUgx))}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-3">
          <h2 className="text-sm font-semibold mr-auto">Recorded entries</h2>
          {(["ALL", "EXPENSE", "INCOME"] as const).map((value) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${filter === value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
            >
              {value === "ALL" ? "All" : value === "EXPENSE" ? "Expenses" : "Income"}
            </button>
          ))}
          <Button variant="secondary" onClick={exportCsv} disabled={!entries.length}>Export CSV</Button>
        </div>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Category</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2">Paid with</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 text-xs">{e.occurredOn.slice(0, 10)}</td>
                <td className="px-4 py-2.5">{e.type === "INCOME" ? <Badge tone="green">Income</Badge> : <Badge tone="gray">Expense</Badge>}</td>
                <td className="px-4 py-2.5">{e.category}</td>
                <td className="px-4 py-2.5 text-right font-medium">{ugx(e.amountUgx)}</td>
                <td className="px-4 py-2.5 text-xs">{METHOD_LABEL[e.paymentMethod]}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{e.description ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => openEdit(e)}>Edit</Button>
                    <Button variant="danger" onClick={() => remove(e)}>Delete</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {shown.length === 0 && (
          <p className="text-sm text-slate-400 p-4">
            No {filter === "INCOME" ? "income" : filter === "EXPENSE" ? "expenses" : "entries"} recorded in this period. Portal sales and withdrawal fees are counted automatically above.
          </p>
        )}
      </Card>
    </div>
  );
}
