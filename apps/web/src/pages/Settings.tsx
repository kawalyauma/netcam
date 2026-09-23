import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { PageHeader, Card, Button } from "../components/ui";

const KNOWN_KEYS = [
  { key: "portal.brandName", label: "Portal brand name" },
  { key: "portal.supportPhone", label: "Support phone shown on portal" },
];

function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4 max-w-lg mb-6">
      <h2 className="text-sm font-semibold mb-3">Change your password</h2>
      <input
        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-2"
        type="password"
        placeholder="Current password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
      />
      <input
        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-2"
        type="password"
        placeholder="New password (min 8 characters)"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
      />
      <input
        className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-3"
        type="password"
        placeholder="Confirm new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
      />
      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {success && <p className="text-sm text-accent mb-3">Password updated.</p>}
      <Button onClick={submit} disabled={busy || !currentPassword || !newPassword}>
        {busy ? "Saving…" : "Update password"}
      </Button>
    </Card>
  );
}

export default function Settings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    api.get<Record<string, string>>("/settings").then(setValues);
  }, []);

  async function save(key: string) {
    await api.put(`/settings/${key}`, { value: values[key] ?? "" });
    setSaved(key);
    setTimeout(() => setSaved(null), 1500);
  }

  return (
    <div>
      <PageHeader title="Settings" subtitle="Portal branding, general configuration, and your account" />

      <ChangePassword />

      <Card className="p-4 max-w-lg">
        <h2 className="text-sm font-semibold mb-3">Portal branding</h2>
        {KNOWN_KEYS.map(({ key, label }) => (
          <div key={key} className="mb-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-slate-300 rounded-md px-3 py-2 text-sm"
                value={values[key] ?? ""}
                onChange={(e) => setValues({ ...values, [key]: e.target.value })}
              />
              <Button onClick={() => save(key)}>{saved === key ? "Saved" : "Save"}</Button>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
