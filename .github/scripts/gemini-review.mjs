// Gemini advisory PR review, run by .github/workflows/gemini-pr-review.yml.
// Exits 0 when a review was posted (or the feature isn't configured), 1 when no review could be made.
// Pure helpers are exported for the tests in gemini-review.test.mjs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const PER_FILE = 15_000; // bytes of diff per file
const TOTAL = 60_000; // bytes of diff in all

// Lines a PR adds that look like credentials. If any match, nothing is sent to Gemini.
const SECRET_PATTERNS = [
  [/AKIA[0-9A-Z]{16}/, 'AWS access key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}/, 'GitHub token'],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/, 'OpenAI/Anthropic key'],
  [/\bAIza[0-9A-Za-z_-]{35}/, 'Google API key'],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*["'][^"'\s]{12,}["']/i, 'hard-coded secret'],
];

// Finds possible secrets in the lines a diff adds. Returns [{ file, line, kind }].
export function findSecrets(diff) {
  const hits = [];
  let file = '';
  let line = 0;
  for (const text of diff.split('\n')) {
    if (text.startsWith('+++ ')) {
      file = text.slice(4).replace(/^b\//, '');
      continue;
    }
    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (text.startsWith('+')) {
      for (const [re, kind] of SECRET_PATTERNS) if (re.test(text)) hits.push({ file, line, kind });
      line++;
    } else if (!text.startsWith('-')) line++;
  }
  return hits;
}

// Builds the text sent to Gemini: every changed file is listed; each file's diff is capped, and files that
// don't fit in the total are named as left out. `files` = [{ name, diff }].
export function boundDiffs(files) {
  let used = 0;
  const parts = [];
  const cut = [];
  const omitted = [];
  for (const f of files) {
    if (used >= TOTAL) {
      omitted.push(f.name);
      continue;
    }
    let d = f.diff;
    const room = Math.min(PER_FILE, TOTAL - used);
    if (d.length > room) {
      d = d.slice(0, room) + '\n[... this file\'s diff was cut off here ...]';
      cut.push(f.name);
    }
    used += d.length;
    parts.push(d);
  }
  return { text: parts.join('\n'), cut, omitted, complete: !cut.length && !omitted.length };
}

// Reads Gemini's reply. Returns { ok: true, text } or { ok: false, reason }.
export function readReply(status, data) {
  if (status < 200 || status >= 300) return { ok: false, reason: `Gemini API answered ${status}: ${data?.error?.message || 'no details'}` };
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) return { ok: false, reason: `Gemini returned no review text (finish reason: ${data?.candidates?.[0]?.finishReason || 'none'}).` };
  return { ok: true, text };
}

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });

async function main() {
  const { GEMINI_API_KEY: key, GEMINI_MODEL: model, BASE_REF: base, PR_TITLE: title = '', HEAD_SHA: sha = '' } = process.env;
  const header = (label) => `<!-- gemini-review -->\n## Gemini advisory review: ${label}\n_Model ${model || '(not set)'}, commit ${sha.slice(0, 7)}. Advice from an AI, not a passing check._\n\n`;
  const post = (body) => fs.writeFileSync('review.md', body);

  if (!key || !model) {
    console.log('::notice::Gemini review NOT CONFIGURED (GEMINI_API_KEY secret or GEMINI_MODEL variable missing). Skipping.');
    return 0;
  }
  const range = `origin/${base}...HEAD`;
  const names = sh('git', ['diff', '--name-only', range]).split('\n').filter(Boolean);
  const files = names.map((name) => ({ name, diff: sh('git', ['diff', range, '--', name]) }));
  const full = files.map((f) => f.diff).join('\n');

  const secrets = findSecrets(full);
  if (secrets.length) {
    post(header('REVIEW NOT PERFORMED') + `Nothing was sent to Gemini: the diff adds lines that look like credentials:\n${secrets.map((s) => `- \`${s.file}\` line ${s.line}: ${s.kind}`).join('\n')}\n\nRemove them (and rotate any real key), or if they are fake test values, say so in the PR.`);
    console.log('::error::Possible secrets in the diff; not sent to Gemini.');
    return 1;
  }

  const b = boundDiffs(files);
  const incomplete = b.complete ? '' : `**INCOMPLETE REVIEW: the diff was too big.**${b.cut.length ? ` Cut off: ${b.cut.map((n) => `\`${n}\``).join(', ')}.` : ''}${b.omitted.length ? ` Not sent at all: ${b.omitted.map((n) => `\`${n}\``).join(', ')}.` : ''}\n\n`;
  const prompt = [
    `Review this pull request for Project Eden (React + Express, TypeScript). Title: ${title}`,
    `Changed files (${names.length}): ${names.join(', ')}`,
    b.complete ? '' : 'Some file diffs were cut off or left out; say which files you could not review.',
    'Focus on: (1) bugs, regressions and edge cases, (2) missing tests, (3) security and secret handling.',
    'Be concise. Label each point blocking / suggestion / question, cite file and line, and separate what the diff shows from possible risks.',
    '```diff\n' + b.text + '\n```',
  ].filter(Boolean).join('\n');

  let reply;
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    reply = readReply(r.status, await r.json().catch(() => ({})));
  } catch (e) {
    reply = { ok: false, reason: `Gemini could not be reached: ${e.message}` };
  }
  if (!reply.ok) {
    post(header('REVIEW NOT PERFORMED') + reply.reason);
    console.log(`::error::${reply.reason}`);
    return 1;
  }
  post(header(b.complete ? 'done' : 'INCOMPLETE') + incomplete + reply.text);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('gemini-review.mjs')) {
  main().then((code) => process.exit(code), (e) => {
    console.log(`::error::${e.message}`);
    process.exit(1);
  });
}
