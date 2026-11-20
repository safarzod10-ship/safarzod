import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { hideSplash, initTelegram } from './tg';

initTelegram();
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// keep the splash visible for at least ~1 s since navigation so it never just flickers
requestAnimationFrame(() => setTimeout(hideSplash, Math.max(0, 1000 - performance.now())));
