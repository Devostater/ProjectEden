import path from 'node:path';
import { jsonObject, jsonStore } from '../jsonStore';

export function chatModelStore(root: string) {
  const file = jsonStore<{ model: string }>(path.join(root, '.eden-chat-model.json'), (value) =>
    jsonObject(value) && typeof value.model === 'string' && value.model.length > 0, 2);
  return {
    read: () => file.read()?.model ?? 'online',
    write: (model: string) => file.write({ model }),
  };
}
