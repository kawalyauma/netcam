import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Table } from "../components/ui";

interface Customer {
  id: string;
  phoneNumber: string;
  name?: string | null;
  createdAt: string;
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    api.get<Customer[]>("/customers").then(setCustomers);
  }, []);

  return (
    <div>
      <PageHeader title="Customers" subtitle="Phone-number identities used for purchases and voucher recovery" />
      <Card>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Since</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5 font-mono text-xs">{c.phoneNumber}</td>
                <td className="px-4 py-2.5">{c.name ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-500">{new Date(c.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        {customers.length === 0 && <p className="text-sm text-slate-400 p-4">No customers yet.</p>}
      </Card>
    </div>
  );
}
