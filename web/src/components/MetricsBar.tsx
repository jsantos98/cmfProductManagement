import type { Band, CountEntry, MetricsResponse } from '../../../server/src/types';

export interface Filters {
  notReviewed?: boolean;
  nextVersion?: boolean;
  waiting?: boolean;
}

interface Props {
  metrics: MetricsResponse | null;
  bands: Band[];
  filters: Filters;
  /** current selection of the Type / Band column filters (single source of truth = the grid filter model) */
  colSel: { type: string[] | null; band: string[] | null };
  onToggleCol: (col: 'type' | 'band', value: string) => void;
  onClearAll: () => void;
  nextTag: string;
  nextCount: number;
  waitingCount?: number;
  onChange: (f: Filters) => void;
}

const TYPES = ['Epic', 'Feature', 'User Story', 'Bug'];
const typeClass = (t: string) => 'pill pill-' + t.toLowerCase().replace(/\s+/g, '-');
const count = (list: CountEntry[] | undefined, key: string) => list?.find((c) => c.key === key)?.count ?? 0;

/** Human-readable BusinessOrder range of a band (min/max inclusive, max null = open-ended). */
export function bandRange(b: Band | undefined): string {
  if (!b) return 'BusinessOrder empty or outside every band';
  if (b.max === null) return `BusinessOrder ≥ ${b.min}`;
  if (b.min === b.max) return `BusinessOrder = ${b.min}`;
  return `BusinessOrder ${b.min} – ${b.max}`;
}

export default function MetricsBar({ metrics, bands, filters, colSel, onToggleCol, onClearAll, nextTag, nextCount, waitingCount, onChange }: Props) {
  if (!metrics) return <div className="metrics muted">Loading metrics…</div>;
  const colorOf = (label: string) => bands.find((b) => b.label === label)?.color ?? '#9e9e9e';
  const only = (sel: string[] | null, v: string) => !!sel && sel.length === 1 && sel[0] === v;
  const anyActive = Object.values(filters).some(Boolean) || !!colSel.type || !!colSel.band;

  const toggle = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    const next: Filters = { ...filters };
    if (next[k] === v) delete next[k];
    else next[k] = v;
    onChange(next);
  };

  return (
    <div className="metrics">
      {TYPES.map((t) => (
        <button
          key={t}
          className={'card' + (only(colSel.type, t) ? ' active' : '')}
          onClick={() => onToggleCol('type', t)}
          title={`Filter by type ${t}`}
        >
          <span className={typeClass(t)}>{t}</span>
          <b>{count(metrics.byType, t)}</b>
        </button>
      ))}
      <span className="sep" />
      <button
        className={'card' + (filters.notReviewed ? ' active' : '')}
        onClick={() => toggle('notReviewed', true)}
        title={'BusinessOrder = -1\nClick to filter'}
      >
        <span>Not reviewed (-1)</span>
        <b>{metrics.notReviewed.total}</b>
        <small>
          {metrics.notReviewed.byType.filter((c) => c.count > 0).map((c) => `${c.key}: ${c.count}`).join(' · ')}
        </small>
      </button>
      {!!waitingCount && waitingCount > 0 && (
        <button
          className={'card waiting' + (filters.waiting ? ' active' : '')}
          onClick={() => toggle('waiting', true)}
          title={'Comments by others that @mention you, newer than your last comment\nClick to filter'}
        >
          <span>💬 Waiting for me</span>
          <b>{waitingCount}</b>
        </button>
      )}
      <span className="sep" />
      {metrics.byBand.map((b) => {
        const color = colorOf(b.key);
        const active = only(colSel.band, b.key);
        return (
          <button
            key={b.key}
            className={'card band' + (active ? ' active' : '')}
            style={{ borderTopColor: color, color: active ? '#fff' : undefined, background: active ? color : undefined }}
            onClick={() => onToggleCol('band', b.key)}
            title={`${b.key}: ${bandRange(bands.find((x) => x.label === b.key))}\nClick to filter`}
          >
            <span style={{ color: active ? '#fff' : color }}>{b.key}</span>
            <b>{b.count}</b>
          </button>
        );
      })}
      <span className="sep" />
      <button
        className={'card' + (filters.nextVersion ? ' active' : '')}
        onClick={() => toggle('nextVersion', true)}
        title="Items tagged with the selected next version"
      >
        <span>Next version {nextTag}</span>
        <b>{nextCount}</b>
      </button>
      {anyActive && (
        <button className="link-btn" onClick={onClearAll}>
          clear filters
        </button>
      )}
    </div>
  );
}
