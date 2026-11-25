// Phone <-> PC sync through Firebase (Google sign-in + Firestore; works offline and catches up later).
// Uses the same Firebase project as Deckscan. Data lives under users/{uid}/:
//   budgetEntries/{id}, budgetBatches/{id}, budgetPhotos/{entryId} = {d: jpeg data URL}, budgetMeta/settings
import { FIREBASE_CONFIG } from './config.js';
import { store } from './store.js';

let fb = null, auth = null, fsdb = null, unsubs = [];
export const sync = {
  status: FIREBASE_CONFIG ? 'starting' : 'off', // off | starting | signedout | syncing | synced | error
  user: null, error: null,
  listeners: new Set(),
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  set(patch) { Object.assign(this, patch); for (const fn of this.listeners) fn(this); },
};
const fail = e => sync.set({ status: 'error', error: e.message || String(e) });

export async function initSync() {
  if (!FIREBASE_CONFIG) return;
  try {
    fb = await import('../vendor/firebase.mjs');
    const app = fb.initializeApp(FIREBASE_CONFIG);
    auth = fb.getAuth(app);
    await fb.setPersistence(auth, fb.browserLocalPersistence).catch(() => {});
    try {
      fsdb = fb.initializeFirestore(app, { localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }) });
    } catch { fsdb = fb.initializeFirestore(app, {}); }
    fb.getRedirectResult(auth).catch(e => sync.set({ error: e.message }));
    fb.onAuthStateChanged(auth, user => (user ? attach(user) : detach()));
  } catch (e) { fail(e); }
}

export async function signIn() {
  if (!auth) return;
  const provider = new fb.GoogleAuthProvider();
  try { await fb.signInWithPopup(auth, provider); }
  catch (e) {
    if (/popup/i.test(e.code || e.message)) await fb.signInWithRedirect(auth, provider);
    else sync.set({ error: e.message });
  }
}
export const signOutUser = () => auth && fb.signOut(auth);

async function writeMany(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = fb.writeBatch(fsdb);
    for (const [ref, data] of ops.slice(i, i + 400)) data === null ? b.delete(ref) : b.set(ref, data);
    await b.commit();
  }
}

async function attach(user) {
  sync.set({ status: 'syncing', user: { name: user.displayName, email: user.email, uid: user.uid }, error: null });
  const base = ['users', user.uid];
  const ref = (col, id) => fb.doc(fsdb, ...base, col, id);
  const mergedKey = 'budget.merged.' + user.uid;
  try {
    // First sign-in on this device: add what was saved here before signing in, once.
    if (!localStorage.getItem(mergedKey)) {
      const s = store.state;
      const remoteSettings = await fb.getDoc(ref('budgetMeta', 'settings')).catch(() => null);
      const ops = [];
      if (!remoteSettings?.exists()) ops.push([ref('budgetMeta', 'settings'), s.settings]);
      for (const e of Object.values(s.entries)) ops.push([ref('budgetEntries', e.id), e]);
      for (const b of Object.values(s.batches)) ops.push([ref('budgetBatches', b.id), b]);
      await writeMany(ops);
      localStorage.setItem(mergedKey, '1');
    }
  } catch (e) { fail(e); }

  store.remote = {
    putEntries: list => writeMany(list.map(e => [ref('budgetEntries', e.id), e])).catch(fail),
    delEntry: id => writeMany([[ref('budgetEntries', id), null], [ref('budgetPhotos', id), null]]).catch(fail),
    putBatch: b => fb.setDoc(ref('budgetBatches', b.id), b).catch(fail),
    delBatch: id => fb.deleteDoc(ref('budgetBatches', id)).catch(fail),
    putSettings: s => fb.setDoc(ref('budgetMeta', 'settings'), s).catch(fail),
    putPhoto: (id, d) => fb.setDoc(ref('budgetPhotos', id), { d }).catch(fail),
    delPhoto: id => fb.deleteDoc(ref('budgetPhotos', id)).catch(() => {}),
    getPhoto: async id => { const s = await fb.getDoc(ref('budgetPhotos', id)); return s.exists() ? s.data().d : null; },
  };
  const listen = (col, kind) => unsubs.push(fb.onSnapshot(fb.collection(fsdb, ...base, col), { includeMetadataChanges: true }, snap => {
    const out = {};
    snap.forEach(d => { out[d.id] = d.data(); });
    store.replace(kind, out);
    if (kind === 'entries') sync.set({ status: snap.metadata.hasPendingWrites || snap.metadata.fromCache ? 'syncing' : 'synced' });
  }, fail));
  listen('budgetEntries', 'entries');
  listen('budgetBatches', 'batches');
  unsubs.push(fb.onSnapshot(ref('budgetMeta', 'settings'), snap => { if (snap.exists()) store.replace('settings', snap.data()); }, fail));
}

function detach() {
  for (const u of unsubs) u();
  unsubs = [];
  store.remote = null;
  sync.set({ status: 'signedout', user: null });
}
