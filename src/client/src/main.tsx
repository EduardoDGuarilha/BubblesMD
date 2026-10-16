import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { WorkspaceStore } from './state/store';
import { suggest } from './services/api';
import { idbPersistence } from './services/persistence';
import './styles.css';
import { popRecordingReady } from './ui/sound';

const store = new WorkspaceStore(suggest, idbPersistence);
void store.load();
// Development-only handle for inspecting state during manual walkthroughs.
if (import.meta.env.DEV) Object.assign(window as object, { bubblesStore: store, bubblesSound: { popRecordingReady } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
