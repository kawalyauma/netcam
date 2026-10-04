import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { PageHeader, Card, Badge, Button, Table, StatTile } from "../components/ui";
import type { FeeInfo, FeeSchedule, Withdrawal, WithdrawalBalance, WithdrawalStatus } from "../lib/types";

const ugx = (n: number) => `UGX ${n.toLocaleString()}`;
const inputClass = "border border-slate-300 rounded-md px-3 py-2 text-sm w-full";

const STATUS: Record<WithdrawalStatus, { label: string; tone: "green" | "amber" | "red" | "gray" }> = {
  REQUESTED: { label: "Waiting for approval", tone: "amber" },
  PROCESSING: { label: "Sending…", tone: "amber" },
  SUCCESS: { label: "Paid out", tone: "green" },
  FAILED: { label: "Failed, refunded", tone: "red" },
  REJECTED: { label: "Rejected", tone: "gray" },
  CANCELLED: { label: "Cancelled", tone: "gray" },
};

/** Same formula as the API (apps/api/src/finance/withdrawal-fees.ts), for the instant preview. */
function feeFor(amount: number, s: FeeSchedule): { fee: number } | { error: string } {
  if (!Number.isInteger(amount) || amount <= 0) return { error: "Enter a whole amount in UGX" };
  if (amount < s.minAmountUgx) return { error: `Minimum withdrawal is ${ugx(s.minAmountUgx)}` };
  if (amount > s.maxAmountUgx) return { error: `Maximum withdrawal is ${ugx(s.maxAmountUgx)}` };
  return { fee: s.baseFeeUgx + Math.max(0, Math.ceil(amount / s.bandSizeUgx) - 1) * s.stepFeeUgx };
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

/** Inline password step-up used before any action that moves money. */
function ConfirmWithPassword({
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  extra,
}: {
  title: string;
  confirmLabel: string;
  onConfirm: (password: string) => Promise<void>;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-medium text-slate-800 mb-2">{title}</p>
      {extra}
      <div className="flex gap-2">
        <input
          type="password"
          autoComplete="current-password"
          className={inputClass}
          placeholder="Your admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && password && submit()}
        />
        <Button onClick={submit} disabled={!password || busy}>{busy ? "Working…" : confirmLabel}</Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
      {error && <p className="text-xs text-red-600 mt-2" role="alert">{error}</p>}
    </div>
  );
}

export default function Withdrawals() {
  const { user } = useAuth();
  const isSuper = user?.role === "SUPER_ADMIN";

  const [balance, setBalance] = useState<WithdrawalBalance | null>(null);
  const [wallet, setWallet] = useState<{ ok: boolean; amount?: number; errorMessage?: string } | null>(null);
  const [fees, setFees] = useState<FeeInfo | null>(null);
  const [rows, setRows] = useState<Withdrawal[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState({ amount: "", phone: "", name: "", note: "" });
  const [confirming, setConfirming] = useState(false);
  const [action, setAction] = useState<{ id: string; kind: "approve" | "resolve" } | null>(null);
  const [resolveForm, setResolveForm] = useState<{ outcome: "SUCCESS" | "FAILED"; note: string }>({ outcome: "SUCCESS", note: "" });
  const [editingFees, setEditingFees] = useState<Record<keyof FeeSchedule, string> | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);

  async function load() {
    const [b, f, list] = await Promise.all([
      api.get<WithdrawalBalance>("/finance/withdrawals/balance"),
      api.get<FeeInfo>("/finance/withdrawals/fees"),
      api.get<Withdrawal[]>("/finance/withdrawals"),
    ]);
    setBalance(b);
    setFees(f);
    setRows(list);
    if (isSuper) api.get<typeof wallet>("/finance/withdrawals/wallet").then(setWallet).catch(() => setWallet(null));
  }

  useEffect(() => {
    load();
    // Keep "Sending…" rows moving without a manual refresh.
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuper]);

  const amount = Number(form.amount.replace(/[, ]/g, ""));
  const quote = useMemo(() => (fees && form.amount ? feeFor(amount, fees.schedule) : null), [amount, fees, form.amount]);
  const total = quote && "fee" in quote ? amount + quote.fee : null;
  const shortBy = total !== null && balance ? total - balance.availableUgx : 0;
  const maxWithdrawable = useMemo(() => {
    if (!fees || !balance) return 0;
    // Largest amount whose amount + fee fits the balance.
    let lo = 0;
    let hi = Math.min(balance.availableUgx, fees.schedule.maxAmountUgx);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const q = feeFor(mid, fees.schedule);
      if ("fee" in q && mid + q.fee <= balance.availableUgx) lo = mid;
      else hi = mid - 1;
    }
    return lo >= fees.schedule.minAmountUgx ? lo : 0;
  }, [fees, balance]);

  const formError = !form.amount
    ? null
    : quote && "error" in quote
      ? quote.error
      : shortBy > 0
        ? `Not enough balance: you need ${ugx(total ?? 0)} including the fee`
        : !/^(\+?256|0)?7\d{8}$/.test(form.phone.replace(/[\s-]/g, "")) && form.phone
          ? "Enter a valid Ugandan mobile-money number, e.g. 0772123456"
          : null;
  const canSubmit = Boolean(form.amount && form.phone && !formError && total !== null);

  async function requestWithdrawal(password: string) {
    const created = await api.post<Withdrawal>("/finance/withdrawals", {
      amountUgx: amount,
      phoneNumber: form.phone,
      recipientName: form.name || undefined,
      note: form.note || undefined,
      password,
    });
    setConfirming(false);
    setForm({ amount: "", phone: form.phone, name: form.name, note: "" });
    setNotice(
      created.status === "REQUESTED"
        ? `Request for ${ugx(created.amountUgx)} sent. A super admin must approve it before the money is sent.`
        : created.status === "FAILED"
          ? `The payout failed: ${created.failureReason ?? "unknown reason"}. Nothing was deducted.`
          : `${ugx(created.amountUgx)} is on its way to ${created.phoneNumber}.`,
    );
    await load();
  }

  async function run<T>(fn: () => Promise<T>, message: string) {
    try {
      await fn();
      setNotice(message);
      setAction(null);
      await load();
    } catch (err) {
      setNotice((err as Error).message);
      throw err;
    }
  }

  async function saveFees() {
    if (!editingFees) return;
    const schedule = Object.fromEntries(Object.entries(editingFees).map(([k, v]) => [k, Number(String(v).replace(/[, ]/g, ""))])) as unknown as FeeSchedule;
    try {
      const updated = await api.put<FeeInfo>("/finance/withdrawals/fees", schedule);
      setFees(updated);
      setEditingFees(null);
      setFeeError(null);
      setNotice("Withdrawal fees updated.");
    } catch (err) {
      setFeeError((err as Error).message);
    }
  }

  const pending = rows.filter((w) => w.status === "REQUESTED");

  return (
    <div>
      <PageHeader title="Withdrawals" subtitle="Send your mobile-money earnings to your phone" />

      {notice && (
        <div className="mb-4 flex items-center justify-between rounded-md bg-slate-100 px-4 py-2 text-sm text-slate-700">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-slate-500 hover:text-slate-800" aria-label="Dismiss">✕</button>
        </div>
      )}

      {balance && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatTile label="Available to withdraw" value={ugx(balance.availableUgx)} />
          <StatTile label="On hold (pending)" value={ugx(balance.onHoldUgx)} />
          <StatTile label="Withdrawn so far" value={ugx(balance.withdrawnUgx)} />
          <StatTile label="Fees paid" value={ugx(balance.feesPaidUgx)} />
        </div>
      )}
      {isSuper && wallet && (
        <p className="text-xs text-slate-500 mb-4">
          Ssentezo wallet right now: {wallet.ok && wallet.amount !== undefined ? <strong>{ugx(wallet.amount)}</strong> : <span className="text-amber-700">unavailable ({wallet.errorMessage})</span>}
          {" · "}Only mobile-money sales can be withdrawn; cash from printed vouchers is already in your hand.
        </p>
      )}

      <div className="grid md:grid-cols-3 gap-4 mb-4">
        <Card className="p-4 md:col-span-2">
          <h2 className="text-sm font-semibold mb-3">New withdrawal</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field
              label="Amount to receive (UGX)"
              hint={maxWithdrawable ? (
                <button className="underline" onClick={() => setForm({ ...form, amount: String(maxWithdrawable) })}>
                  Withdraw the maximum: {ugx(maxWithdrawable)}
                </button>
              ) : "Your balance is too low to withdraw yet."}
            >
              <input className={inputClass} inputMode="numeric" placeholder="e.g. 50000" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Mobile-money number">
              <input className={inputClass} inputMode="tel" placeholder="0772 123456" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="Recipient name (optional)">
              <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Note (optional)">
              <input className={inputClass} placeholder="e.g. weekly takings" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
          </div>

          {total !== null && quote && "fee" in quote && (
            <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 rounded-md bg-slate-50 p-3 text-sm">
              <div><dt className="text-xs text-slate-500">You receive</dt><dd className="font-semibold">{ugx(amount)}</dd></div>
              <div><dt className="text-xs text-slate-500">Withdrawal fee</dt><dd className="font-semibold">{ugx(quote.fee)}</dd></div>
              <div><dt className="text-xs text-slate-500">Total deducted</dt><dd className="font-semibold">{ugx(total)}</dd></div>
              <div><dt className="text-xs text-slate-500">Balance after</dt><dd className="font-semibold">{balance ? ugx(Math.max(0, balance.availableUgx - total)) : "—"}</dd></div>
            </dl>
          )}
          {formError && <p className="text-sm text-red-600 mt-3" role="alert">{formError}</p>}

          {confirming ? (
            <ConfirmWithPassword
              title={`Send ${ugx(amount)} to ${form.phone}? ${ugx(total ?? 0)} will be deducted from your balance.`}
              confirmLabel={isSuper ? "Send money" : "Request withdrawal"}
              onConfirm={requestWithdrawal}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <div className="mt-4 flex items-center gap-3">
              <Button onClick={() => setConfirming(true)} disabled={!canSubmit}>{isSuper ? "Withdraw now" : "Request withdrawal"}</Button>
              {!isSuper && <span className="text-xs text-slate-500">A super admin approves requests before money is sent.</span>}
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Withdrawal fees</h2>
            {isSuper && !editingFees && fees && (
              <button
                className="text-xs underline text-slate-500 hover:text-slate-800"
                onClick={() => setEditingFees(Object.fromEntries(Object.entries(fees.schedule).map(([k, v]) => [k, String(v)])) as Record<keyof FeeSchedule, string>)}
              >
                Edit
              </button>
            )}
          </div>
          {editingFees ? (
            <div className="space-y-2">
              {([
                ["minAmountUgx", "Minimum withdrawal"],
                ["maxAmountUgx", "Maximum withdrawal"],
                ["bandSizeUgx", "Band size"],
                ["baseFeeUgx", "Fee for the first band"],
                ["stepFeeUgx", "Extra fee per further band"],
              ] as Array<[keyof FeeSchedule, string]>).map(([key, label]) => (
                <Field key={key} label={`${label} (UGX)`}>
                  <input className={inputClass} inputMode="numeric" value={editingFees[key]} onChange={(e) => setEditingFees({ ...editingFees, [key]: e.target.value })} />
                </Field>
              ))}
              {feeError && <p className="text-xs text-red-600" role="alert">{feeError}</p>}
              <div className="flex gap-2 pt-1">
                <Button onClick={saveFees}>Save fees</Button>
                <Button variant="secondary" onClick={() => { setEditingFees(null); setFeeError(null); }}>Cancel</Button>
              </div>
            </div>
          ) : (
            fees && (
              <>
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-slate-500">
                    <tr><th className="py-1">Amount</th><th className="py-1 text-right">Fee</th></tr>
                  </thead>
                  <tbody>
                    {fees.tiers.slice(0, 8).map((t) => (
                      <tr key={t.fromUgx} className="border-t border-slate-100">
                        <td className="py-1">{t.fromUgx.toLocaleString()} – {t.toUgx.toLocaleString()}</td>
                        <td className="py-1 text-right">{t.feeUgx.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-slate-500 mt-2">
                  +{ugx(fees.schedule.stepFeeUgx)} for every further {ugx(fees.schedule.bandSizeUgx)}, up to {ugx(fees.schedule.maxAmountUgx)}. The fee is added on top; you receive the full amount.
                </p>
              </>
            )
          )}
        </Card>
      </div>

      {isSuper && pending.length > 0 && (
        <Card className="p-4 mb-4 border-amber-200">
          <h2 className="text-sm font-semibold mb-2">Waiting for your approval ({pending.length})</h2>
          {pending.map((w) => (
            <div key={w.id} className="border-t border-slate-100 py-3">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-semibold">{ugx(w.amountUgx)}</span>
                <span className="text-slate-500">+ fee {ugx(w.feeUgx)}</span>
                <span className="font-mono text-xs">{w.phoneNumber}</span>
                {w.recipientName && <span>{w.recipientName}</span>}
                <span className="text-xs text-slate-500">by {w.requestedBy.fullName ?? w.requestedBy.email} · {new Date(w.createdAt).toLocaleString()}</span>
                <span className="ml-auto flex gap-2">
                  <Button onClick={() => setAction({ id: w.id, kind: "approve" })}>Approve & send</Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      const reason = window.prompt("Reason for rejecting (shown to the requester):") ?? undefined;
                      if (reason !== undefined) run(() => api.post(`/finance/withdrawals/${w.id}/reject`, { reason }), "Withdrawal rejected; the balance was released.").catch(() => undefined);
                    }}
                  >
                    Reject
                  </Button>
                </span>
              </div>
              {w.note && <p className="text-xs text-slate-500 mt-1">Note: {w.note}</p>}
              {action?.id === w.id && action.kind === "approve" && (
                <ConfirmWithPassword
                  title={`Send ${ugx(w.amountUgx)} to ${w.phoneNumber} now?`}
                  confirmLabel="Approve & send"
                  onConfirm={(password) => run(() => api.post(`/finance/withdrawals/${w.id}/approve`, { password }), `${ugx(w.amountUgx)} sent to ${w.phoneNumber}.`)}
                  onCancel={() => setAction(null)}
                />
              )}
            </div>
          ))}
        </Card>
      )}

      <Card>
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">History</h2>
          <Button variant="secondary" onClick={load}>Refresh</Button>
        </div>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Fee</th>
              <th className="px-4 py-2">To</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Requested by</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className="border-t border-slate-100 align-top">
                <td className="px-4 py-2.5 text-xs text-slate-500">{new Date(w.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2.5 font-medium">{ugx(w.amountUgx)}</td>
                <td className="px-4 py-2.5 text-xs">{ugx(w.feeUgx)}</td>
                <td className="px-4 py-2.5">
                  <div className="font-mono text-xs">{w.phoneNumber}</div>
                  {w.recipientName && <div className="text-xs text-slate-500">{w.recipientName}</div>}
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={STATUS[w.status].tone}>{STATUS[w.status].label}</Badge>
                  {(w.failureReason || w.reviewNote) && (
                    <div className="text-xs text-slate-500 mt-1 max-w-xs">{w.failureReason ?? w.reviewNote}</div>
                  )}
                  {w.financialTransactionId && <div className="text-xs text-slate-400 font-mono mt-1">Ref {w.financialTransactionId}</div>}
                </td>
                <td className="px-4 py-2.5 text-xs">{w.requestedBy.fullName ?? w.requestedBy.email}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-2">
                    {w.status === "REQUESTED" && (w.requestedById === user?.id || isSuper) && (
                      <Button variant="secondary" onClick={() => run(() => api.post(`/finance/withdrawals/${w.id}/cancel`), "Withdrawal cancelled; the balance was released.").catch(() => undefined)}>
                        Cancel
                      </Button>
                    )}
                    {w.status === "PROCESSING" && (
                      <Button variant="secondary" onClick={() => run(() => api.post(`/finance/withdrawals/${w.id}/refresh`), "Status checked with Ssentezo.").catch(() => undefined)}>
                        Check status
                      </Button>
                    )}
                    {w.status === "PROCESSING" && isSuper && (
                      <Button variant="secondary" onClick={() => { setResolveForm({ outcome: "SUCCESS", note: "" }); setAction({ id: w.id, kind: "resolve" }); }}>
                        Resolve
                      </Button>
                    )}
                  </div>
                  {action?.id === w.id && action.kind === "resolve" && (
                    <ConfirmWithPassword
                      title="Only if Ssentezo can't confirm it: record what really happened."
                      confirmLabel="Save outcome"
                      extra={
                        <div className="flex gap-2 mb-2">
                          <select className="border border-slate-300 rounded-md px-2 py-2 text-sm" value={resolveForm.outcome} onChange={(e) => setResolveForm({ ...resolveForm, outcome: e.target.value as "SUCCESS" | "FAILED" })}>
                            <option value="SUCCESS">Money was received</option>
                            <option value="FAILED">Money was NOT sent (refund balance)</option>
                          </select>
                          <input className={inputClass} placeholder="How you confirmed (e.g. Ssentezo transaction ID)" value={resolveForm.note} onChange={(e) => setResolveForm({ ...resolveForm, note: e.target.value })} />
                        </div>
                      }
                      onConfirm={(password) => run(() => api.post(`/finance/withdrawals/${w.id}/resolve`, { ...resolveForm, password }), "Withdrawal outcome recorded.")}
                      onCancel={() => setAction(null)}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <p className="text-sm text-slate-400 p-4">No withdrawals yet.</p>}
      </Card>
    </div>
  );
}
