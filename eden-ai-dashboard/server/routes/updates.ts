import fs from 'fs';
import path from 'path';
import type { Express, Request } from 'express';
import { logActivity } from '../../activity';
import { holdForApply } from '../../control';
import { isOffline } from '../../offline';
import { mayManage, mayView } from '../../permissions';
import { cliSignedIn } from '../../providers';
import { applyWithRecovery } from '../../scripts/recover.mjs';
import { mayOverrideUpdateCheck, updateCheckIssue } from '../../updateReleaseGate';
import type { UpdateRouteServices, UpdateJob } from '../../updates';

const LOCKED = 'Code updates are only available on the computer running the hub.';

function isLocal(req: Request) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
function fromOwnPage(req: Request) {
  try {
    return !!req.headers.origin && new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function registerUpdateRoutes(app: Express, services: UpdateRouteServices) {
  const {
    jobs, codebases, findCodebase, uncommittedNow, runBackup, requestCodeUpdate, addCodebase,
    save, startRetry, git, repoRoot, patchPaths, saveRestorePoint, applyPatch, recheckAfter, restoreFromPoint, now,
    onApplied, appDir: APP_DIR, backupBranch: BACKUP_BRANCH,
  } = services;
  const guard = (req: Request) => (mayManage(req) ? '' : LOCKED);
  registerIdeaRoutes(app, guard, services);

  app.get('/api/backup', (req, res) => {
    if (!mayView(req)) return res.status(403).json({ error: LOCKED });
    res.json({ last: services.lastBackup, running: services.backingUp });
  });

  app.post('/api/backup', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied.replace('Code updates', 'Backups') });
    try {
      const b = runBackup(false);
      res.json({ ok: true, files: b.files, at: b.at, changed: b.changed });
    } catch (err: any) {
      res.status(500).json({ error: `The backup did not work. (${err.message})` });
    }
  });

  app.get('/api/updates', (req, res) => {
    if (!mayView(req)) return res.status(403).json({ error: LOCKED });
    // How long an update usually takes: the middle of the last 5 that ran to the end (8 minutes until there are any).
    const took = jobs
      .filter((j) => j.startedAt && j.finishedAt && !j.interrupted && !j.error)
      .slice(-5)
      .map((j) => new Date(j.finishedAt!).getTime() - new Date(j.startedAt!).getTime())
      .filter((ms) => ms > 0)
      .sort((a, b) => a - b);
    const estimateMs = took.length ? took[Math.floor(took.length / 2)] : 8 * 60 * 1000;
    res.json({
      estimateMs,
      jobs: [...jobs].reverse().map(({ diff, restore, ...rest }) => ({ ...rest, hasDiff: !!diff, hasRestorePoint: !!restore, codebaseName: findCodebase(rest.codebaseId)?.name || rest.codebaseId })),
      codebases: codebases.map((c) => {
        const ok = fs.existsSync(c.dir);
        return { id: c.id, name: c.name, dir: c.dir, check: c.check, restartHint: c.restartHint, unreal: c.unreal, ok, uncommitted: ok ? uncommittedNow(c) : undefined };
      }),
      busy: services.busy,
      claudeReady: cliSignedIn('anthropic'),
      codexReady: cliSignedIn('openai'),
      restartPending: services.restartPending,
      remote: !isLocal(req), // a paired device: the page asks before applying, so a stray tap can't change code
    });
  });

  app.get('/api/updates/:id/diff', (req, res) => {
    if (!mayView(req)) return res.status(403).json({ error: LOCKED });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Update not found.' });
    res.json({ diff: job.diff || '' });
  });

  app.post('/api/updates', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const request = typeof req.body?.request === 'string' ? req.body.request.trim().slice(0, 4000) : '';
    if (!request) return res.status(400).json({ error: 'Describe what you want changed.' });
    try {
      const id = requestCodeUpdate(String(req.body?.codebaseId || 'hub'), request, typeof req.body?.cardId === 'string' ? req.body.cardId : undefined, req.body?.local === true, {
        codex: req.body?.codex === true,
        allowUnrealChanges: req.body?.allowUnrealChanges === true,
      });
      res.json({ job: { id }, uncommitted: jobs.find((j) => j.id === id)?.uncommitted });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Add a codebase: any folder inside a git repository.
  app.post('/api/codebases', (req, res) => {
    // Choosing a folder on this PC for the AI to change: only from the PC itself.
    if (!isLocal(req) || !fromOwnPage(req)) return res.status(403).json({ error: 'A codebase can only be added from the hub on this computer.' });
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    const dir = typeof req.body?.dir === 'string' ? req.body.dir : '';
    if (name && codebases.some((c) => c.id === name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))) {
      return res.status(400).json({ error: 'A codebase with that name already exists.' });
    }
    try {
      res.json({ ok: true, id: addCodebase(name, dir) });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/updates/:id/apply', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    const cb = job && findCodebase(job.codebaseId);
    if (!job || !job.diff || !cb) return res.status(404).json({ error: 'Update not found.' });
    if (job.status !== 'ready' && job.status !== 'undone') return res.status(400).json({ error: 'This update has already been dealt with.' });
    const checkIssue = updateCheckIssue(cb.id, job.check);
    if (checkIssue && !mayOverrideUpdateCheck(isLocal(req), req.body?.overrideChecks)) {
      return res.status(409).json({ error: `${checkIssue} Applying anyway requires explicit confirmation on the owner PC.` });
    }
    const doesNotFit = (err: any) => {
      job.stale = true; // lets "Try again" start a fresh update on the current code
      save();
      // One automatic retry on the current code. Only once per update: one the hub made by itself is never retried
      // by itself again, and neither is one that was already tried again. If it can't start (e.g. not signed in to
      // Claude), the update stays as it is and the "Try again" button is still there.
      if (!job.autoRetry && !job.retriedAs) {
        try {
          const id = startRetry(job, { auto: true });
          logActivity('work', 'Re-made your update on the latest code');
          return res.status(409).json({ retriedAs: id, error: `${cb.name} has changed since this update was made, so it no longer fits. Eden has started re-making it on the latest code. Look for the newer update in the list.` });
        } catch {}
      }
      return res.status(409).json({ error: `${cb.name} has changed since this update was made, so it no longer fits. Press "Try again" to redo it on the current code, or discard it. (${err.message})` });
    };
    // Make sure it fits before saving anything.
    try {
      git(['apply', '--whitespace=nowarn', '--check', '-'], repoRoot(cb), job.diff);
    } catch (err: any) {
      return doesNotFit(err);
    }
    holdForApply(); // Eden projects pause while the real code changes, and resume by themselves shortly after
    // A restore point comes first: nothing is applied unless it was saved. For the hub that is also a full backup.
    const ref = `refs/eden-restore/${job.id}`;
    let restore: NonNullable<UpdateJob['restore']>;
    try {
      let backup: string | undefined;
      if (cb.id === 'hub') {
        runBackup(false);
        try {
          backup = git(['rev-parse', '--verify', '-q', `refs/heads/${BACKUP_BRANCH}`], repoRoot(cb)).trim();
        } catch {}
      }
      const files = patchPaths(cb, job.diff);
      restore = { ref, commit: saveRestorePoint(cb, files, ref, `Eden restore point before update ${job.id}`), files, backup, at: now() };
    } catch (err: any) {
      return res.status(500).json({ error: `Nothing was changed, because a restore point could not be saved first. (${err.message})` });
    }
    try {
      const diff = job.diff;
      if (cb.id === 'hub') {
        const root = repoRoot(cb);
        const paths = restore.files.map(file => path.relative(APP_DIR, path.resolve(root, file)).split(path.sep).join('/'));
        applyWithRecovery(APP_DIR, job.id, restore.commit, paths, () => applyPatch(cb, diff));
      } else {
        applyPatch(cb, diff);
      }
    } catch (err: any) {
      try {
        git(['update-ref', '-d', ref], repoRoot(cb));
      } catch {}
      if (cb.id !== 'hub') return doesNotFit(err);
      return res.status(500).json({ error: `Could not apply the hub update with offline recovery. (${err.message})` });
    }
    job.restore = restore;
    job.status = 'applied';
    if (checkIssue) job.log.push('Applied after the owner confirmed a release check override on the PC.');
    delete job.stale;
    delete job.olderBase;
    delete job.olderBaseSameFiles;
    recheckAfter(job, cb);
    if (cb.id === 'hub' && job.needsRestart) services.markRestartPending();
    save();
    logActivity('done', `Code update applied (${cb.name}): ${job.request.slice(0, 80)}${job.needsRestart ? ` (${cb.restartHint} to finish)` : ''}`);
    onApplied(job, cb);
    res.json({ ok: true, needsRestart: !!job.needsRestart, restartHint: cb.restartHint });
  });

  app.post('/api/updates/:id/undo', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    const cb = job && findCodebase(job.codebaseId);
    if (!job || !job.diff || !cb || job.status !== 'applied') return res.status(400).json({ error: 'Only an applied update can be undone.' });
    if (job.restore) {
      // Put every file back as it was before Apply. What the files look like right now is saved first,
      // so even changes made on top of this update afterwards can be found again.
      try {
        saveRestorePoint(cb, job.restore.files, `refs/eden-restore/${job.id}-before-undo`, `Eden: files as they were just before undoing update ${job.id}`);
        restoreFromPoint(cb, job.restore.files, job.restore.commit);
      } catch (err: any) {
        return res.status(500).json({ error: `The undo did not work, so nothing was changed. (${err.message})` });
      }
    } else {
      // Updates applied before restore points existed are undone by reversing their change.
      try {
        applyPatch(cb, job.diff, true);
      } catch (err: any) {
        return res.status(409).json({ error: `Other changes have been made on top of this one, so it can't be undone automatically. (${err.message})` });
      }
    }
    job.status = 'undone';
    recheckAfter(job, cb);
    if (cb.id === 'hub' && job.needsRestart) services.markRestartPending();
    save();
    logActivity('done', `Code update undone (${cb.name}): ${job.request.slice(0, 80)}`);
    res.json({ ok: true, needsRestart: !!job.needsRestart, restartHint: cb.restartHint });
  });

  // Try an update again: starts a fresh update with the same request and codebase, linked to the old one.
  // Allowed for failed and discarded updates, and for ones that no longer fit the code (Apply said the code
  // has changed). The fresh update works on a new copy of the code as it is now (see makeCopy), and the old
  // one is cleared away.
  // The fix buttons in Code updates can also send:
  //   useClaude: true  -> run it on your Claude plan instead of an AI on this PC (when the local model failed)
  //   note: "..."     -> added under the request, e.g. the checks that failed last time, so the AI can fix them
  app.post('/api/updates/:id/retry', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Update not found.' });
    // Stale (no longer fits) or made on older code (fits, but another update changed the same files after its checks).
    const noLongerFits = (!!job.stale || !!job.olderBase) && (job.status === 'ready' || job.status === 'undone');
    // A finished update whose checks failed can be redone in one step ("Ask the AI to fix it"): like every retry,
    // the old one is only cleared once the new one has started, so a refused retry never loses the finished change.
    const checksFailed = (job.status === 'ready' || job.status === 'undone') && !!updateCheckIssue(job.codebaseId, job.check);
    if (job.status !== 'failed' && job.status !== 'discarded' && !noLongerFits && !checksFailed) {
      return res.status(400).json({ error: 'Only a failed or discarded update, one whose checks failed, or one that no longer fits the code, can be tried again.' });
    }
    // A second press (or a second device) must not start the same update twice.
    const already = job.retriedAs && jobs.find((j) => j.id === job.retriedAs);
    if (already && already.status !== 'failed' && already.status !== 'discarded') {
      return res.status(409).json({ error: 'This update was already tried again. Look for the newer one in the list.' });
    }
    try {
      const id = startRetry(job, { note: typeof req.body?.note === 'string' ? req.body.note : '', useClaude: req.body?.useClaude === true });
      res.json({ job: { id }, uncommitted: jobs.find((j) => j.id === id)?.uncommitted });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Change the queue order. Waiting updates run in the order they sit in `jobs` (oldest first), so moving one
  // swaps its place with the waiting update next to it. `to`: 'up' (runs sooner), 'down', 'first' or 'last'.
  // Only waiting updates move; the one running now and finished ones keep their place.
  app.post('/api/updates/:id/move', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Update not found.' });
    if (job.status !== 'queued') return res.status(400).json({ error: 'Only updates waiting in the queue can be moved.' });
    const to = String(req.body?.to || '');
    if (!['up', 'down', 'first', 'last'].includes(to)) return res.status(400).json({ error: 'Say where to move it: up, down, first or last.' });
    const slots = jobs.map((j, i) => (j.status === 'queued' ? i : -1)).filter((i) => i >= 0); // queue places, in run order
    const order = slots.map((i) => jobs[i]);
    const from = order.indexOf(job);
    const target = to === 'first' ? 0 : to === 'last' ? order.length - 1 : to === 'up' ? Math.max(0, from - 1) : Math.min(order.length - 1, from + 1);
    if (target !== from) {
      order.splice(from, 1);
      order.splice(target, 0, job);
      slots.forEach((slot, k) => (jobs[slot] = order[k]));
      save();
    }
    res.json({ ok: true, queue: order.map((j) => j.id) });
  });

  app.post('/api/updates/:id/discard', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const job = jobs.find((j) => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Update not found.' });
    if (job.status === 'applied') return res.status(400).json({ error: 'Undo it first.' });
    if (job.status === 'working' || job.status === 'checking') return res.status(409).json({ error: 'Wait for it to finish first.' });
    job.status = 'discarded';
    save();
    res.json({ ok: true });
  });
}

function registerIdeaRoutes(app: Express, guard: (req: Request) => string, services: UpdateRouteServices) {
  const { jobs, findCodebase, requestCodeUpdate, ideaSet, generateIdeas, saveIdeas, findSameUpdate, ideasMaxAge: IDEAS_MAX_AGE, sameIdeaBusy: SAME_IDEA_BUSY } = services;
  app.get('/api/updates/ideas', (req, res) => {
    if (!mayView(req)) return res.status(403).json({ error: LOCKED });
    const cb = findCodebase(String(req.query.codebaseId || 'hub'));
    if (!cb) return res.status(404).json({ error: 'Unknown codebase.' });
    const set = ideaSet(cb.id);
    // Refresh by itself when the ideas are a day old (only while someone is looking at the page).
    const stale = !set.at || Date.now() - new Date(set.at).getTime() > IDEAS_MAX_AGE;
    if (req.query.auto && stale && !set.running && !set.error && !isOffline() && cliSignedIn('anthropic')) generateIdeas(cb);
    const { dismissed, ...rest } = set;
    res.json({ ...rest, running: ideaSet(cb.id).running });
  });
  app.post('/api/updates/ideas', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const cb = findCodebase(String(req.body?.codebaseId || 'hub'));
    if (!cb) return res.status(404).json({ error: 'Unknown codebase.' });
    if (!cliSignedIn('anthropic')) return res.status(400).json({ error: 'Sign in to Claude in Account → Connections first.' });
    // "Find ideas anyway" sends force: true to skip the waiting-updates and just-started checks.
    const skipped = generateIdeas(cb, req.body?.force === true);
    res.json(skipped ? { ok: true, skipped } : { ok: true });
  });
  app.post('/api/updates/ideas/dismiss', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const set = ideaSet(String(req.body?.codebaseId || 'hub'));
    const title = String(req.body?.title || '');
    set.ideas = set.ideas.filter((i) => i.title !== title);
    if (title && !set.dismissed.includes(title)) set.dismissed = [...set.dismissed, title].slice(-40);
    saveIdeas();
    res.json({ ok: true });
  });
  // Starting an idea removes it from the list (it's in the queue now).
  app.post('/api/updates/ideas/start', (req, res) => {
    const denied = guard(req);
    if (denied) return res.status(403).json({ error: denied });
    const codebaseId = String(req.body?.codebaseId || 'hub');
    const set = ideaSet(codebaseId);
    const idea = set.ideas.find((i) => i.title === req.body?.title);
    if (!idea) return res.status(404).json({ error: 'That idea is gone. Refresh the ideas.' });
    // Don't queue the same idea twice while a copy is still waiting, running or ready to apply.
    const same = findSameUpdate(codebaseId, idea.request, SAME_IDEA_BUSY);
    if (same) {
      set.ideas = set.ideas.filter((i) => i !== idea);
      saveIdeas();
      logActivity('work', `Skipped a repeat update idea: "${idea.title}" (an update for it is already ${same.status}).`);
      return res.status(409).json({ error: `That idea is already in your updates (${same.status}), so it was not added again.` });
    }
    try {
      const id = requestCodeUpdate(codebaseId, idea.request);
      set.ideas = set.ideas.filter((i) => i !== idea);
      saveIdeas();
      res.json({ job: { id }, uncommitted: jobs.find((j) => j.id === id)?.uncommitted });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
}
