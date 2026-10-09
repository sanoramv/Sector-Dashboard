export interface TabDef {
  key: string;
  label: string;
}

export interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div role="tablist" aria-label="Dashboard sections" style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid var(--color-border)" }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: "9px 14px",
            background: "none",
            border: "none",
            borderBottom: active === t.key ? "2px solid var(--color-accent)" : "2px solid transparent",
            color: active === t.key ? "var(--color-text)" : "var(--color-text-muted)",
            fontWeight: active === t.key ? 700 : 500,
            fontSize: 13.5,
            cursor: "pointer",
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
