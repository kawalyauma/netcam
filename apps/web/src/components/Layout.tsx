import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

const NAV_ITEMS = [
  { to: "/", label: "Overview", end: true },
  { to: "/routers", label: "Routers" },
  { to: "/output-channels", label: "Output Channels" },
  { to: "/packages", label: "Packages" },
  { to: "/vouchers", label: "Vouchers" },
  { to: "/payments", label: "Payments" },
  { to: "/customers", label: "Customers" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  const { user, logout, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col shrink-0">
        <div className="px-4 py-5 font-semibold text-lg border-b border-slate-800">NetCam</div>
        <nav className="flex-1 py-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-4 py-2.5 text-sm ${isActive ? "bg-accent text-white" : "text-slate-300 hover:bg-slate-800"}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-slate-800 text-xs">
          <div className="mb-2 text-slate-400">{user.email}</div>
          <button onClick={logout} className="text-slate-300 hover:text-white">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 p-6 max-w-6xl">
        <Outlet />
      </main>
    </div>
  );
}
