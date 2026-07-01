import { useEffect, useRef, useState } from "react";
import type { ScreenerCriteria } from "./types";

export type SelectOption = { value: string; label: string };

type Props = {
  label: string;
  criteriaKey: keyof ScreenerCriteria;
  options: SelectOption[];
  criteria: ScreenerCriteria;
  onApply: (patch: Partial<ScreenerCriteria>) => void;
  tooltip?: string;
  disabled?: boolean;
  disabledReason?: string;
};

export function SelectFilterButton({
  label,
  criteriaKey,
  options,
  criteria,
  onApply,
  tooltip,
  disabled,
  disabledReason,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = criteria[criteriaKey] as string | undefined;
  const isActive = current != null;

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const select = (value: string) => {
    onApply({ [criteriaKey]: value } as Partial<ScreenerCriteria>);
    setOpen(false);
  };

  const clear = () => {
    onApply({ [criteriaKey]: undefined } as Partial<ScreenerCriteria>);
    setOpen(false);
  };

  const summary = () => {
    if (!isActive) return label;
    const opt = options.find((o) => o.value === current);
    return `${label}: ${opt ? opt.label : current}`;
  };

  return (
    <div className="range-filter" ref={ref}>
      <button
        type="button"
        className={"range-filter-button" + (isActive ? " active" : "") + (disabled ? " disabled" : "")}
        onClick={() => !disabled && setOpen((v) => !v)}
        title={disabled ? disabledReason : tooltip}
        disabled={disabled}
      >
        {summary()} ▾
      </button>
      {open && (
        <div className="range-filter-popover select-filter-popover">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={"select-filter-option" + (current === opt.value ? " selected" : "")}
              onClick={() => select(opt.value)}
            >
              {opt.label}
            </button>
          ))}
          <div className="range-filter-actions">
            <button type="button" className="range-filter-clear" onClick={clear}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
