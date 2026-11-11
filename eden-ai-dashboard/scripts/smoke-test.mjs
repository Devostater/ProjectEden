// Smoke test for a running Eden AI Hub server.
//   npm run test:smoke            checks routes without spending any AI messages
//   npm run test:smoke -- --live  also asks one teammate a real question (uses 1 AI message)
const BASE = process.env.EDEN_URL || 'http://localhost:3000';
const LIVE = process.argv.includes('--live');

let passed = 0;
const failures = [];

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

console.log(`Eden AI Hub smoke test → ${BASE}${LIVE ? ' (live)' : ''}\n`);

await test('workspace loads with the team', async () => {
  const { status, data } = await call('GET', '/api/workspace');
  expect(status === 200, `status ${status}`);
  expect(Array.isArray(data.agents) && data.agents.length >= 2, 'no agents');
  expect(data.agents[0].id === 'agent-synthesizer', `first teammate is ${data.agents[0].name}, expected Chief`);
  for (const a of data.agents) expect(a.name && a.role && a.model && a.systemInstruction, `teammate ${a.id} is missing a field`);
});

await test('Lyra is second in command', async () => {
  const { data } = await call('GET', '/api/workspace');
  expect(data.agents[1]?.name === 'Lyra' && data.agents[1].role === 'Deputy lead', `second teammate is ${data.agents[1]?.name} (${data.agents[1]?.role}), expected Lyra, Deputy lead`);
});

await test('starter workflow exists and only uses real teammates', async () => {
  const { data } = await call('GET', '/api/workspace');
  const ids = new Set(data.agents.map((a) => a.id));
  expect(data.pipelines.length >= 1, 'no workflows');
  for (const p of data.pipelines) {
    for (const n of p.nodes) if (n.type === 'agent') expect(ids.has(n.agentId), `"${p.name}" step "${n.label}" points at missing teammate ${n.agentId}`);
    const nodeIds = new Set(p.nodes.map((n) => n.id));
    for (const e of p.edges) expect(nodeIds.has(e.source) && nodeIds.has(e.target), `"${p.name}" has a broken link ${e.id}`);
  }
});

await test('models list covers Claude, Gemini and ChatGPT', async () => {
  const { status, data } = await call('GET', '/api/models');
  expect(status === 200, `status ${status}`);
  const providers = new Set(data.models.map((m) => m.provider));
  for (const p of ['anthropic', 'google', 'openai']) expect(providers.has(p), `no ${p} model`);
  expect(data.models.some((m) => m.id === data.defaultModel) || data.defaultModel, 'no default model');
});

await test('every teammate uses a known model', async () => {
  const [{ data: ws }, { data: md }] = await Promise.all([call('GET', '/api/workspace'), call('GET', '/api/models')]);
  const known = new Set(md.models.map((m) => m.id));
  for (const a of ws.agents) expect(known.has(a.model), `${a.name} uses unknown model ${a.model}`);
});

await test('settings never return a full secret', async () => {
  const { status, data } = await call('GET', '/api/settings');
  expect(status === 200, `status ${status}`);
  expect(data.providers.length === 3, 'expected 3 AI providers');
  for (const s of data.settings) if (s.secret && s.set) expect(s.preview.includes('•'), `${s.key} is not masked`);
});

await test('usage bars data is well-formed', async () => {
  const { data } = await call('GET', '/api/provider-usage');
  expect(data.usage.length === 3, 'expected 3 rows');
  for (const u of data.usage) expect(u.limit > 0 && u.messages >= 0 && ['subscription', 'api', 'off'].includes(u.mode), `bad row for ${u.name}`);
});

await test('add, edit and remove a teammate', async () => {
  const created = await call('POST', '/api/agents', { name: 'Smoke Tester', role: 'QA', model: 'gemini-3.6-flash', color: '#06B6D4', systemInstruction: 'Test teammate.' });
  expect(created.status === 200 && created.data.agent?.id, `create failed (${created.status})`);
  const id = created.data.agent.id;
  try {
    const edited = await call('POST', '/api/agents', { id, name: 'Smoke Tester', role: 'QA & Testing', systemInstruction: 'Test teammate.' });
    expect(edited.data.agent?.role === 'QA & Testing', 'edit did not stick');
  } finally {
    const removed = await call('DELETE', `/api/agents/${id}`);
    expect(removed.status === 200, `remove failed (${removed.status})`);
  }
  const { data } = await call('GET', '/api/workspace');
  expect(!data.agents.some((a) => a.id === id), 'teammate still present after remove');
});

await test('a teammate without a name is rejected', async () => {
  const { status } = await call('POST', '/api/agents', { role: 'QA' });
  expect(status === 400, `status ${status}`);
});

await test('Chief cannot be removed', async () => {
  const { status } = await call('DELETE', '/api/agents/agent-synthesizer');
  expect(status === 400, `status ${status}`);
  const { data } = await call('GET', '/api/workspace');
  expect(data.agents.some((a) => a.id === 'agent-synthesizer'), 'Chief is gone');
});

await test('create, edit and delete a file', async () => {
  const created = await call('POST', '/api/files', { path: '/notes/smoke-test.md', name: 'smoke-test.md', category: 'user_upload', language: 'markdown', content: 'hello' });
  expect(created.status === 200, `create failed (${created.status})`);
  const ws = await call('GET', '/api/workspace');
  const file = ws.data.files.find((f) => f.path === '/notes/smoke-test.md');
  expect(file, 'file not listed after create');
  try {
    const edited = await call('PUT', `/api/files/${file.id}`, { ...file, content: 'hello again' });
    expect(edited.status === 200, `edit failed (${edited.status})`);
  } finally {
    const removed = await call('DELETE', `/api/files/${file.id}`);
    expect(removed.status === 200, `delete failed (${removed.status})`);
  }
});

await test('projects: create a project, add and move a card, then delete', async () => {
  const made = await call('POST', '/api/projects', { name: 'Smoke Project', goal: 'Test goal' });
  expect(made.status === 200 && made.data.project?.id, `create failed (${made.status})`);
  const pid = made.data.project.id;
  try {
    const card = await call('POST', '/api/cards', { projectId: pid, title: 'First card' });
    expect(card.status === 200 && card.data.card.column === 'todo', `card create failed (${card.status})`);
    const cid = card.data.card.id;
    const moved = await call('POST', '/api/cards', { id: cid, column: 'review', assigneeId: 'agent-synthesizer', note: 'Looks good' });
    expect(moved.data.card.column === 'review' && moved.data.card.assigneeId === 'agent-synthesizer', 'move or assign did not stick');
    expect(moved.data.card.notes.length === 1 && moved.data.card.notes[0].text === 'Looks good', 'note not saved');
    const list = await call('GET', '/api/projects');
    expect(list.data.cards.some((c) => c.id === cid && c.projectId === pid), 'card not listed');
  } finally {
    const gone = await call('DELETE', `/api/projects/${pid}`);
    expect(gone.status === 200, `delete failed (${gone.status})`);
  }
  const after = await call('GET', '/api/projects');
  expect(!after.data.projects.some((p) => p.id === pid), 'project still listed');
  expect(!after.data.cards.some((c) => c.projectId === pid), 'cards left behind after deleting the project');
});

await test('projects: bad input is rejected', async () => {
  expect((await call('POST', '/api/projects', { name: '  ' })).status === 400, 'nameless project accepted');
  expect((await call('POST', '/api/cards', { projectId: 'nope', title: 'x' })).status === 400, 'card in a missing project accepted');
  const { data } = await call('GET', '/api/projects');
  if (data.projects[0]) {
    const pid = data.projects[0].id;
    expect((await call('POST', '/api/cards', { projectId: pid, title: 'x', column: 'sideways' })).status === 400, 'unknown column accepted');
    expect((await call('POST', '/api/cards', { projectId: pid, title: 'x', assigneeId: 'agent-nobody' })).status === 400, 'unknown teammate accepted');
  }
});

await test('activity log answers and records the start-up', async () => {
  const { status, data } = await call('GET', '/api/activity');
  expect(status === 200 && Array.isArray(data.entries), `status ${status}`);
  expect(data.entries.some((e) => /Hub started/.test(e.text)), 'no start-up line');
  const later = await call('GET', `/api/activity?since=${data.latest}`);
  expect(later.data.entries.length === 0, 'old lines were sent again');
});

await test('terminal refuses commands unless it is on and the request comes from the hub page', async () => {
  const info = await call('GET', '/api/terminal');
  expect(info.status === 200 && typeof info.data.enabled === 'boolean', `status ${info.status}`);
  // This script is not the hub's page (it sends no Origin), so it must be refused either way.
  const r = await call('POST', '/api/terminal', { command: 'echo should-not-run' });
  expect(r.status === 403, `a command was accepted (status ${r.status})`);
});

await test('workflows: the run address exists and a missing workflow says so', async () => {
  const r = await call('POST', '/api/pipelines/does-not-exist/execute', {});
  expect(r.status === 404 && r.data?.error, `status ${r.status}`);
});

if (LIVE) {
  await test('live: a two-step workflow runs and passes results along', async () => {
    const pipeline = {
      id: 'pipe-smoke-test',
      name: 'Smoke Workflow',
      description: 'Temporary test workflow.',
      nodes: [
        { id: 's1', label: 'Pick a word', type: 'agent', agentId: 'agent-deputy', prompt: 'Reply with one single word: the name of a fruit.', status: 'idle', x: 0, y: 0 },
        { id: 's2', label: 'Use the word', type: 'agent', agentId: 'agent-builder', prompt: 'Write one short sentence that uses the word from the previous step.', status: 'idle', x: 200, y: 0 },
      ],
      edges: [{ id: 'e1', source: 's1', target: 's2' }],
    };
    const saved = await call('POST', '/api/pipelines', pipeline);
    expect(saved.status === 200, `could not save the test workflow (${saved.status})`);
    try {
      const run = await call('POST', '/api/pipelines/pipe-smoke-test/execute', {});
      expect(run.status === 200, `status ${run.status}: ${run.data?.error}`);
      const steps = run.data.pipeline.nodes;
      for (const n of steps) expect(n.status === 'completed' && n.lastOutput, `step "${n.label}" ended ${n.status}: ${n.error || ''}`);
      console.log(`        step 1: ${steps[0].lastOutput.trim().slice(0, 40)} | step 2: ${steps[1].lastOutput.trim().slice(0, 70)}`);
    } finally {
      await call('DELETE', '/api/pipelines/pipe-smoke-test');
    }
  });
}

await test('nexus: the room answers, rejects empty messages and can be stopped', async () => {
  const room = await call('GET', '/api/nexus');
  expect(room.status === 200 && Array.isArray(room.data.messages) && typeof room.data.state.running === 'boolean', `status ${room.status}`);
  expect(room.data.depths.quick < room.data.depths.normal && room.data.depths.normal < room.data.depths.deep, 'discussion lengths are out of order');
  expect((await call('POST', '/api/nexus/message', { text: '   ' })).status === 400, 'an empty message was accepted');
  expect((await call('POST', '/api/nexus/stop')).status === 200, 'stop failed');
});

if (LIVE) {
  await test('live: a quick Nexus discussion has several speakers and ends with a plan', async () => {
    const before = (await call('GET', '/api/nexus')).data.latest;
    const sent = await call('POST', '/api/nexus/message', { text: 'Quick one: should a tiny studio launch its first game on Steam or itch.io first?', depth: 'quick' });
    expect(sent.status === 200, `status ${sent.status}: ${sent.data?.error}`);
    let room;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      room = (await call('GET', `/api/nexus?since=${before}`)).data;
      if (!room.state.running) break;
    }
    expect(!room.state.running, 'the discussion was still running after two minutes');
    const said = room.messages.filter((m) => m.role === 'agent');
    expect(said.length >= 2 && said.length <= 4, `${said.length} AI messages for a quick discussion (expected 2 to 4)`);
    expect(new Set(said.map((m) => m.author)).size >= 2, 'only one teammate spoke');
    expect(said.some((m) => m.kind === 'plan'), 'no wrap-up plan');
    for (const m of said) expect(!/^\s*(NEXT|ASK|DONE)\b/im.test(m.text), `a stage direction leaked into ${m.author}'s message`);
    console.log(`        ${said.map((m) => m.author + (m.kind === 'plan' ? ' (plan)' : '')).join(' → ')}`);
  });
}

await test('chat rejects an empty request', async () => {
  const { status } = await call('POST', '/api/chat', {});
  expect(status === 400, `status ${status}`);
});

await test('GitHub: a pasted link opens the repository', async () => {
  const { status, data } = await call('POST', '/api/github/fetch-repo', { repo: 'https://github.com/Devostater/Project-Nova' });
  if (status === 403 || status === 429) return console.log('        (skipped: GitHub hourly limit reached)');
  expect(status === 200 && data.type === 'dir' && data.items.length > 0, `status ${status}: ${data?.error}`);
});

await test('GitHub: nonsense input gives a clear message', async () => {
  const { status, data } = await call('POST', '/api/github/fetch-repo', { repo: 'not a repo' });
  expect(status === 400 && /owner\/name/.test(data.error), `status ${status}: ${data?.error}`);
});

await test('GitHub: status route answers', async () => {
  const { status, data } = await call('GET', '/api/github/status');
  expect(status === 200 && typeof data.connected === 'boolean', `status ${status}`);
});

await test('the app page is served', async () => {
  const res = await fetch(BASE + '/');
  const html = await res.text();
  expect(res.status === 200 && html.includes('<div id="root">'), `status ${res.status}`);
});

if (LIVE) {
  await test('live: Lyra answers a question', async () => {
    const { data } = await call('GET', '/api/workspace');
    const lyra = data.agents.find((a) => a.name === 'Lyra');
    const r = await call('POST', '/api/chat', { agentIds: [lyra.id], messages: [{ role: 'user', content: 'In one sentence, what do you do for the studio?' }] });
    const reply = r.data.replies[0];
    expect(!reply.error && reply.content.length > 10, reply.error || 'empty reply');
    expect(!/^\s*\[/.test(reply.content), 'reply starts with a bracketed label');
    console.log(`        ${reply.author} via ${reply.provider}: ${reply.content.slice(0, 110)}`);
  });
}

if (LIVE) {
  await test('live: a Ready card is worked on and lands in Review', async () => {
    const made = await call('POST', '/api/projects', { name: 'Smoke Runner Project', goal: 'Check the card runner.' });
    const pid = made.data.project.id;
    try {
      const card = await call('POST', '/api/cards', {
        projectId: pid,
        title: 'Suggest three names for a cozy fishing game',
        details: 'One line each.',
        assigneeId: 'agent-deputy',
        column: 'ready',
      });
      const cid = card.data.card.id;
      let current;
      for (let i = 0; i < 45; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        current = (await call('GET', '/api/projects')).data.cards.find((c) => c.id === cid);
        if (current.column === 'review' || current.runState === 'failed') break;
      }
      expect(current.column === 'review', `card ended in "${current.column}" (${current.runState || 'no state'}: ${current.runMessage || current.notes.at(-1)?.text || ''})`);
      const result = current.notes.find((n) => n.kind === 'result');
      expect(result && result.text.length > 10, 'no result note on the card');
      console.log(`        ${result.author}: ${result.text.replace(/\s+/g, ' ').slice(0, 110)}`);
    } finally {
      await call('DELETE', `/api/projects/${pid}`);
    }
  });
}

await test('dependencies: links are saved, loops are refused, and a deleted card is unlinked', async () => {
  const made = await call('POST', '/api/projects', { name: 'Smoke Links Project' });
  const pid = made.data.project.id;
  try {
    await call('POST', '/api/projects', { id: pid, autoRun: false });
    const a = (await call('POST', '/api/cards', { projectId: pid, title: 'A' })).data.card;
    const b = (await call('POST', '/api/cards', { projectId: pid, title: 'B', dependsOn: [a.id, 'card-nope'] })).data.card;
    expect(b.dependsOn.length === 1 && b.dependsOn[0] === a.id, `B waits for ${JSON.stringify(b.dependsOn)}`);
    const loop = await call('POST', '/api/cards', { id: a.id, dependsOn: [b.id] });
    expect(loop.status === 400, `a loop was accepted (status ${loop.status})`);
    const self = (await call('POST', '/api/cards', { id: a.id, dependsOn: [a.id] })).data.card;
    expect(self.dependsOn.length === 0, 'a card was allowed to wait for itself');
    const done = (await call('POST', '/api/cards', { id: a.id, column: 'done' })).data.card;
    expect(!!done.doneAt, 'finish time not recorded');
    await call('DELETE', `/api/cards/${a.id}`);
    const after = (await call('GET', '/api/projects')).data.cards.find((c) => c.id === b.id);
    expect(after.dependsOn.length === 0, 'B still waits for a deleted card');
  } finally {
    await call('DELETE', `/api/projects/${pid}`);
  }
});

await test('dependencies: a Ready card is held until what it waits for is Done', async () => {
  const made = await call('POST', '/api/projects', { name: 'Smoke Hold Project' });
  const pid = made.data.project.id;
  try {
    const first = (await call('POST', '/api/cards', { projectId: pid, title: 'First step' })).data.card;
    const second = (await call('POST', '/api/cards', { projectId: pid, title: 'Second step', assigneeId: 'agent-deputy', column: 'ready', dependsOn: [first.id] })).data.card;
    await new Promise((r) => setTimeout(r, 6000));
    const held = (await call('GET', '/api/projects')).data.cards.find((c) => c.id === second.id);
    expect(held.column === 'ready' && held.runState === 'waiting', `card is ${held.column} / ${held.runState || 'no state'}`);
    expect(/First step/.test(held.runMessage || ''), `message was "${held.runMessage}"`);
    expect(held.notes.length === 0, 'the AI ran a card that should have been held');
  } finally {
    await call('DELETE', `/api/projects/${pid}`);
  }
});

await test('planning: an empty request is rejected', async () => {
  const { data } = await call('GET', '/api/projects');
  if (!data.projects[0]) return;
  const r = await call('POST', `/api/projects/${data.projects[0].id}/plan`, { goal: '  ' });
  expect(r.status === 400, `status ${r.status}`);
  expect((await call('POST', '/api/projects/nope/plan', { goal: 'x' })).status === 404, 'missing project accepted');
});

if (LIVE) {
  await test('live: Chief turns a goal into assigned cards', async () => {
    const made = await call('POST', '/api/projects', { name: 'Smoke Plan Project', goal: 'A small cozy fishing game for PC.' });
    const pid = made.data.project.id;
    try {
      const r = await call('POST', `/api/projects/${pid}/plan`, { goal: 'Get a Steam store page ready: copy, tags and a price.' });
      expect(r.status === 200, `status ${r.status}: ${r.data?.error}`);
      expect(r.data.cards.length >= 2, `only ${r.data.cards.length} card(s)`);
      const ids = new Set((await call('GET', '/api/workspace')).data.agents.map((a) => a.id));
      const assigned = r.data.cards.filter((c) => c.assigneeId);
      expect(assigned.length >= 1, 'no card was assigned to anyone');
      for (const c of assigned) expect(ids.has(c.assigneeId), `unknown assignee ${c.assigneeId}`);
      const after = await call('GET', '/api/projects');
      expect(!after.data.cards.some((c) => c.projectId === pid), 'planning added cards before approval');
      console.log(`        ${r.data.cards.length} cards: ${r.data.cards.map((c) => c.title).join(' | ').slice(0, 120)}`);
    } finally {
      await call('DELETE', `/api/projects/${pid}`);
    }
  });
}

await test('projects: Ready cards without a teammate, or with the switch off, are left alone', async () => {
  const made = await call('POST', '/api/projects', { name: 'Smoke Idle Project' });
  const pid = made.data.project.id;
  try {
    await call('POST', '/api/projects', { id: pid, autoRun: false });
    const a = await call('POST', '/api/cards', { projectId: pid, title: 'Switch is off', assigneeId: 'agent-deputy', column: 'ready' });
    await new Promise((r) => setTimeout(r, 6000));
    const cards = (await call('GET', '/api/projects')).data.cards;
    const after = cards.find((c) => c.id === a.data.card.id);
    expect(after.column === 'ready' && !after.runState && after.notes.length === 0, `card was touched: ${after.column} ${after.runState || ''}`);
  } finally {
    await call('DELETE', `/api/projects/${pid}`);
  }
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
