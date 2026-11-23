import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { childIds, toComments, toItemDetails } from '../src/backlog/details.js';
import type { AppConfig } from '../src/types.js';

const cfg = JSON.parse(readFileSync(new URL('../../config/default.json', import.meta.url), 'utf8')) as AppConfig;

const raw = {
  id: 10, rev: 4,
  fields: {
    'System.WorkItemType': 'Bug', 'System.Title': 'Broken', 'System.State': 'Active', 'System.Tags': 'IoT; 12.0x',
    'System.AssignedTo': { displayName: 'Joao' }, 'Custom.BusinessOrder': 50, 'System.Parent': 7,
    'System.CreatedBy': { displayName: 'Ana' }, 'System.CreatedDate': '2026-01-01T00:00:00Z',
    'System.ChangedBy': 'Rui', 'System.ChangedDate': '2026-02-01T00:00:00Z',
    'Microsoft.VSTS.Common.Priority': 2, 'Microsoft.VSTS.Common.Severity': '2 - High', 'Custom.TargetVersion': '12.0.3',
    'Microsoft.VSTS.TCM.SystemInfo': '<p>sys</p>', 'System.Description': '<p>desc</p>',
    'Custom.Summary': '   ', 'Microsoft.VSTS.TCM.ReproSteps': '<ol><li>go</li></ol>',
  },
  relations: [
    { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://x/Products/_apis/wit/workItems/11' },
    { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://x/Products/_apis/wit/workItems/7' },
    { rel: 'AttachedFile', url: 'https://x/_apis/wit/attachments/abc' },
  ],
};

describe('toItemDetails', () => {
  const kids = [{ id: 11, rev: 1, fields: { 'System.WorkItemType': 'Task', 'System.Title': 'Kid', 'System.State': 'New' } }];
  const d = toItemDetails(raw, kids, toComments({ comments: [{ createdBy: { displayName: 'Zed' }, createdDate: 'd', text: '<b>hi</b>' }] }), cfg, 'Parent');

  it('orders sections and skips empty ones', () => {
    expect(d.sections.map(s => s.label)).toEqual(['Description', 'Repro steps', 'System info']);
    expect(d.sections[0].html).toBe('<p>desc</p>');
  });
  it('maps identities, scalars and summary item', () => {
    expect(d.createdBy).toBe('Ana');
    expect(d.changedBy).toBe('Rui');
    expect(d.priority).toBe(2);
    expect(d.targetVersion).toBe('12.0.3');
    expect(d.version).toBe('');
    expect(d.item.parentTitle).toBe('Parent');
    expect(d.item.assignedTo).toBe('Joao');
  });
  it('maps children and comments', () => {
    expect(childIds(raw)).toEqual([11]);
    expect(d.children).toEqual([{ id: 11, type: 'Task', title: 'Kid', state: 'New' }]);
    expect(d.comments).toEqual([{ author: 'Zed', date: 'd', html: '<b>hi</b>' }]);
  });
});
