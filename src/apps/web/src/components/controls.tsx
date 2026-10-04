'use client';
import type { ReactNode } from 'react';

/** Accessible on/off switch (role="switch"). */
export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="switch-row">
      <span className="switch-text">
        <span className="switch-label">{label}</span>
        {hint && <span className="switch-hint">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="knob" />
      </button>
    </label>
  );
}

/** One-of-n choice as a segmented control (large tap targets for quick logging). */
export function Segmented<T extends string | boolean>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T | undefined;
  options: { value: T; label: ReactNode; tone?: 'ok' | 'bad' }[];
  onChange: (v: T | undefined) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup">
      {options.map((o) => (
        <button
          type="button"
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          className={`seg ${value === o.value ? `on ${o.tone ?? ''}` : ''}`}
          onClick={() => onChange(value === o.value ? undefined : o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
