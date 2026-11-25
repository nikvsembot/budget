// Receipt photos: kept on this phone in IndexedDB, and in Firebase (as a small JPEG) when signed in.
import { store } from './store.js';

let dbp = null;
function db() {
  return dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('budget-photos', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('p');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('p', mode);
    const req = fn(t.objectStore('p'));
    t.oncomplete = () => res(req?.result);
    t.onerror = () => rej(t.error);
  });
}

const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataURLToBlob = async d => (await fetch(d)).blob();

export const photos = {
  async put(id, blob) {
    await tx('readwrite', s => s.put(blob, id)).catch(() => {});
    if (store.remote && store.state.settings.photos) store.remote.putPhoto(id, await blobToDataURL(blob));
  },
  async get(id) {
    const local = await tx('readonly', s => s.get(id)).catch(() => null);
    if (local) return local;
    if (!store.remote) return null;
    const d = await store.remote.getPhoto(id).catch(() => null);
    if (!d) return null;
    const blob = await dataURLToBlob(d);
    tx('readwrite', s => s.put(blob, id)).catch(() => {});
    return blob;
  },
  async del(id) {
    await tx('readwrite', s => s.delete(id)).catch(() => {});
    store.remote?.delPhoto(id);
  },
};
