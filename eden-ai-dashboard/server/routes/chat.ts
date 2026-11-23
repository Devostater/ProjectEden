import type { Express } from 'express';
import { chatModelStore } from '../chatModelStore';
import { logActivity } from '../../activity';
import type { createChatHistory } from './chats';
import { knowledgeFor } from '../../knowledge';
import { isOffline, localModelFor, localModels, kindFor, fitsNow } from '../../offline';
import { mayManage } from '../../permissions';
import { UnconfirmedPaidRequestError, canUseWeb, generate, defaultModel, providerFor, providerUnavailable, fallbackModels, providerLabel } from '../../providers';
import type { Agent } from '../../src/types/index';

export function registerConversationRoutes(
  app: Express,
  root: string,
  getAgents: () => Agent[],
  save: () => void,
  appendToChat: ReturnType<typeof createChatHistory>['appendToChat'],
) {
  // Chat. With no agent named, the client sends Chief. Each agent answers with its own AI; if that AI
  // can't answer (not signed in, plan used up), the reply comes from another connected AI, with a note.
  // Chat model quickbar: hub-wide choice of Online (the usual AIs) or one model on this PC.
  // Kept in .eden-chat-model.json (git-ignored), default Online. A local choice never falls back to online.
  const { read: readChatModel, write: writeChatModel } = chatModelStore(root);
  app.get('/api/chat-model', (_req, res) => res.json({ model: readChatModel(), local: localModels() }));
  app.post('/api/chat-model', (req, res) => {
    if (!mayManage(req)) return res.status(403).json({ error: 'Only this computer can change the chat model.' });
    const m = req.body?.model;
    const model = m === 'online' || (typeof m === 'string' && localModels().includes(m)) ? m : null;
    if (!model) return res.status(400).json({ error: 'That model is not available on this PC.' });
    writeChatModel(model);
    res.json({ model });
  });

  app.post('/api/chat', async (req, res) => {
    const chatModel = readChatModel();
    const { messages, model, agentIds } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'messages required' });
    }
    // History lines carry author names so agents can see who said what in group threads.
    const history = messages.map((m: any) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.role === 'assistant' && m.author ? `[${m.author}]: ${m.content}` : m.content,
    })) as { role: 'user' | 'assistant'; content: string }[];

    const targets: Agent[] = Array.isArray(agentIds) && agentIds.length
      ? getAgents().filter((a: Agent) => agentIds.includes(a.id))
      : [];

    const LIMITS = `You can only reply with text in this chat. You cannot change this app, its pages, files or settings, or anything on the owner's computer, and you cannot contact anyone. Never say you have done something you cannot do. If the owner asks you to change the hub app itself (its layout, pages or features), say plainly that you can't do that from chat and that app changes are made in Claude Code, where the hub is built.`;
    const roster = getAgents()
      .map((a) => `@${a.name.split(' ')[0]} (${a.role})`)
      .join(', ');

    const systemFor = (agent?: Agent) => {
      if (!agent) {
        return `You are the lead AI assistant for a small studio that makes games and digital products and sells them online. Be direct and useful.\n${LIMITS}`;
      }
      const lead = agent.id === 'agent-synthesizer' || agent.id === 'agent-deputy' ? `\nThe team you can point the owner to: ${roster}. You cannot bring teammates into the chat yourself, so never offer to: tell the owner which @name to add to their next message.` : '';
      return `${agent.systemInstruction}${lead}\nYou are ${agent.name} (${agent.role}) in a chat with the studio owner and other AI teammates. Reply only as yourself, and never start your reply with a name or a label in brackets.\n${LIMITS}`;
    };

    const runOne = async (agent?: Agent) => {
      const start = Date.now();
      const wanted = agent?.model || model || defaultModel();
      const wantedProvider = providerFor(wanted);
      // Skip an AI we already know can't answer right now, then try the others in turn.
      const offlineFirst = (agent?.localModel && localModels().includes(agent.localModel) && fitsNow(agent.localModel) ? agent.localModel : null) || localModelFor(kindFor(wanted, agent?.role));
      const pinnedLocal = chatModel !== 'online' ? chatModel : null;
      if (pinnedLocal && !localModels().includes(pinnedLocal)) {
        return { author: agent?.name || 'Assistant', agentId: agent?.id, content: '', error: `The local model ${pinnedLocal.replace(/^x:[^:]+:/, '')} isn't running. Start Ollama, or switch the chat to Online.` };
      }
      // A big model (like gpt-oss:20b) needs about 9 GB of free memory; without it Ollama fails with "Internal Server Error".
      if (pinnedLocal && !fitsNow(pinnedLocal)) {
        return { author: agent?.name || 'Assistant', agentId: agent?.id, content: '', error: `${pinnedLocal.replace(/^x:[^:]+:/, '')} needs about 9 GB of free memory and this PC doesn't have that right now. Close other heavy programs and try again, pick a smaller model in the chat model picker, or switch the chat to Online.` };
      }
      const queue = pinnedLocal
        ? [pinnedLocal]
        : isOffline()
        ? [...new Set([offlineFirst, ...localModels()].filter((x) => x && fitsNow(x)) as string[])]
        : [...(providerUnavailable(wantedProvider) ? [] : [wanted]), ...fallbackModels(wantedProvider)];
      let lastError = isOffline()
        ? (localModels().length
          ? "Offline, and the AI on this PC needs more free memory than it has right now. Close other heavy programs and try again."
          : "Offline, and no AI on this PC is running. Start Ollama, then try again.")
        : `${providerLabel(wantedProvider)} isn't available right now, and no other AI is connected. Set one up in Account → Connections.`;
      for (const m of queue) {
        try {
          const r = await generate({ model: m, system: systemFor(agent) + knowledgeFor(history[history.length - 1]?.content || ''), messages: history, web: canUseWeb(agent), role: agent?.role, localModel: agent?.localModel });
          if (agent) {
            agent.totalRuns += 1;
            agent.totalTokens += r.tokens || 0;
          }
          logActivity('done', `${agent?.name || 'Assistant'} replied in chat (${providerLabel(r.provider)}).`);
          return {
            author: agent?.name || 'Assistant',
            agentId: agent?.id,
            model: r.model,
            provider: r.provider,
            content: r.text.replace(/^\s*\[[^\]\n]{1,40}\]:\s*/, ''),
            note: r.provider !== wantedProvider ? `Answered with ${providerLabel(r.provider)} because ${providerLabel(wantedProvider)} isn't available right now.` : '',
            tokens: r.tokens || 0,
            latencyMs: Date.now() - start,
          };
        } catch (err: any) {
          lastError = err?.message || 'failed';
          if (err instanceof UnconfirmedPaidRequestError) break;
        }
      }
      logActivity('error', `${agent?.name || 'Assistant'} could not reply in chat: ${lastError}`);
      return { author: agent?.name || 'Assistant', agentId: agent?.id, error: lastError, content: '' };
    };

    const replies = targets.length ? await Promise.all(targets.map((a) => runOne(a))) : [await runOne()];
    if (targets.length) save();
    // Asked by another program on this PC (LYRA calls this with no page origin): keep the exchange as a chat in the
    // hub, so it shows in Chat on every device and you can follow up there.
    if (!req.headers.origin) {
      const from = typeof req.body?.from === 'string' && req.body.from.trim() ? req.body.from.trim().slice(0, 30) : 'LYRA';
      const asked = history[history.length - 1]?.content || '';
      try {
        appendToChat(
          `ext-${from.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          `${from}'s questions`,
          [
            { role: 'user', author: from, content: asked },
            ...replies.map((r: any) => ({ role: 'assistant' as const, author: r.author, content: r.content || '', error: r.error, model: r.model, note: r.note || undefined })),
          ],
          targets.map((a: Agent) => a.id),
        );
      } catch {}
    }
    res.json({ replies });
  });
}
