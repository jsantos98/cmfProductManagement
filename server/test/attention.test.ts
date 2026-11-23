import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ackAttention, mentionsPerson, readAcks, setAcksPath, unackAttention, waitingFor, type RawComment } from '../src/backlog/attention.js';

const ME = 'AAAA-1111';
const c = (by: string, date: string, mentions: string[] = [], text = 'hi', type = 'Person'): RawComment => ({
  text, createdDate: date, createdBy: { id: by, displayName: `User ${by}` },
  mentions: mentions.map(m => ({ artifactType: type, artifactId: m })),
});

describe('waitingFor', () => {
  it('counts a mention of me', () => {
    const r = waitingFor([c('x', '2026-01-02T00:00:00Z', [ME])], ME);
    expect(r).toMatchObject({ count: 1, lastAuthor: 'User x', lastDate: '2026-01-02T00:00:00Z' });
  });
  it('ignores mentions of others, WorkItem mentions and my own comments', () => {
    expect(waitingFor([c('x', '2026-01-02T00:00:00Z', ['other'])], ME)).toBeNull();
    expect(waitingFor([c('x', '2026-01-02T00:00:00Z', [ME], 'hi', 'WorkItem')], ME)).toBeNull();
    expect(waitingFor([c(ME, '2026-01-02T00:00:00Z', [ME])], ME)).toBeNull();
  });
  it('my later comment clears it; newer ones count again', () => {
    const list = [c('x', '2026-01-04T00:00:00Z', [ME]), c(ME, '2026-01-03T00:00:00Z'), c('y', '2026-01-02T00:00:00Z', [ME])];
    const r = waitingFor(list, ME);
    expect(r?.count).toBe(1);
    expect(r?.lastDate).toBe('2026-01-04T00:00:00Z');
    expect(waitingFor(list.slice(1), ME)).toBeNull();
  });
  it('ack newer than the comment clears, older does not', () => {
    const list = [c('x', '2026-01-02T00:00:00Z', [ME])];
    expect(waitingFor(list, ME, '2026-01-03T00:00:00Z')).toBeNull();
    expect(waitingFor(list, ME, '2026-01-01T00:00:00Z')?.count).toBe(1);
  });
  it('strips HTML, decodes entities and truncates', () => {
    const r = waitingFor([c('x', '2026-01-02T00:00:00Z', [ME], '<div>a&nbsp;&amp;  <b>b</b> &lt;c&gt; &quot;d&quot; &#39;e&#39;</div>')], ME);
    expect(r?.snippet).toBe('a & b <c> "d" \'e\'');
    const long = waitingFor([c('x', '2026-01-02T00:00:00Z', [ME], 'w'.repeat(300))], ME);
    expect(long?.snippet.length).toBe(140);
    expect(long?.snippet.endsWith('…')).toBe(true);
  });
  it('compares ids case-insensitively', () => {
    expect(waitingFor([c('x', '2026-01-02T00:00:00Z', [ME.toLowerCase()])], ME.toUpperCase())?.count).toBe(1);
    expect(waitingFor([c(ME.toLowerCase(), '2026-01-03T00:00:00Z'), c('x', '2026-01-02T00:00:00Z', [ME])], ME.toUpperCase())).toBeNull();
    expect(mentionsPerson({ mentions: [{ artifactType: 'person', artifactId: 'abc' }] }, 'ABC')).toBe(true);
  });
});

describe('ack store', () => {
  it('writes, reads and removes acks; tolerates a corrupt file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acks-'));
    const f = path.join(dir, 'sub', 'attention-acks.json');
    setAcksPath(f);
    expect(readAcks()).toEqual({});
    const at = ackAttention(42);
    expect(readAcks()).toEqual({ '42': at });
    unackAttention(42);
    expect(readAcks()).toEqual({});
    fs.writeFileSync(f, '{not json');
    expect(readAcks()).toEqual({});
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
