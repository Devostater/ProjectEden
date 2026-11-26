// Shared look for Eden's pages: use these instead of writing new sizes, borders and colours by hand,
// so every page reads as the same app. (The UI overhaul moves older pages onto these step by step.)
export const ui = {
  card: 'rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900',
  section: 'rounded-xl border border-slate-200 p-3 dark:border-slate-800',
  label: 'mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400',
  field: 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white',
  btn: 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
  btnPrimary: 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40',
  chip: 'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
  empty: 'text-sm text-slate-500 dark:text-slate-400',
  warning: 'text-sm text-amber-700 dark:text-amber-300',
} as const;
