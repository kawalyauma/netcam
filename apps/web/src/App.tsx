import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Routers from "./pages/Routers";
import OutputChannels from "./pages/OutputChannels";
import Packages from "./pages/Packages";
import Vouchers from "./pages/Vouchers";
import Payments from "./pages/Payments";
import Customers from "./pages/Customers";
import Settings from "./pages/Settings";
import AdminUsers from "./pages/AdminUsers";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/routers" element={<Routers />} />
        <Route path="/output-channels" element={<OutputChannels />} />
        <Route path="/packages" element={<Packages />} />
        <Route path="/vouchers" element={<Vouchers />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin-users" element={<AdminUsers />} />
      </Route>
    </Routes>
  );
}
