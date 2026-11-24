import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  articlesOf, detailsFromOutput, matchKeywords, mergePinned, plain, readStore, rowFromList, setDismissed, setPin, setPinsPath, suggestionsOf, validTicketId,
} from '../src/portal/requests.js';

const CFG = { baseUrl: 'https://portal.example', keywords: ['IoT', 'Connect IoT', 'OPC UA', 'OPC', 'driver', 'GEM'] };

const listRow = (o: Record<string, unknown> = {}) => ({
  id: '2504250000020000005', title: 'OPC UA Browsing', body: '<p>Browse the OPC UA server</p>', priority: 'P3 - Medium', state: 'Open',
  status: 'New', customerName: 'B. Braun', siteName: 'B. Braun Template', context: 'MES 11.1.3', userName: 'Rainer',
  escalationStateModelStateRoleName: 'PortfolioManagementTeam', numberOfReplies: 4, numberOfWorkItems: 1,
  createdOn: '2025-04-25T15:03:21Z', modifiedOn: '2026-11-18T13:20:30Z', sLADueDate: '2026-05-27T09:00:00Z', lastReplyOn: '2026-11-18T13:20:30Z',
  ...o,
});

describe('matchKeywords', () => {
  it('matches whole words and phrases, case-insensitively, in config order', () => {
    expect(matchKeywords('[ConnectIoT] new iot task for the OPC UA driver', CFG.keywords)).toEqual(['IoT', 'OPC UA', 'OPC', 'driver']);
  });
  it('does not match inside other words', () => {
    expect(matchKeywords('Agemo drivers geometry', CFG.keywords)).toEqual([]);
    expect(matchKeywords('Biot ratio', CFG.keywords)).toEqual([]);
  });
  it('ignores blank and duplicate keywords', () => {
    expect(matchKeywords('IoT', ['IoT', ' ', 'IoT'])).toEqual(['IoT']);
  });
});

describe('plain', () => {
  it('strips tags and decodes common entities', () => {
    expect(plain('<p>a&nbsp;&amp;<b>b</b></p>\n c')).toBe('a & b c');
  });
});

describe('rowFromList', () => {
  it('maps the list fields and the portal url', () => {
    const r = rowFromList(listRow(), CFG, true);
    expect(r).toMatchObject({
      id: '2504250000020000005', customer: 'B. Braun', site: 'B. Braun Template', context: 'MES 11.1.3', requester: 'Rainer',
      ownerRole: 'PortfolioManagementTeam', replies: 4, workItems: 1, pinned: true, agent: '',
      lastReplyRole: null, waitingForSupport: null, url: 'https://portal.example/Entity/Ticket/2504250000020000005',
    });
    expect(r.matches).toEqual(['OPC UA', 'OPC']);
  });
});

const detailsOutput = {
  Ticket: {
    Id: '2504250000020000005', Title: 'OPC UA Browsing', Priority: 'P3 - Medium', State: 'Open', Status: 'New',
    CurrentMainState: { CurrentState: { Name: 'Open' }, StateModel: { Name: 'TicketEnhancementStateModel' } },
    Site: { Name: 'B. Braun Template', Customer: {} }, TicketContext: { Name: 'MES 11.1.3' }, User: { User: { Name: 'Rainer' } },
    EscalationStateModelStateRoleName: 'PortfolioManagementTeam', CreatedBy: 'R@X', CreatedOn: '2025-04-25T15:03:21Z',
    SLAStartDate: '2025-04-28T09:00:00Z', SLADueDate: '2026-05-27T09:00:00Z',
    LastReplyBy: 'R@X', LastReplyRole: 'Customer', LastReplyOn: '2026-11-18T13:20:30Z', WaitingForSupport: true,
  },
  Articles: {
    Table: [
      { ArticleId: 'b', From: 'Agent <a@cm>', To: 'r@x', CreatedOn: '2025-05-01T00:00:00Z', Type: 'External', Body: '<p>reply</p>' },
      { ArticleId: 'a', From: 'Rainer <r@x>', To: 'cp@cm', CreatedOn: '2025-04-25T15:03:22Z', Type: 'Client', Body: '<p>Need IoT browsing</p>' },
    ],
    Table_Columns: [],
  },
};

describe('detailsFromOutput / articlesOf', () => {
  it('sorts the conversation oldest first', () => {
    expect(articlesOf(detailsOutput.Articles).map((a) => a.id)).toEqual(['a', 'b']);
    expect(articlesOf(undefined)).toEqual([]);
  });
  it('maps the details-only fields', () => {
    const d = detailsFromOutput(detailsOutput, CFG, false);
    expect(d.stateModel).toBe('TicketEnhancementStateModel');
    expect(d.slaStartDate).toBe('2025-04-28T09:00:00Z');
    expect(d.ticket).toMatchObject({ customer: '', site: 'B. Braun Template', requester: 'Rainer', lastReplyRole: 'Customer', waitingForSupport: true, replies: 1 });
    expect(d.ticket.matches).toEqual(['IoT', 'OPC UA', 'OPC']);
  });
});

describe('mergePinned', () => {
  it('keeps list values the details leave empty, and list counts', () => {
    const fromList = rowFromList(listRow(), CFG, true);
    const fromDetails = detailsFromOutput(detailsOutput, CFG, true).ticket;
    const m = mergePinned(fromDetails, fromList);
    expect(m).toMatchObject({ customer: 'B. Braun', replies: 4, workItems: 1, lastReplyRole: 'Customer', waitingForSupport: true });
    expect(m.matches).toEqual(['OPC UA', 'OPC']);
    expect(mergePinned(fromDetails, undefined)).toBe(fromDetails);
  });
});

describe('suggestionsOf', () => {
  const rows = [
    rowFromList(listRow({ id: '1000000001', createdOn: '2025-01-01T00:00:00Z' }), CFG, false),
    rowFromList(listRow({ id: '1000000002', createdOn: '2026-01-01T00:00:00Z' }), CFG, false),
    rowFromList(listRow({ id: '1000000003', title: 'Reports', body: 'nothing relevant' }), CFG, false),
    rowFromList(listRow({ id: '1000000004', escalationStateModelStateRoleName: 'SMART - Agents' }), CFG, false),
    rowFromList(listRow({ id: '1000000005' }), CFG, false),
    rowFromList(listRow({ id: '1000000006' }), CFG, false),
  ];
  it('keeps matching rows of the role, minus pins and dismissals, newest first', () => {
    const s = suggestionsOf(rows, 'PortfolioManagementTeam', new Set(['1000000005']), new Set(['1000000006']));
    expect(s.map((r) => r.id)).toEqual(['1000000002', '1000000001']);
  });
  it('an empty role means any role', () => {
    expect(suggestionsOf(rows, '', new Set(), new Set()).map((r) => r.id)).toContain('1000000004');
  });
});

describe('pin store', () => {
  it('pins, dismisses (which unpins) and undoes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmfpm-pins-'));
    setPinsPath(path.join(dir, 'pins.json'));
    expect(readStore()).toEqual({ pins: {}, dismissed: {} });
    setPin('1000000001', true);
    expect(Object.keys(readStore().pins)).toEqual(['1000000001']);
    setDismissed('1000000001', true);
    expect(readStore()).toMatchObject({ pins: {}, dismissed: { '1000000001': expect.any(String) } });
    setPin('1000000001', true);
    expect(readStore().dismissed).toEqual({});
    setPin('1000000001', false);
    expect(readStore()).toEqual({ pins: {}, dismissed: {} });
  });
  it('validates ticket ids', () => {
    expect(validTicketId('2504250000020000005')).toBe(true);
    expect(validTicketId('../x')).toBe(false);
    expect(validTicketId('123')).toBe(false);
  });
});
