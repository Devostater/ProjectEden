import type React from 'react';

// Ctrl+Enter (or Cmd+Enter on a Mac) in a message box adds a new line where the cursor is.
// Returns true when it handled the key, so the caller knows not to send the message.
export function newlineOnCtrlEnter(e: React.KeyboardEvent<HTMLTextAreaElement>, setValue: (value: string) => void): boolean {
  if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey)) return false;
  e.preventDefault();
  const box = e.currentTarget;
  const start = box.selectionStart;
  const end = box.selectionEnd;
  setValue(`${box.value.slice(0, start)}\n${box.value.slice(end)}`);
  requestAnimationFrame(() => {
    box.selectionStart = box.selectionEnd = start + 1;
  });
  return true;
}
