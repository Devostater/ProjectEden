// What the AI is told at the start of every Code update. Kept apart from updates.ts so it can be tested.
//
// The AI works in a copy of the codebase: the folder it is started in. It must never be handed the real folder's
// path. A codebase added from the page used to be described as "a codebase in C:\...\Project", followed by "Only
// edit files inside this folder". Codex then edited the real folder instead of the copy, so its change skipped the
// checks, the review, the restore point and Undo, and the hub reported "the AI finished without changing anything".

export interface PromptCodebase {
  about: string;
  dir: string;
  protect: string[];
}

// The saved description without the real folder's path (codebases saved before this fix still carry it).
// "C:\Proj\src\a.ts" becomes "src\a.ts"; the folder on its own becomes "the current folder".
export function aboutForAI(cb: Pick<PromptCodebase, 'about' | 'dir'>): string {
  const parts = cb.dir.split(/[\\/]+/).filter(Boolean);
  if (!parts.length) return cb.about;
  const folder = parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]+');
  return cb.about
    .replace(new RegExp(`${folder}[\\\\/]+(?=[\\w.])`, 'gi'), '')
    .replace(new RegExp(`${folder}(?![\\w-])[\\\\/]*`, 'gi'), 'the current folder');
}

export function updateRules(cb: PromptCodebase): string {
  return `You are improving ${aboutForAI(cb)}
You are working in a copy of it: the folder you were started in. Make the change the owner asks for below, carefully and completely.
Rules:
- Only read and edit files inside the current folder, using paths relative to it. Never open or change this project anywhere else on this PC, even if you know where its real folder is: the hub copies your change there after the owner has reviewed it.
- Never touch: ${cb.protect.join(', ')}.
- Follow the existing code style. Keep wording plain for a non-technical owner.
- Keep it working: if you change something shared, update every place that uses it.
- You cannot run commands; the hub runs the checks after you finish.
- Finish with a short summary in plain language: what you changed, which files, and anything the owner should check.`;
}

// The description saved for a codebase added from the page. It names no folder: see the note at the top.
export const aboutNewCodebase = (name: string) => `"${name}", one of the owner's codebases.`;
