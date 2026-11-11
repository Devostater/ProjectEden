import React from 'react';
import { Sun, Moon } from 'lucide-react';
import type { AppTab } from './Sidebar.tsx';

export const TITLES: Record<AppTab, string> = {
  home: 'Dashboard',
  projects: 'Projects',
  nexus: 'Nexus',
  chat: 'Chat',
  'my-ai': 'Team',
  pipelines: 'Workflows',
  files: 'Files',
  updates: 'Code updates',
  devices: 'Devices',
  remote: 'Remote',
  settings: 'Connect',
};

interface HeaderProps {
  activeTab: AppTab;
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, darkMode, setDarkMode }) => (
  <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
    <span className="text-sm font-bold text-slate-900 dark:text-white">{TITLES[activeTab]}</span>
    <button
      onClick={() => setDarkMode(!darkMode)}
      aria-label="Toggle light or dark theme"
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
    >
      {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  </header>
);
