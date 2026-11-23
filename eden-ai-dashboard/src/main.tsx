import { StrictMode } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { TabletChat } from './components/TabletChat.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import './index.css';
import { setupInstall } from './installApp.ts';

setupInstall();

// Every refresh button gives a quick spin when clicked (see index.css), wherever it is in the app.
document.addEventListener('click', (e) => {
  const button = (e.target as HTMLElement | null)?.closest?.('button');
  if (!button || !button.querySelector('svg.lucide-refresh-cw')) return;
  button.classList.remove('refresh-spin');
  void button.offsetWidth; // restart the animation on repeated clicks
  button.classList.add('refresh-spin');
  setTimeout(() => button.classList.remove('refresh-spin'), 750);
});

const root = createRoot(document.getElementById('root')!);
async function start() {
  try {
    const response = await fetch('/api/me');
    if (response.status === 401) {
      root.render(<p className="p-5"><a href="/">Pair this device with EDEN</a></p>);
      return;
    }
    if (!response.ok) throw new Error();
    const { local } = await response.json();
    const app = <ErrorBoundary>{local === true ? <App /> : <TabletChat />}</ErrorBoundary>;
    root.render(import.meta.env.DEV ? <StrictMode>{app}</StrictMode> : app);
  } catch {
    root.render(<p role="alert" className="p-5">Could not connect to EDEN. Reload to try again.</p>);
  }
}
void start();
