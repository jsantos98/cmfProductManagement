import { useState } from 'react';
import type { BacklogDef } from '../../../server/src/types';
import ItemDetailsModal from '../components/ItemDetailsModal';
import { useHomeData } from './home/kit';
import DesignDashboard from './home/DesignDashboard';

interface Props {
  active: boolean;
  backlogs: BacklogDef[];
  /** called after Mark handled / Undo in the details (tab badges) */
  onAttentionChanged?: () => void;
  me?: string;
}

/** Home: the Dashboard design (KPI tiles, drill-down table, feature progress) on live data. */
export default function HomePage({ active, backlogs, onAttentionChanged, me }: Props) {
  const home = useHomeData(active);
  const [detail, setDetail] = useState<{ id: number; list: number[] } | null>(null);

  const step = (delta: -1 | 1) =>
    setDetail((d) => {
      if (!d) return d;
      const i = d.list.indexOf(d.id);
      const j = i + delta;
      return i < 0 || j < 0 || j >= d.list.length ? d : { ...d, id: d.list[j] };
    });

  return (
    <div className={'page home-design design-dashboard' + (active ? '' : ' hidden')}>
      <DesignDashboard
        data={home.data}
        backlogs={backlogs}
        open={(id, list) => setDetail({ id, list })}
        reload={(k, r) => void home.reload(k, r)}
        refreshAll={() => home.reloadAll(true)}
        loading={home.loading}
        me={me}
      />
      {detail && active && (
        <ItemDetailsModal
          id={detail.id}
          bands={[]}
          onClose={() => setDetail(null)}
          onOpen={(id) => setDetail((d) => ({ id, list: d?.list ?? [id] }))}
          onStep={step}
          onAttentionChanged={() => {
            onAttentionChanged?.();
            void home.reload('comments');
          }}
        />
      )}
    </div>
  );
}
