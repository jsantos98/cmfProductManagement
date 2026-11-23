import { describe, expect, it } from 'vitest';
import { blockingTag, componentNames, deriveComponent, withComponent } from '../src/shared/component.js';
import type { ComponentRule } from '../src/types.js';

const rules: ComponentRule[] = ['EasyForJunior', 'Monitor', 'Controller', 'Manager', 'Protocol', 'ATL', 'Gui', 'All']
  .map((c) => ({ match: c, component: c }));

describe('component helpers', () => {
  it('derives like the server (first substring match)', () => {
    expect(deriveComponent(['12.0x', 'ExtendableControllers', 'IoT', 'UX'], rules)).toBe('Controller');
    expect(deriveComponent(['IoT'], rules)).toBe('Unknown');
  });

  it('replaces the component tag and keeps the others', () => {
    expect(withComponent(['IoT', 'Manager', '12.1x'], 'ATL', rules)).toEqual(['IoT', '12.1x', 'ATL']);
    expect(deriveComponent(withComponent(['IoT', 'manager'], 'ATL', rules), rules)).toBe('ATL');
  });

  it('is a no-op when the target tag is already there (any casing)', () => {
    expect(withComponent(['atl', 'IoT'], 'ATL', rules)).toEqual(['atl', 'IoT']);
  });

  it('null target removes component tags only', () => {
    expect(withComponent(['IoT', 'Gui', 'Monitor'], null, rules)).toEqual(['IoT']);
  });

  it('adds a tag for a component that has no rule yet', () => {
    expect(withComponent(['IoT', 'Gui'], 'Simulator', rules)).toEqual(['IoT', 'Simulator']);
  });

  it('explains a tag that still wins through an earlier rule', () => {
    const tags = withComponent(['ExtendableControllers', 'Gui'], 'ATL', rules);
    expect(tags).toEqual(['ExtendableControllers', 'ATL']);
    expect(blockingTag(tags, 'ATL', rules)).toEqual({ tag: 'ExtendableControllers', component: 'Controller' });
    expect(blockingTag(['ATL'], 'ATL', rules)).toBeNull();
  });

  it('lists distinct component names in rule order', () => {
    expect(componentNames([...rules, { match: 'gui', component: 'GUI' }])).toEqual(rules.map((r) => r.component));
  });
});
