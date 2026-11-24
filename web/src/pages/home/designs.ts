import type { ComponentType } from 'react';
import type { DesignProps } from './kit';
import DesignInbox from './DesignInbox';
import DesignDashboard from './DesignDashboard';
import DesignBoard from './DesignBoard';
import DesignBriefing from './DesignBriefing';

/** Home page design prototypes. 'classic' is the original card grid in HomePage.tsx. */
export const DESIGNS: { id: string; name: string; hint: string; component: ComponentType<DesignProps> | null }[] = [
  { id: 'classic', name: 'Classic', hint: 'Card grid (current)', component: null },
  { id: 'inbox', name: 'A · Inbox', hint: 'One prioritised action list with a section sidebar', component: DesignInbox },
  { id: 'dashboard', name: 'B · Dashboard', hint: 'KPI tiles on top, drill-down list and detail below', component: DesignDashboard },
  { id: 'board', name: 'C · Board', hint: 'Kanban-style columns of things to do', component: DesignBoard },
  { id: 'briefing', name: 'D · Briefing', hint: 'Morning brief: narrative summary, calm editorial layout', component: DesignBriefing },
];
