"use client";

import { useId, type ReactNode } from "react";

export function AnchoredSearch({
  label,
  value,
  onChange,
  children,
  placeholder,
  status,
  expanded,
  onFocus,
  invalid,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children?: ReactNode;
  placeholder?: string;
  status?: ReactNode;
  expanded: boolean;
  onFocus?: () => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const inputId = useId();
  const listId = `${inputId}-results`;
  return <div className="anchoredSearch">
    <label htmlFor={inputId}>{label}</label>
    <div className="anchoredSearchAnchor">
      <input
        id={inputId}
        type="search"
        value={value}
        maxLength={120}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onFocus={onFocus}
        onChange={(event) => onChange(event.target.value)}
      />
      {expanded && <div id={listId} className="anchoredSearchResults" role="listbox">{children}</div>}
    </div>
    {status && <div className="anchoredSearchStatus" role="status">{status}</div>}
  </div>;
}

export function AnchoredSearchOption({ children, onSelect, selected = false, label }: {
  children: ReactNode;
  onSelect: () => void;
  selected?: boolean;
  label?: string;
}) {
  return <button type="button" role="option" aria-selected={selected} aria-label={label} onClick={onSelect}>{children}</button>;
}
