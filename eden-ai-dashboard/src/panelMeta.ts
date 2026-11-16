// The project tools (the bottom bar's project tabs) and the general panels, with the same names and icons as the
// bottom bar. On a phone each opens as a full-screen sheet (MobilePanel.tsx).
import { Footprints, Hammer, Wrench, Eye, Workflow, Users, TrendingUp, Inbox, Activity, type LucideIcon } from 'lucide-react';
import type { ProjectPanelTarget } from './panel.ts';

export const PROJECT_PANELS: { id: ProjectPanelTarget; label: string; icon: LucideIcon }[] = [
  { id: 'trail', label: 'Trail', icon: Footprints },
  { id: 'roadmap', label: 'Roadmap', icon: Hammer },
  { id: 'toolbox', label: 'Toolbox', icon: Wrench },
  { id: 'preview', label: 'Preview', icon: Eye },
  { id: 'flow', label: 'Flow', icon: Workflow },
  { id: 'workload', label: 'Workload', icon: Users },
  { id: 'progress', label: 'Progress', icon: TrendingUp },
];

export const GENERAL_PANELS: { id: 'review' | 'activity'; label: string; icon: LucideIcon }[] = [
  { id: 'review', label: 'Review', icon: Inbox },
  { id: 'activity', label: 'Activity', icon: Activity },
];
