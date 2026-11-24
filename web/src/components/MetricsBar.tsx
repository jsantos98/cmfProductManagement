import type { Band, CountEntry, MetricsResponse } from '../../../server/src/types';
import { Skeleton, Tile, Tiles, TilesSep } from '../ui/kit';

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

/** KPI tiles of the Backlog page; clicking a tile toggles the matching filter (active filters show as chips in the filter bar). */
export default function MetricsBar({ metrics, bands, filters, colSel, onToggleCol, nextTag, nextCount, waitingCount, onChange }: Props) {
  if (!metrics) {
    return (
      <Tiles>
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} width={120} height={52} />
        ))}
      </Tiles>
    );
  }
  const colorOf = (label: string) => bands.find((b) => b.label === label)?.color ?? '#9e9e9e';
  const only = (sel: string[] | null, v: string) => !!sel && sel.length === 1 && sel[0] === v;

  const toggle = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    const next: Filters = { ...filters };
    if (next[k] === v) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const nrSub = metrics.notReviewed.byType.filter((c) => c.count > 0).map((c) => `${c.key}: ${c.count}`).join(' · ');

  return (
    <Tiles>
      {TYPES.map((t) => (
        <Tile
          key={t}
          compact
          label={<span className={typeClass(t)}>{t}</span>}
          value={count(metrics.byType, t)}
          active={only(colSel.type, t)}
          onClick={() => onToggleCol('type', t)}
          title={`Filter by type ${t}`}
        />
      ))}
      <TilesSep />
      <Tile
        label="Not reviewed (-1)"
        value={metrics.notReviewed.total}
        sub={nrSub}
        active={!!filters.notReviewed}
        onClick={() => toggle('notReviewed', true)}
        title={'BusinessOrder = -1\nClick to filter'}
      />
      {!!waitingCount && waitingCount > 0 && (
        <Tile
          label="💬 Waiting for me"
          value={waitingCount}
          tone="warn"
          active={!!filters.waiting}
          onClick={() => toggle('waiting', true)}
          title={'Comments by others that @mention you, newer than your last comment\nClick to filter'}
        />
      )}
      <TilesSep />
      {metrics.byBand.map((b) => (
        <Tile
          key={b.key}
          compact
          label={b.key}
          value={b.count}
          color={colorOf(b.key)}
          active={only(colSel.band, b.key)}
          onClick={() => onToggleCol('band', b.key)}
          title={`${b.key}: ${bandRange(bands.find((x) => x.label === b.key))}\nClick to filter`}
        />
      ))}
      <TilesSep />
      <Tile
        label={`Next version ${nextTag}`}
        value={nextCount}
        active={!!filters.nextVersion}
        onClick={() => toggle('nextVersion', true)}
        title="Items tagged with the selected next version"
      />
    </Tiles>
  );
}
