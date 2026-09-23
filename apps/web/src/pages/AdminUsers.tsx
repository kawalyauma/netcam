import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { PageHeader, Card, Badge, Button, Table } from "../components/ui";
import { useAuth } from "../lib/auth";

interface AdminUserRow {
  id: string;
  email: string;
  fullName?: string | null;
  role: "SUPER_ADMIN" | "OPERATOR";
  isActive: boolean;
  createdAt: string;
}

const emptyForm = { email: "", password: "", fullName: "", role: "OPERATOR" as "SUPER_ADMIN" | "OPERATOR" };

export default function AdminUsers() {
  const { user } = useAuth();
  const [admins, setAdmins] = useState<AdminUserRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setAdmins(await api.get<AdminUserRow[]>("/admin-users"));
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError(null);
    if (!form.email || !form.password) return;
    try {
      await api.post("/admin-users", form);
      setForm(emptyForm);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    }
  }

  async function toggleActive(admin: AdminUserRow) {
    const action = admin.isActive ? "deactivate" : "activate";
    await api.patch(`/admin-users/${admin.id}/${action}`);
    load();
  }

  if (user?.role !== "SUPER_ADMIN") {
    return (
      <div>
        <PageHeader title="Admin Users" />
        <Card className="p-4 text-sm text-slate-500">Only super admins can manage other admin accounts.</Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Admin Users"
        subtitle="Who can sign in to this dashboard"
        action={<Button onClick={() => setShowForm((s) => !s)}>{showForm ? "Cancel" : "Add admin"}</Button>}
      />

      {showForm && (
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-4 gap-3 mb-3">
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Temporary password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <input className="border border-slate-300 rounded-md px-3 py-2 text-sm" placeholder="Full name (optional)" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            <select className="border border-slate-300 rounded-md px-3 py-2 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "SUPER_ADMIN" | "OPERATOR" })}>
              <option value="OPERATOR">Operator</option>
              <option value="SUPER_ADMIN">Super admin</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
          <Button onClick={create}>Create</Button>
        </Card>
      )}

      <Card>
        <Table>
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5">{a.email}</td>
                <td className="px-4 py-2.5">{a.fullName ?? "—"}</td>
                <td className="px-4 py-2.5">{a.role}</td>
                <td className="px-4 py-2.5">{a.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Deactivated</Badge>}</td>
                <td className="px-4 py-2.5 text-right">
                  {a.id !== user.id && (
                    <Button variant={a.isActive ? "danger" : "secondary"} onClick={() => toggleActive(a)}>
                      {a.isActive ? "Deactivate" : "Activate"}
                    </Button>
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
