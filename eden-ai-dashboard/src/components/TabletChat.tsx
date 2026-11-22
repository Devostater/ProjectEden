import { useState, type FormEvent } from 'react';

type Message = { role: 'user' | 'assistant'; content: string };

export function TabletChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    const question = draft.trim();
    const history: Message[] = [...messages, { role: 'user', content: question }];
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/tablet/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-23) }),
      });
      if (response.status === 401) throw new Error('Your pairing has ended. Reload this page to pair again.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Tablet chat could not send your message.');
      setMessages([...history, { role: 'assistant', content: data.content.slice(0, 8000) }]);
      setDraft('');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Tablet chat could not send your message.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 p-5">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">EDEN Tablet Chat</h1>
        <button type="button" onClick={() => setMessages([])} disabled={busy || !messages.length} className="rounded-lg border px-3 py-2 disabled:opacity-50">New chat</button>
      </header>
      <div className="flex flex-1 flex-col gap-3" role="log" aria-label="Conversation">
        {messages.map((message, index) => (
          <p key={index} className="whitespace-pre-wrap break-words rounded-lg border p-3">
            <strong className="mb-1 block">{message.role === 'user' ? 'You' : 'EDEN'}</strong>
            {message.content}
          </p>
        ))}
      </div>
      {error && <p role="alert" className="text-red-600">{error}</p>}
      <form onSubmit={send} className="flex items-end gap-2">
        <textarea aria-label="Message" placeholder="Ask EDEN" value={draft} onChange={(event) => setDraft(event.target.value)}
          maxLength={8000} rows={3} disabled={busy} className="min-w-0 flex-1 rounded-lg border bg-transparent p-3" />
        <button disabled={busy || !draft.trim()} className="rounded-lg bg-indigo-600 px-4 py-3 text-white disabled:opacity-50">{busy ? 'Sending…' : 'Send'}</button>
      </form>
    </main>
  );
}
