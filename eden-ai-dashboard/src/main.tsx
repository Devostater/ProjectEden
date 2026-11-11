import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { setupInstall } from './installApp.ts';

setupInstall();

createRoot(document.getElementById('root')!).render(<App />);
