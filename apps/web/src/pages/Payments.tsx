import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Badge, Table } from "../components/ui";
import type { Payment } from "../lib/types";

export default function Payments() {
  const [payments, setPayments] = useState<Payment[]>([]);

  useEffect(() => {
    api.get<Payment[]>("/payments").then(setPayments);
  }, []);

  const toneFor: Record<Payment["status"], "green" | "gray" | "red" | "amber"> = {
    SUCCESS: "green",
    PENDING: "amber",
    FAILED: "red",
    CANCELLED: "gray",
  };

  return (
    <div>
      <PageHeader title="Payments" subtitle="Ssentezo mobile-money transactions" />
      <Card>
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
            {payments.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-mono text-xs">{p.customer.phoneNumber}</td>
                <td className="px-4 py-2.5">{p.package.name}</td>
                <td className="px-4 py-2.5">UGX {p.amountUgx.toLocaleString()}</td>
                <td className="px-4 py-2.5"><Badge tone={toneFor[p.status]}>{p.status}</Badge></td>
                <td className="px-4 py-2.5 font-mono text-xs">{p.voucher?.code ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{new Date(p.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {payments.length === 0 && <p className="text-sm text-slate-400 p-4">No payments yet.</p>}
      </Card>
    </div>
  );
}
