/* IndexedDB-Schicht.
 *
 * Alle Datensätze besitzen eine UUID als Primärschlüssel und Zeitstempel
 * (Millisekunden seit Epoche). Dadurch lässt sich später eine Cloud-Synchronisierung
 * (z. B. Supabase) ergänzen: jede Tabelle entspricht einem Object Store.
 *
 *   cards       { id, front, back, categoryIds[], createdAt, updatedAt }
 *   categories  { id, name, parentId|null, createdAt, updatedAt }
 *   reviews     { cardId, ease, interval, due, reps, lapses, totalReviews, correct,
 *                 firstReviewedAt, lastReviewedAt, updatedAt }
 *   reviewLog   { id, cardId, at, known, sessionId, intervalBefore, intervalAfter }
 *   tombstones  { id, type, deletedAt }          (gelöschte Datensätze für Sync)
 *   backups     { id, createdAt, reason, counts, data }
 *   meta        { key, value }                   (Einstellungen, Entwurf, Geräte-ID …)
 */

export const DB_NAME = 'lernkarten-db';
export const DB_VERSION = 1;
export const DATA_STORES = ['cards', 'categories', 'reviews', 'reviewLog', 'tombstones'];
export const ALL_STORES = [...DATA_STORES, 'backups', 'meta'];

let database = null;

function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    const cards = db.createObjectStore('cards', { keyPath: 'id' });
    cards.createIndex('createdAt', 'createdAt');
    cards.createIndex('updatedAt', 'updatedAt');
    db.createObjectStore('categories', { keyPath: 'id' });
    db.createObjectStore('reviews', { keyPath: 'cardId' }).createIndex('due', 'due');
    const log = db.createObjectStore('reviewLog', { keyPath: 'id' });
    log.createIndex('at', 'at');
    log.createIndex('cardId', 'cardId');
    db.createObjectStore('tombstones', { keyPath: 'id' });
    db.createObjectStore('backups', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
    db.createObjectStore('meta', { keyPath: 'key' });
  }
}

export function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Dieser Browser unterstützt IndexedDB nicht (oder sie ist deaktiviert, z. B. im privaten Modus).'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
    req.onsuccess = () => {
      database = req.result;
      database.onversionchange = () => {
        database.close();
        location.reload();
      };
      resolve(database);
    };
    req.onerror = () => reject(req.error || new Error('Datenbank konnte nicht geöffnet werden.'));
    req.onblocked = () => reject(new Error('Die Datenbank ist durch einen anderen Tab blockiert. Bitte schließe andere Tabs dieser App und lade neu.'));
  });
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export const getAll = (store) => wrap(database.transaction(store).objectStore(store).getAll());
export const get = (store, key) => wrap(database.transaction(store).objectStore(store).get(key));
export const count = (store) => wrap(database.transaction(store).objectStore(store).count());
export const getAllFromIndex = (store, index, range) =>
  wrap(database.transaction(store).objectStore(store).index(index).getAll(range));

/**
 * Führt mehrere Schreib-/Leseoperationen atomar in einer Transaktion aus.
 * `work(s)` muss synchron sein; `s(name)` liefert den Object Store.
 */
export function runTx(storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    let tx;
    try {
      try {
        tx = database.transaction(storeNames, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
      } catch {
        tx = database.transaction(storeNames, mode);
      }
    } catch (e) {
      reject(e);
      return;
    }
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Speichern abgebrochen.'));
    try {
      result = work((name) => tx.objectStore(name), tx);
    } catch (e) {
      try { tx.abort(); } catch { /* bereits abgebrochen */ }
      reject(e);
    }
  });
}

export const put = (store, value) => runTx([store], 'readwrite', (s) => { s(store).put(value); });
export const del = (store, key) => runTx([store], 'readwrite', (s) => { s(store).delete(key); });

/** Liest alle Stores (ohne Backups) für Export / Backup. */
export async function readEverything() {
  const out = {};
  await Promise.all(DATA_STORES.map(async (n) => { out[n] = await getAll(n); }));
  const settings = await get('meta', 'settings');
  out.settings = settings ? settings.value : {};
  return out;
}
