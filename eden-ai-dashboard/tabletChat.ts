import type { Express } from 'express';

type Message = { role: 'user' | 'assistant'; content: string };
type Reply = (messages: Message[]) => Promise<string>;

export function registerTabletChat(app: Express, reply: Reply) {
  app.post('/api/tablet/chat', async (req, res) => {
    const messages: unknown = req.body?.messages;
    if (!Array.isArray(messages) || !messages.length || messages.length > 24 ||
        !messages.every((message) => message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' && message.content.trim() && message.content.length <= 8000) ||
        messages.at(-1)?.role !== 'user') {
      return res.status(400).json({ error: 'Send up to 24 text messages, ending with your question.' });
    }
    try {
      const content = await reply(messages.map(({ role, content }) => ({ role, content })));
      res.json({ content });
    } catch {
      res.status(503).json({ error: 'Tablet chat needs a running local model or an online AI connected by API on the owner computer.' });
    }
  });
}
