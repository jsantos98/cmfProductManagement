// Left sidebar: Home, one group per area (Backlog / To validate with badges), Settings; health + theme in the footer.
import type { BacklogDef, HealthResponse } from '../../../server/src/types';
import { THEMES, useTheme } from './theme';

export type NavTarget = { kind: 'home' } | { kind: 'settings' } | { kind: 'area'; id: string; view: 'backlog' | 'validate' };

interface Props {
  backlogs: BacklogDef[];
  current: NavTarget;
  go: (t: NavTarget) => void;
  /** pending-edit count per backlog */
  pending: (id: string) => number;
  /** comments waiting for me per backlog (backlog + to validate) */
  waiting: (id: string) => number;
  /** items to validate per backlog (undefined = unknown) */
  toValidate: (id: string) => number | undefined;
  /** comments waiting on the To validate list */
  validateWaiting: (id: string) => number;
  health: HealthResponse | null;
  healthErr: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const href = (t: NavTarget) =>
  t.kind === 'home' ? '#/' : t.kind === 'settings' ? '#/settings' : `#/b/${encodeURIComponent(t.id)}${t.view === 'validate' ? '/validate' : ''}`;
const same = (a: NavTarget, b: NavTarget) =>
  a.kind === b.kind && (a.kind !== 'area' || (b.kind === 'area' && a.id === b.id && a.view === b.view));

function Health({ h, err }: { h: HealthResponse | null; err: string | null }) {
  let color = '#9aa3b2';
  let text = 'checking…';
  let tip = '';
  if (err) {
    color = 'var(--bad)';
    text = 'API unreachable';
    tip = err;
  } else if (h) {
    const bad = [!h.patPresent && 'PAT missing', !h.caConfigured && 'CA missing', !h.tfsReachable && 'TFS unreachable'].filter(Boolean) as string[];
    if (bad.length) {
      color = 'var(--bad)';
      text = bad.join(' · ');
      tip = h.error ?? '';
    } else {
      color = 'var(--ok)';
      text = (h.identity ?? 'connected').replace(/\s*<.*$/, '');
      tip = `Connected to TFS as ${h.identity ?? '?'}`;
    }
  }
  return (
    <div className="ui-health" title={tip || text}>
      <span className="dot" style={{ background: color }} />
      <b>{text}</b>
    </div>
  );
}

export default function Sidebar(p: Props) {
  const [theme, setTheme] = useTheme();
  const link = (t: NavTarget, icon: string, label: string, extra?: React.ReactNode, sub = false, title?: string) => {
    const on = same(t, p.current);
    return (
      <a
        key={href(t)}
        href={href(t)}
        className={'ui-nav-link' + (sub ? ' sub' : '') + (on ? ' active' : '')}
        aria-current={on ? 'page' : undefined}
        title={p.collapsed ? title ?? label : title}
        onClick={(e) => {
          e.preventDefault();
          p.go(t);
        }}
      >
        <span className="ui-nav-icon" aria-hidden>
          {icon}
        </span>
        <span className="ui-nav-label">{label}</span>
        {extra && <span className="ui-nav-badges">{extra}</span>}
      </a>
    );
  };

  return (
    <aside className="ui-sidebar" aria-label="Main navigation">
      <div className="ui-brand">
        <span className="ui-brand-mark" aria-hidden>
          PM
        </span>
        <span className="ui-brand-text">
          PM Cockpit
          <span className="ui-brand-sub">Connect IoT</span>
        </span>
      </div>
      <nav className="ui-nav">
        {link({ kind: 'home' }, '⌂', 'Home')}
        <div className="ui-nav-section">Areas</div>
        {p.backlogs.map((b) => {
          const pend = p.pending(b.id);
          const w = p.waiting(b.id);
          const v = p.toValidate(b.id);
          const vw = p.validateWaiting(b.id);
          return (
            <div key={b.id}>
              <div className="ui-nav-area" title={b.name}>
                <span className="dot" style={{ background: b.color }} />
                <span>{b.name}</span>
              </div>
              {link(
                { kind: 'area', id: b.id, view: 'backlog' },
                '☰',
                'Backlog',
                <>
                  {pend > 0 && (
                    <span className="ui-nav-count pending" title={`${pend} item(s) with pending edits`}>
                      {pend}
                    </span>
                  )}
                  {w - vw > 0 && (
                    <span className="ui-nav-count comments" title="Comments waiting for you">
                      💬{w - vw}
                    </span>
                  )}
                </>,
                true,
                `${b.name} · Backlog`,
              )}
              {link(
                { kind: 'area', id: b.id, view: 'validate' },
                '✓',
                'To validate',
                <>
                  {vw > 0 && (
                    <span className="ui-nav-count comments" title="Comments waiting for you">
                      💬{vw}
                    </span>
                  )}
                  {v !== undefined && v > 0 && (
                    <span className="ui-nav-count validate" title={`${v} item(s) to validate`}>
                      {v}
                    </span>
                  )}
                </>,
                true,
                `${b.name} · To validate`,
              )}
            </div>
          );
        })}
        <div className="grow" />
        {link({ kind: 'settings' }, '⚙', 'Settings')}
      </nav>
      <div className="ui-sidebar-foot">
        <Health h={p.health} err={p.healthErr} />
        <div className="ui-theme-switch" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={theme === t.id} className={theme === t.id ? 'on' : ''} title={t.hint} onClick={() => setTheme(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
        <div className="ui-sidebar-actions">
          <button onClick={p.onToggleCollapsed} title={p.collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label={p.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            {p.collapsed ? '»' : '« Collapse'}
          </button>
        </div>
      </div>
    </aside>
  );
}
