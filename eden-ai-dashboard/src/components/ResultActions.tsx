// Copy and Download for a finished result (in Review and on a card).
// The download is plain Markdown text, which Word, Google Docs and Notepad all open.
import React, { useState } from 'react';
import { Copy, Download, Check } from 'lucide-react';

export async function copyText(text: string): Promise<boolean> {
  // The older way first: it works straight away inside the tap or click, on any kind of page. (Phones and tablets
  // open the hub over plain http, where the newer clipboard isn't available, and some app windows refuse it.)
  try {
    const before = document.activeElement as HTMLElement | null;
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', ''); // so a phone doesn't pop its keyboard up
    box.style.position = 'fixed';
    box.style.top = '0';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(box);
    before?.focus?.();
    if (ok) return true;
  } catch {}
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  return false;
}

export const ResultActions: React.FC<{ title: string; text: string; meta?: string }> = ({ title, text, meta }) => {
  const [state, setState] = useState<'' | 'copied' | 'failed'>('');
  const button = 'flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800';

  const copy = async () => {
    setState((await copyText(text)) ? 'copied' : 'failed');
    setTimeout(() => setState(''), 2000);
  };

  const download = () => {
    const body = `# ${title}\n\n${meta ? `*${meta}*\n\n` : ''}${text.trim()}\n`;
    const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'result'}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button type="button" onClick={copy} className={button}>
        {state === 'copied' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
        {state === 'copied' ? 'Copied' : state === 'failed' ? "Couldn't copy" : 'Copy'}
      </button>
      <button type="button" onClick={download} title="Saves a .md text file that Word and Google Docs can open" className={button}>
        <Download className="h-3.5 w-3.5" /> Download
      </button>
    </span>
  );
};
