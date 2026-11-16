// Open one of the bottom panel's tabs from anywhere: the Dashboard's "Needs you" card, the top bar, voice commands.
// On a phone the bottom panel isn't shown, so the same request opens a full-screen sheet instead (MobilePanel.tsx).
export type PanelTarget = 'review' | 'activity' | 'lyra' | 'terminal';

export const OPEN_PANEL_EVENT = 'eden-open-panel';

export const openPanel = (tab: PanelTarget) => window.dispatchEvent(new CustomEvent<PanelTarget>(OPEN_PANEL_EVENT, { detail: tab }));

// The phone layout (bottom tab bar, no side bar or bottom panel) is used below this width.
export const isPhoneLayout = () => window.matchMedia('(max-width: 767px)').matches;
