import { fileURLToPath } from 'node:url';
import { createChatHistory } from './server/routes/chats';

export const { appendToChat, registerChatRoutes } = createChatHistory(
  fileURLToPath(new URL('./.eden-chats.json', import.meta.url)),
);
