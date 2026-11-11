import {createRoot} from 'react-dom/client';
import App from './App.tsx';
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

createRoot(document.getElementById('root')!).render(<App />);
