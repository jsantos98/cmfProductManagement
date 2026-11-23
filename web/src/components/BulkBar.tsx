import { useState } from 'react';

interface Props {
  selCount: number;
  canTags: boolean;
  canOrder: boolean;
  tagNames: string[];
  nextTag: string;
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
  onSetOrder: (n: number) => void;
  onNext: (on: boolean) => void;
}

export default function BulkBar(p: Props) {
  const [tag, setTag] = useState('');
  const [order, setOrder] = useState('');
  const none = p.selCount === 0;
  const orderNum = order.trim() === '' ? NaN : Number(order);
  return (
    <div className="bulkbar">
      <b>{p.selCount} selected</b>
      <input list="bulk-tags" placeholder="tag" value={tag} onChange={(e) => setTag(e.target.value)} />
      <datalist id="bulk-tags">
        {p.tagNames.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <button disabled={none || !tag.trim() || !p.canTags} onClick={() => p.onAddTag(tag)}>
        Add tag
      </button>
      <button disabled={none || !tag.trim() || !p.canTags} onClick={() => p.onRemoveTag(tag)}>
        Remove tag
      </button>
      <span className="sep" />
      <input
        type="number"
        className="narrow"
        placeholder="order"
        value={order}
        onChange={(e) => setOrder(e.target.value)}
      />
      <button disabled={none || Number.isNaN(orderNum) || !p.canOrder} onClick={() => p.onSetOrder(orderNum)}>
        Set BusinessOrder
      </button>
      <span className="sep" />
      <button disabled={none || !p.canTags} onClick={() => p.onNext(true)}>
        Mark {p.nextTag}
      </button>
      <button disabled={none || !p.canTags} onClick={() => p.onNext(false)}>
        Unmark {p.nextTag}
      </button>
    </div>
  );
}
