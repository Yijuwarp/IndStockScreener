import { useEffect, useRef, useState } from "react";
import type { ScreenerCriteria } from "./types";

export type RangeField = {
  criteriaKey: keyof ScreenerCriteria;
  label: string;
  defaultValue: number;
  suffix?: string;
  // Convert between what the user types (display units, e.g. Crores) and what's stored/sent to the API (raw units, e.g. rupees).
  toStored?: (displayValue: number) => number;
  fromStored?: (storedValue: number) => number;
};

type Props = {
  label: string;
  fields: RangeField[];
  criteria: ScreenerCriteria;
  onApply: (patch: Partial<ScreenerCriteria>) => void;
};

export function RangeFilterButton({ label, fields, criteria, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);

  const isActive = fields.some((f) => criteria[f.criteriaKey] != null);

  const openPopover = () => {
    const next: Record<string, string> = {};
    for (const f of fields) {
      const stored = criteria[f.criteriaKey];
      const display = stored != null ? (f.fromStored ? f.fromStored(stored as number) : (stored as number)) : f.defaultValue;
      next[f.criteriaKey as string] = String(display);
    }
    setDraft(next);
    setOpen(true);
  };

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const apply = () => {
    const patch: Partial<ScreenerCriteria> = {};
    for (const f of fields) {
      const raw = draft[f.criteriaKey as string];
      if (raw === "" || raw == null) {
        (patch as Record<string, unknown>)[f.criteriaKey as string] = undefined;
        continue;
      }
      const num = Number(raw);
      (patch as Record<string, unknown>)[f.criteriaKey as string] = f.toStored ? f.toStored(num) : num;
    }
    onApply(patch);
    setOpen(false);
  };

  const clear = () => {
    const patch: Partial<ScreenerCriteria> = {};
    for (const f of fields) (patch as Record<string, unknown>)[f.criteriaKey as string] = undefined;
    onApply(patch);
    setOpen(false);
  };

  const summary = () => {
    if (!isActive) return label;
    const parts = fields
      .filter((f) => criteria[f.criteriaKey] != null)
      .map((f) => {
        const stored = criteria[f.criteriaKey] as number;
        const display = f.fromStored ? f.fromStored(stored) : stored;
        return display.toLocaleString("en-IN") + (f.suffix ?? "");
      });
    return `${label}: ${parts.join(" – ")}`;
  };

  return (
    <div className="range-filter" ref={ref}>
      <button type="button" className={"range-filter-button" + (isActive ? " active" : "")} onClick={openPopover}>
        {summary()} ▾
      </button>
      {open && (
        <div className="range-filter-popover">
          {fields.map((f) => (
            <div key={f.criteriaKey as string} className="range-filter-row">
              <label>{f.label}</label>
              <div className="range-filter-input">
                <input
                  type="number"
                  value={draft[f.criteriaKey as string] ?? ""}
                  onChange={(e) => setDraft((prev) => ({ ...prev, [f.criteriaKey as string]: e.target.value }))}
                />
                {f.suffix && <span className="range-filter-suffix">{f.suffix}</span>}
              </div>
            </div>
          ))}
          <div className="range-filter-actions">
            <button type="button" className="range-filter-clear" onClick={clear}>Clear</button>
            <button type="button" className="range-filter-apply" onClick={apply}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
