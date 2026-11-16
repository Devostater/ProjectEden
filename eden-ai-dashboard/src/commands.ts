// Understands a spoken or typed command ("open devices", "pause the AI", "ask Atlas to plan the launch").
// Used by the mic and the command box in the top bar (VoiceCommands.tsx). Nothing here touches the page:
// parseCommand() only says what was meant, so it can be tested on its own.
import type { AppTab } from './components/Sidebar.tsx';
import type { PanelTarget } from './panel.ts';

export type Command =
  | { kind: 'page'; tab: AppTab }
  | { kind: 'account'; tab: 'account' | 'connections' | 'preferences' }
  | { kind: 'panel'; tab: PanelTarget }
  | { kind: 'project'; id: string; name: string }
  | { kind: 'talk'; agent: string } // open Chat addressed to this teammate
  | { kind: 'chat'; text: string } // send this to Chat
  | { kind: 'pause'; paused: boolean }
  | { kind: 'theme'; dark: boolean | 'toggle' }
  | { kind: 'new'; what: 'project' | 'teammate' | 'room' }
  | { kind: 'new-azi'; name: string } // "new project Star Courier": a C:\AZI folder + private GitHub repo
  | { kind: 'scroll'; to: 'up' | 'down' | 'top' | 'bottom' }
  | { kind: 'back' }
  | { kind: 'help' }
  | { kind: 'stop' };

export interface CommandContext {
  projects: { id: string; name: string }[];
  agents: { name: string }[];
  typed?: boolean; // typed commands are deliberate, so they're never ignored as "just talking"
}

// What you can say for each place. The longest match wins, so "code updates" beats "updates".
type Target = { kind: 'page'; tab: AppTab } | { kind: 'account'; tab: 'account' | 'connections' | 'preferences' } | { kind: 'panel'; tab: PanelTarget };
const PLACES: { to: Target; words: string[] }[] = [
  { to: { kind: 'page', tab: 'home' }, words: ['dashboard', 'dash board', 'home', 'overview', 'main page', 'home page'] },
  { to: { kind: 'page', tab: 'projects' }, words: ['projects', 'project', 'board', 'boards', 'cards', 'tasks', 'kanban'] },
  { to: { kind: 'page', tab: 'nexus' }, words: ['nexus', 'nexxus', 'nexis', 'next us', 'discussions', 'discussion', 'rooms'] },
  { to: { kind: 'page', tab: 'chat' }, words: ['chat', 'chats', 'conversation', 'conversations', 'messages'] },
  { to: { kind: 'page', tab: 'my-ai' }, words: ['team', 'my team', 'my ai', 'teammates', 'agents', 'ai team'] },
  { to: { kind: 'page', tab: 'pipelines' }, words: ['workflows', 'workflow', 'work flows', 'work flow', 'pipelines', 'pipeline'] },
  { to: { kind: 'page', tab: 'files' }, words: ['files', 'file', 'folders', 'documents'] },
  { to: { kind: 'page', tab: 'repos' }, words: ['github', 'git hub', 'repos', 'repositories', 'sync my pc', 'sync github'] },
  { to: { kind: 'page', tab: 'updates' }, words: ['code updates', 'code update', 'updates', 'update', 'code'] },
  { to: { kind: 'page', tab: 'devices' }, words: ['devices', 'device', 'tablet', 'phone', 'phones', 'this pc', 'my pc', 'computer'] },
  { to: { kind: 'page', tab: 'remote' }, words: ['remote', 'remote connection', 'pairing', 'pair', 'qr code'] },
  { to: { kind: 'account', tab: 'account' }, words: ['account', 'my account', 'profile'] },
  { to: { kind: 'account', tab: 'connections' }, words: ['connections', 'connection', 'connect', 'keys', 'api keys', 'offline mode', 'knowledge base', 'backups'] },
  { to: { kind: 'account', tab: 'preferences' }, words: ['preferences', 'settings', 'options'] },
  { to: { kind: 'panel', tab: 'review' }, words: ['review', 'reviews', 'review inbox', 'inbox', 'needs me', 'waiting for me'] },
  { to: { kind: 'panel', tab: 'activity' }, words: ['activity', 'activity log', 'log', 'what happened'] },
  { to: { kind: 'panel', tab: 'terminal' }, words: ['terminal', 'command line', 'console'] },
  { to: { kind: 'panel', tab: 'lyra' }, words: ['lyra', 'lira', 'leera', 'lyra panel'] },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// "Eden, …" is optional. Speech recognition often hears it as one of these.
const WAKE = /^(?:(?:hey|ok|okay|hi) )?(?:eden|eaton|edin|eatin|aiden)\b ?/;
const POLITE = /^(?:(?:please|can you|could you|would you|will you|i want to|i want|id like to|i would like to|lets|let us|now) )+/;
const TAIL = / (?:please|now|for me|thanks|thank you)$/;
// Words that mean "take me there".
const VERB = /^(?:open up|open|go to|go|show me|show|display|switch to|take me to|bring up|pull up|navigate to|jump to|view|see|load|visit) /;
const FILLER = new Set(['the', 'my', 'a', 'an', 'page', 'tab', 'screen', 'view', 'panel', 'to', 'up', 'section']);

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

// The place named in `text`, by an exact phrase (the longest wins). `len` is how much of the text it accounts for.
function exactPlace(text: string): { to: Target; len: number } | null {
  const padded = ` ${text} `;
  let best: { to: Target; len: number } | null = null;
  for (const p of PLACES) for (const w of p.words) if (padded.includes(` ${w} `) && (!best || w.length > best.len)) best = { to: p.to, len: w.length };
  return best;
}

// A near miss on a single word: "devises" -> devices, "nexis" -> nexus.
function nearPlace(text: string): Target | null {
  let near: { to: Target; d: number } | null = null;
  for (const word of text.split(' ')) {
    if (word.length < 4) continue;
    for (const p of PLACES)
      for (const w of p.words) {
        if (w.includes(' ') || w.length < 5) continue;
        const d = distance(word, w);
        if (d <= (w.length >= 8 ? 2 : 1) && (!near || d < near.d)) near = { to: p.to, d };
      }
  }
  return near?.to ?? null;
}

const firstName = (name: string) => norm(name).split(' ')[0] || '';

export function parseCommand(said: string, ctx: CommandContext): Command | null {
  let t = norm(said);
  if (!t) return null;
  const woke = WAKE.test(t);
  t = t.replace(WAKE, '').replace(POLITE, '').replace(TAIL, '').trim();
  if (!t) return null;

  // ---- things to do --------------------------------------------------------------------------------
  if (/^(stop|stop listening|stop voice|mic off|microphone off|turn off the mic|thats all|goodbye|never mind|nevermind|cancel)$/.test(t)) return { kind: 'stop' };
  if (/^(help|what can i say|what can you do|commands|show commands|list commands)$/.test(t)) return { kind: 'help' };
  if (/^pause$|^(pause|stop|hold)(?: the| my)? (ai team|ai|team|work|everything)$/.test(t)) return { kind: 'pause', paused: true };
  if (/^(resume|unpause|carry on)$|^(resume|unpause|continue|carry on|start)(?: the| my)? (ai team|ai|team|work|working)$/.test(t)) return { kind: 'pause', paused: false };
  if (/\b(dark mode|dark theme|go dark|lights off|night mode)\b/.test(t)) return { kind: 'theme', dark: true };
  if (/\b(light mode|light theme|go light|lights on|day mode)\b/.test(t)) return { kind: 'theme', dark: false };
  if (/^(switch|toggle|change|flip)(?: the)? theme$/.test(t)) return { kind: 'theme', dark: 'toggle' };
  if (/^(go )?back$|^previous( page)?$|^last page$/.test(t)) return { kind: 'back' };
  const scroll = t.match(/^(?:scroll|page|go|move) (down|up)$/) || t.match(/^(?:(?:scroll|go|jump) to )?(?:the )?(top|bottom)$/);
  if (scroll) return { kind: 'scroll', to: scroll[1] as 'up' | 'down' | 'top' | 'bottom' };
  if (/^(new|create|add|start|make)(?: a| an)?(?: new)? project$/.test(t)) return { kind: 'new', what: 'project' };
  // "new project Star Courier", "create a project called Star Courier", "new AZI project Star Courier", "new azi project".
  if (/^(new|create|start|make|set up)(?: a| an)?(?: new)? azi project$/.test(t)) return { kind: 'new-azi', name: '' };
  const named = t.match(/^(?:new|create|start|make|set up)(?: a| an)?(?: new)?(?: azi)? project(?: called| named| for)? (.+)$/);
  if (named) {
    // Keep the name as it was said or typed (capitals and all).
    const original = said.trim().replace(/^[\s\S]*?\bproject\b\s*(?:(?:called|named|for)\s+)?/i, '').replace(/[.!?]+$/, '').trim();
    return { kind: 'new-azi', name: original || named[1] };
  }
  if (/^(new|create|add|hire|make)(?: a| an)?(?: new)? (teammate|team member|agent|ai teammate)$/.test(t)) return { kind: 'new', what: 'teammate' };
  if (/^(new|create|add|start|make)(?: a| an)?(?: new)? (room|discussion|nexus room|nexus discussion)$/.test(t)) return { kind: 'new', what: 'room' };

  // ---- talking to the team ---------------------------------------------------------------------------
  const agentNamed = (word: string) => ctx.agents.find((a) => firstName(a.name) === word);
  const ask = t.match(/^(?:ask|tell) (.+)$/);
  if (ask) {
    const words = ask[1].split(' ');
    const agent = agentNamed(words[0]);
    const rest = (agent ? words.slice(1) : words).join(' ').replace(/^(?:to|that|about) /, '');
    // Keep the wording as it was said (capitals and all), minus the opening words.
    const original = said.trim().replace(/^[\s\S]*?\b(?:ask|tell)\b\s*/i, '');
    const body = agent ? original.replace(/^\S+\s*/, '').replace(/^(?:to|that)\s+/i, '') : original;
    if (!rest) return agent ? { kind: 'talk', agent: agent.name } : null;
    return { kind: 'chat', text: `${agent ? `@${agent.name.split(' ')[0]} ` : ''}${body || rest}` };
  }
  const talk = t.match(/^(?:talk to|chat with|message|speak to|speak with|call) (\w+)$/);
  if (talk && agentNamed(talk[1])) return { kind: 'talk', agent: agentNamed(talk[1])!.name };

  // ---- going somewhere -------------------------------------------------------------------------------
  const hasVerb = VERB.test(t);
  const target = t.replace(VERB, '').trim();
  const meaningful = target.split(' ').filter((w) => w && !FILLER.has(w));
  // Ordinary talk near the mic ("I think we should update the files tomorrow") shouldn't jump pages: a place is
  // only taken as a command when it was asked for ("open…", "Eden, …"), typed, or said more or less on its own.
  if (!(hasVerb || woke || ctx.typed || meaningful.length <= 3)) return null;
  const padded = ` ${target} `;

  // A project by its name ("Project Nova", "nova"), or by the words of its name that were said ("graphics",
  // "zz update check"), as long as no other project fits equally well. `len` is how much of the text it accounts for.
  const projectHit = (): { id: string; name: string; len: number } | null => {
    let best: { id: string; name: string; len: number } | null = null;
    for (const p of ctx.projects) {
      const full = norm(p.name);
      const short = full.replace(/^project /, '').replace(/ project$/, '');
      for (const n of new Set([full, short])) {
        if (n.length >= 3 && padded.includes(` ${n} `) && (!best || n.length > best.len)) best = { id: p.id, name: p.name, len: n.length };
      }
    }
    if (best) return best;
    const said = new Set(target.split(' '));
    const scored = ctx.projects
      .map((p) => ({ id: p.id, name: p.name, len: [...new Set(norm(p.name).split(' '))].filter((w) => w.length >= 3 && !/^projects?$/.test(w) && said.has(w)).reduce((n, w) => n + w.length, 0) }))
      .filter((p) => p.len > 0)
      .sort((a, b) => b.len - a.len);
    return scored.length && (scored.length === 1 || scored[0].len > scored[1].len) ? scored[0] : null;
  };
  const project = projectHit();
  // "project nova" names a project even though "project" alone is the Projects page.
  if (project && /\bprojects?\b/.test(target)) return { kind: 'project', id: project.id, name: project.name };

  // A page and a project can share a word ("update"): whichever accounts for more of what was said wins.
  const place = exactPlace(target);
  if (place && (!project || place.len >= project.len)) return place.to;
  if (project) return { kind: 'project', id: project.id, name: project.name };

  // A teammate's name on its own, or "open Atlas": open Chat addressed to them.
  const one = meaningful.length === 1 ? agentNamed(meaningful[0]) : undefined;
  if (one) return { kind: 'talk', agent: one.name };

  return meaningful.length <= 2 || hasVerb || woke || ctx.typed ? nearPlace(target) : null;
}

// Shown in the command box under "What you can say", with your own project and teammate names filled in.
export function examples(ctx: CommandContext): { title: string; lines: string[] }[] {
  const project = ctx.projects[0]?.name.replace(/^project /i, '') || 'Nova';
  const lead = ctx.agents[0]?.name.split(' ')[0] || 'Chief';
  const other = (ctx.agents[2] || ctx.agents[1] || ctx.agents[0])?.name.split(' ')[0] || 'Atlas';
  return [
    { title: 'Go to a page', lines: ['devices', 'open the team', 'show code updates', 'go back'] },
    { title: 'Open something', lines: ['review', 'activity', 'connections', `project ${project}`] },
    { title: 'Do something', lines: ['pause the AI', 'resume', 'dark mode', 'new project Star Courier'] },
    { title: 'Talk to the team', lines: [`ask ${lead} what should I do next`, `talk to ${other}`] },
  ];
}
