import { get, set } from 'idb-keyval';
import type { PersistAdapter, Persisted } from '../state/store';

const KEY = 'bubbles-md.workspace.v1';

/** One versioned workspace snapshot in this browser profile's IndexedDB for this site origin. */
export const idbPersistence: PersistAdapter = {
  load: async () => ((await get(KEY)) as Persisted | undefined) ?? null,
  save: (snapshot) => set(KEY, snapshot),
};
