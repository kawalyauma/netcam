import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { PageHeader, Card, Button } from "../components/ui";

const KNOWN_KEYS = [
  { key: "portal.brandName", label: "Portal brand name" },
  { key: "portal.supportPhone", label: "Support phone shown on portal" },
];

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
      <PageHeader title="Settings" subtitle="Portal branding and general configuration" />
      <Card className="p-4 max-w-lg">
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
