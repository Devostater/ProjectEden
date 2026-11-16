// One-off check of the LYRA timeout fix: asks LYRA the way Eden does (same /api/chat call, same streamPost)
// and saves her answer. Usage: node --import tsx scripts/ask-lyra-direct.ts <out file> <prompt file>
import fs from 'node:fs';
import { streamPost } from '../streamPost.ts';

const [out, promptFile] = process.argv.slice(2);
const url = (process.env.LYRA_URL || 'http://127.0.0.1:4777').replace(/\/+$/, '') + '/api/chat';
const history = [{ role: 'user', content: fs.readFileSync(promptFile, 'utf8') }];
let answer = '';
let model = 'lyra';
let error = '';
let lines = 0;
const started = Date.now();
await streamPost(
  url,
  { model: 'auto', mode: 'chat', project: null, trust: 'ask', history },
  (line) => {
    lines++;
    let ev: any;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.type === 'answer' && ev.text) answer = ev.text;
    else if (ev.type === 'error') error = ev.text || 'LYRA failed';
    else if (ev.type === 'route' && ev.model) model = ev.model;
  },
  { idleMs: 15 * 60 * 1000, totalMs: 30 * 60 * 1000 },
);
const secs = Math.round((Date.now() - started) / 1000);
if (!answer) {
  console.log(`LYRA gave no answer after ${secs}s (${lines} lines): ${error}`);
  process.exit(1);
}
fs.writeFileSync(out, `<!-- Written by LYRA (model: ${model}) for roadmap round 1 (#10), ${new Date().toISOString().slice(0, 10)}. Unedited AI output; reviewed in the overview. -->\n\n${answer.trim()}\n`);
console.log(`LYRA answered in ${secs}s with ${model} (${lines} stream lines, ${answer.length} chars)`);
