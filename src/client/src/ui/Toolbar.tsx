import { useState } from 'react';
import type { Mode } from '../core/workspace';
import type { StoreState, WorkspaceStore } from '../state/store';
import type { AppConfig } from '../services/api';
import type { FormatCommand } from '../editor/FormattedEditor';
import { formatCost } from './format';

interface Props {
  store: WorkspaceStore;
  state: StoreState;
  config: AppConfig | null;
  canFormat: boolean;
  onFormat(cmd: FormatCommand): void;
  onSwitchView(view: 'formatted' | 'markdown'): void;
}

const FORMATS: { cmd: FormatCommand; label: string; title: string; className?: string }[] = [
  { cmd: 'bold', label: 'B', title: 'Bold (Ctrl/Cmd+B)', className: 'b' },
  { cmd: 'italic', label: 'I', title: 'Italic (Ctrl/Cmd+I)', className: 'i' },
  { cmd: 'heading', label: 'H', title: 'Heading' },
  { cmd: 'bulletList', label: '•', title: 'Bulleted list' },
  { cmd: 'orderedList', label: '1.', title: 'Numbered list' },
  { cmd: 'blockquote', label: '❝', title: 'Quote' },
  { cmd: 'code', label: '</>', title: 'Inline code' },
];

export function spendSummary(state: StoreState) {
  let total = 0;
  let unknown = 0;
  for (const e of state.ledger) {
    if (e.charged === 'yes' && e.usage?.cost != null) total += e.usage.cost;
    else if (e.charged === 'unknown' && e.provider !== 'fake') unknown++;
  }
  return { total, unknown, count: state.ledger.length };
}

export function Toolbar({ store, state, config, canFormat, onFormat, onSwitchView }: Props) {
  const [open, setOpen] = useState(false);
  const busy = !!state.activeRequest;
  const spend = spendSummary(state);
  const modes: { mode: Mode; label: string }[] = [
    { mode: 'fast', label: 'Fast' },
    { mode: 'smart', label: 'Smart' },
  ];
  const info = (m: Mode) => config?.modes.find((x) => x.mode === m);

  return (
    <div className="toolbar" role="toolbar" aria-label="Editor toolbar">
      <div className="group" aria-label="Formatting">
        {FORMATS.map((f) => (
          <button
            key={f.cmd}
            type="button"
            className={`tool ${f.className ?? ''}`}
            title={canFormat ? f.title : 'Formatting buttons work in Formatted view'}
            aria-label={f.title}
            disabled={!canFormat}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onFormat(f.cmd)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="group" aria-label="History">
        <button type="button" className="tool" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo" disabled={!state.canUndo} onClick={() => store.undo()}>
          ↶
        </button>
        <button type="button" className="tool" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo" disabled={!state.canRedo} onClick={() => store.redo()}>
          ↷
        </button>
      </div>
      <div className="group segmented" role="radiogroup" aria-label="View">
        {(['formatted', 'markdown'] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={state.prefs.view === v} className={state.prefs.view === v ? 'on' : ''} onClick={() => onSwitchView(v)}>
            {v === 'formatted' ? 'Formatted' : 'Markdown'}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <div className="group segmented" role="radiogroup" aria-label="Model mode">
        {modes.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={state.prefs.mode === mode}
            className={state.prefs.mode === mode ? 'on' : ''}
            disabled={busy}
            title={busy ? 'Locked while a suggestion is generating' : `${label}: ${info(mode)?.model ?? 'model not configured'}`}
            onClick={() => store.setMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="spend-wrap">
        <button type="button" className="spend" aria-expanded={open} onClick={() => setOpen(!open)} title="Tracked spending and model details">
          {`$${spend.total.toFixed(4)}`}
          {spend.unknown > 0 && <span className="unknown"> +{spend.unknown} unknown</span>}
        </button>
        {open && <SpendPanel state={state} config={config} onClose={() => setOpen(false)} />}
      </div>
      <button
        type="button"
        className="tool"
        aria-pressed={state.prefs.muted}
        title={state.prefs.muted ? 'Sound off' : 'Sound on'}
        aria-label={state.prefs.muted ? 'Unmute pop sound' : 'Mute pop sound'}
        onClick={() => store.setPrefs({ muted: !state.prefs.muted })}
      >
        {state.prefs.muted ? '🔇' : '🔈'}
      </button>
    </div>
  );
}

function SpendPanel({ state, config, onClose }: { state: StoreState; config: AppConfig | null; onClose(): void }) {
  const spend = spendSummary(state);
  const recent = [...state.ledger].reverse().slice(0, 8);
  return (
    <div className="spend-panel" role="dialog" aria-label="Spending details">
      <button type="button" className="tiny close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      <h3>Models</h3>
      {config ? (
        <table>
          <tbody>
            {config.modes.map((m) => (
              <tr key={m.mode}>
                <th>{m.label}</th>
                <td>{m.model}</td>
                <td>
                  {m.inputPerMillion != null ? `$${m.inputPerMillion}/M in · $${m.outputPerMillion}/M out` : 'rates unknown'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Server unavailable.</p>
      )}
      {config && !config.keyConfigured && <p className="warn">The server has no OpenRouter key configured.</p>}
      <h3>Tracked spend</h3>
      <p>
        <strong>${spend.total.toFixed(4)}</strong> across {spend.count} {spend.count === 1 ? 'request' : 'requests'}
        {spend.unknown > 0 && `, ${spend.unknown} with unknown cost`}. Recorded in this browser for this app's requests; it is
        not your OpenRouter balance.
      </p>
      {recent.length > 0 && (
        <ul className="ledger">
          {recent.map((e) => (
            <li key={e.requestId}>
              <span>{new Date(e.at).toLocaleTimeString()}</span>
              <span>
                {e.mode} · {e.action}
              </span>
              <span>{e.status}</span>
              <span>{e.charged === 'yes' ? formatCost(e.usage?.cost ?? null) : e.provider === 'fake' ? 'fixture' : e.charged === 'no' ? 'not charged' : 'unknown'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
