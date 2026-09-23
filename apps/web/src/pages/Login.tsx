import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { login, user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <form onSubmit={onSubmit} className="bg-white p-8 rounded-lg border border-slate-200 shadow-sm w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-1">NetCam Admin</h1>
        <p className="text-sm text-slate-500 mb-6">Sign in to manage your hotspot</p>
        <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
        <input
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-4"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
        <input
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm mb-4"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-accent text-white rounded-md py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
