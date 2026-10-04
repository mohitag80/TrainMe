'use client';
import { useMemo, useState } from 'react';
import { api, errorText } from '@/lib/client/api';
import { CATEGORY_KINDS, categoryKindLabel, pathText, suggestedKind, type TreeNode } from '@/lib/admin';

/**
 * Places an item in the catalog tree by name only: shows the chosen path ("Sports › Racquet Sports › Table
 * Tennis"), a searchable expandable tree, and an inline form to add a missing category under the selection.
 */
export function CategoryPicker({
  tree,
  value,
  onChange,
  onTreeChanged,
  disabled,
}: {
  tree: TreeNode[];
  value: string | null;
  onChange: (code: string) => void;
  onTreeChanged: () => Promise<unknown>;
  disabled?: boolean;
}) {
  const selected = tree.find((n) => n.code === value);
  const [open, setOpen] = useState(!selected);
  if (!open || disabled)
    return (
      <div className="picked">
        {selected ? <Crumbs path={selected.path} /> : <span className="muted">Not placed yet</span>}
        {!disabled && (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            {selected ? 'Change' : 'Choose'}
          </button>
        )}
      </div>
    );
  return (
    <TreeBrowser
      tree={tree}
      value={value}
      onPick={(code) => {
        onChange(code);
        setOpen(false);
      }}
      onTreeChanged={onTreeChanged}
      onClose={selected ? () => setOpen(false) : undefined}
    />
  );
}

export function Crumbs({ path }: { path: string[] }) {
  return (
    <span className="crumb-path" title={pathText(path)}>
      {path.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="sep">›</span>}
          <span className={i === path.length - 1 ? 'last' : ''}>{p}</span>
        </span>
      ))}
    </span>
  );
}

/** Expandable tree with search; `onPick` selects a node, the add form creates a child of the highlighted node. */
export function TreeBrowser({
  tree,
  value,
  onPick,
  onTreeChanged,
  onClose,
  onFocusChange,
  pickLabel = 'Place it here',
  showCounts = true,
}: {
  tree: TreeNode[];
  value: string | null;
  onPick: (code: string) => void;
  onTreeChanged: () => Promise<unknown>;
  onClose?: () => void;
  /** Browsing mode: report the highlighted node (e.g. to list what is placed there). */
  onFocusChange?: (code: string) => void;
  /** Label of the select button; null hides it. */
  pickLabel?: string | null;
  showCounts?: boolean;
}) {
  const [q, setQ] = useState('');
  const [focus, setFocusState] = useState<string | null>(value);
  const setFocus = (code: string) => {
    setFocusState(code);
    onFocusChange?.(code);
  };
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set(tree.filter((n) => n.level <= 1).map((n) => n.code));
    // open the branch of the current value
    let cur = tree.find((n) => n.code === value);
    while (cur?.parentCode) {
      open.add(cur.parentCode);
      cur = tree.find((n) => n.code === cur!.parentCode);
    }
    return open;
  });
  const children = useMemo(() => {
    const m = new Map<string | null, TreeNode[]>();
    for (const n of tree) m.set(n.parentCode, [...(m.get(n.parentCode) ?? []), n]);
    return m;
  }, [tree]);
  const term = q.trim().toLowerCase();
  const matches = term ? tree.filter((n) => n.path.join(' ').toLowerCase().includes(term)) : [];
  const focused = tree.find((n) => n.code === focus);

  const toggle = (code: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  const row = (n: TreeNode) => {
    const kids = children.get(n.code) ?? [];
    const isOpen = expanded.has(n.code);
    return (
      <li key={n.code}>
        <div className={`tree-row${n.code === focus ? ' on' : ''}`} style={{ paddingLeft: (n.level - 1) * 18 + 6 }}>
          <button
            type="button"
            className="tree-toggle"
            aria-label={isOpen ? 'Collapse' : 'Expand'}
            disabled={kids.length === 0}
            onClick={() => toggle(n.code)}
          >
            {kids.length === 0 ? '' : isOpen ? '▾' : '▸'}
          </button>
          <button
            type="button"
            className="tree-name"
            onClick={() => setFocus(n.code)}
            onDoubleClick={() => onPick(n.code)}
          >
            {n.name}
            <span className="tree-kind">{categoryKindLabel(n.kind)}</span>
          </button>
          {showCounts && (n.templates > 0 || n.activities > 0) && (
            <span className="tree-count">
              {n.templates > 0 && `${n.templates} profile${n.templates === 1 ? '' : 's'}`}
              {n.templates > 0 && n.activities > 0 && ' · '}
              {n.activities > 0 && `${n.activities} activit${n.activities === 1 ? 'y' : 'ies'}`}
            </span>
          )}
        </div>
        {isOpen && kids.length > 0 && <ul className="tree">{kids.map(row)}</ul>}
      </li>
    );
  };

  return (
    <div className="tree-browser">
      <div className="row gap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a sport, position or muscle…" />
        {onClose && (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
      <div className="tree-scroll">
        {term ? (
          matches.length === 0 ? (
            <p className="muted small">Nothing matches “{q}”. Pick the closest parent and add it below.</p>
          ) : (
            <ul className="tree">
              {matches.map((n) => (
                <li key={n.code}>
                  <button
                    type="button"
                    className={`tree-row tree-name${n.code === focus ? ' on' : ''}`}
                    onClick={() => setFocus(n.code)}
                  >
                    <Crumbs path={n.path} />
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <ul className="tree">{(children.get(null) ?? []).map(row)}</ul>
        )}
      </div>
      {focused && (
        <div className="tree-actions">
          <div className="small muted">Selected</div>
          <Crumbs path={focused.path} />
          {pickLabel && (
            <div className="row gap wrap" style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onPick(focused.code)}>
                {pickLabel}
              </button>
            </div>
          )}
          <AddCategory
            parent={focused}
            onCreated={async (code) => {
              await onTreeChanged();
              setExpanded((s) => new Set(s).add(focused.code));
              setFocus(code);
            }}
          />
        </div>
      )}
    </div>
  );
}

function AddCategory({ parent, onCreated }: { parent: TreeNode; onCreated: (code: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState(suggestedKind(parent));
  const [error, setError] = useState<string>();
  if (!open)
    return (
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        style={{ marginTop: 8 }}
        onClick={() => {
          setKind(suggestedKind(parent));
          setOpen(true);
        }}
      >
        + Add a category under {parent.name}
      </button>
    );
  return (
    <div className="inline-form">
      <div className="form-grid">
        <label className="field">
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Table Tennis" />
        </label>
        <label className="field">
          It is a…
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            {CATEGORY_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label} – {k.hint}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="small muted">
        Will appear as <Crumbs path={[...parent.path, name.trim() || '…']} />
      </p>
      {error && <p className="field-error">{error}</p>}
      <div className="row gap">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={name.trim().length < 2}
          onClick={async () => {
            try {
              const r = await api<{ code: string }>('/admin/catalog/categories', {
                method: 'POST',
                body: { parentCode: parent.code, name: name.trim(), kind },
              });
              setOpen(false);
              setName('');
              setError(undefined);
              await onCreated(r.code);
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          Add category
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
