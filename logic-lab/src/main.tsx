import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { EXAMPLES } from './engine/examples.ts';
import { simctl } from './store/simctl.ts';
import { firstVisit, simRoot, store, validateLive } from './store/store.ts';
import './styles.css';

// First visit: start with a small example instead of an empty canvas.
if (firstVisit) {
  const ex = EXAMPLES.find((e) => e.id === 'half-adder');
  if (ex) store.set({ project: ex.build() });
}

// Keep the simulation in step with the document (before React re-renders).
const syncSim = () => {
  validateLive();
  const s = store.get();
  simctl.sync(s.project, simRoot(s), s.doc);
};
store.subscribe(syncSim);
syncSim();

// Offline support in the built app (not in the dev server).
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
