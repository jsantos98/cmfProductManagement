import { describe, expect, it } from 'vitest';
import { closeReasonsFor, emailOf, existingWorkItems, reachable, textToHtml, ticketStateModels } from '../src/portal/actions.js';
import { detailsFromOutput, refResolver } from '../src/portal/requests.js';

describe('textToHtml', () => {
  it('escapes and turns blank lines into paragraphs, single newlines into <br>', () => {
    expect(textToHtml('Hi <b>all</b> & co\nline 2\n\n\nNext')).toBe('<p>Hi &lt;b&gt;all&lt;/b&gt; &amp; co<br>line 2</p><p>Next</p>');
    expect(textToHtml('\r\n  one\r\ntwo  \r\n')).toBe('<p>one<br>two</p>');
  });
});

describe('emailOf', () => {
  it('extracts the address', () => {
    expect(emailOf('Rainer Burmann <rainer@bbraun.com>')).toBe('rainer@bbraun.com');
    expect(emailOf(' x@y.com ')).toBe('x@y.com');
  });
});

describe('refResolver', () => {
  it('resolves $ref to the object with that $id', () => {
    const open = { $id: '5', Name: 'Open' };
    const root = { a: open, b: { $ref: '5' } };
    const d = refResolver(root);
    expect(d(root.b)).toBe(open);
    expect(d(open)).toBe(open);
    expect(d(null)).toBeNull();
  });
});

const entityTypes = {
  EntityTypeCollection: [
    { $id: '1', Name: 'Material' },
    {
      $id: '2', Name: 'Ticket',
      StateModels: [{
        $id: '3', Name: 'TicketEnhancementStateModel',
        States: [{ $id: '4', Id: '6', Name: 'Open' }, { $id: '5', Id: '7', Name: 'Assessed' }, { $id: '6', Id: '8', Name: 'Resolved' }, { $id: '7', Id: '9', Name: 'Closed' }],
        StateTransitions: [
          { FromState: { $ref: '4' }, ToState: { $ref: '5' } },
          { FromState: { $ref: '4' }, ToState: { $ref: '7' }, ReasonDefaultValue: 'Open by mistake' },
          { FromState: { $ref: '5' }, ToState: { $ref: '6' } },
          { FromState: { $ref: '6' }, ToState: { $ref: '7' } },
          { FromState: { $ref: '4' }, ToState: { $ref: '4' } },
        ],
      }],
    },
  ],
};

describe('ticketStateModels / reachable', () => {
  const m = ticketStateModels(entityTypes).get('TicketEnhancementStateModel')!;
  it('reads states and $ref transitions', () => {
    expect(m.states.map((s) => `${s.name}=${s.id}`)).toEqual(['Open=6', 'Assessed=7', 'Resolved=8', 'Closed=9']);
    expect(m.transitions[1]).toEqual({ from: 'Open', to: 'Closed', reasonDefault: 'Open by mistake' });
  });
  it('lists reachable states without self-transitions', () => {
    expect(reachable(m, 'Open')).toEqual(['Assessed', 'Closed']);
    expect(reachable(m, 'Assessed')).toEqual(['Resolved']);
    expect(reachable(m, 'Closed')).toEqual([]);
  });
});

describe('closeReasonsFor', () => {
  const values = [
    { Value: 'Other', Description: 'Reason to open the ticket is not listed' },
    { Value: 'Answered', Description: 'A satisfactory answer has been provided[Question]' },
    { Value: 'Fixed', Description: 'A correction was provided[Bug]' },
    { Value: 'Roadmap', Description: 'The enhancement has been added to the product roadmap[ER]' },
    { Value: 'Automatically Closed', Description: 'Ticket automatically closed by the system' },
  ];
  it('keeps untagged reasons and those of the request type, minus the automatic one', () => {
    expect(closeReasonsFor(values, 'Enhancement Request')).toEqual([
      { value: 'Other', description: 'Reason to open the ticket is not listed' },
      { value: 'Roadmap', description: 'The enhancement has been added to the product roadmap' },
    ]);
    expect(closeReasonsFor(values, 'Bug').map((r) => r.value)).toEqual(['Other', 'Fixed']);
  });
});

describe('existingWorkItems', () => {
  it('reads TicketWorkItem relations, resolving $refs', () => {
    const wi = { $id: '9', WId: '66156', Collection: 'Product', Project: 'Product' };
    const o = {
      Ticket: {
        RelationCollection: { CMFMapData: [['TicketWorkItem', [{ TargetEntity: wi }, { TargetEntity: { $ref: '9' } }, { TargetEntity: { WId: '' } }]], ['TicketTag', []]] },
      },
    };
    expect(existingWorkItems(o.Ticket, refResolver(o))).toEqual([
      { wid: '66156', collection: 'Product', project: 'Product' },
      { wid: '66156', collection: 'Product', project: 'Product' },
    ]);
    expect(existingWorkItems({})).toEqual([]);
  });
});

describe('detailsFromOutput with $refs', () => {
  it('resolves the site customer and the owner', () => {
    const o = {
      $id: '1',
      Ticket: {
        $id: '2', Id: '1000000001',
        Site: { $id: '3', Name: 'Site A', Customer: { $id: '4', Name: 'ACME' } },
        Owner: { $id: '5', Name: 'Agent X' },
        CurrentMainState: { $id: '6', CurrentState: { $id: '7', Name: 'Assessed' }, StateModel: { $id: '8', Name: 'M' } },
      },
      Other: { Site: { $ref: '3' } },
    };
    const d = detailsFromOutput(o, { baseUrl: 'https://p', keywords: [] }, false);
    expect(d.ticket).toMatchObject({ customer: 'ACME', site: 'Site A', agent: 'Agent X', state: 'Assessed' });
    expect(d.stateModel).toBe('M');
  });
});
