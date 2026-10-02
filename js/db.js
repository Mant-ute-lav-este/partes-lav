// Almacenamiento local en el móvil (IndexedDB): partes, fotos y ajustes.
// Nada sale del móvil hasta que el capataz envía el parte.

const NOMBRE = 'partes-lav';
const VERSION = 1;
let dbp = null;

function abrir() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NOMBRE, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('partes')) d.createObjectStore('partes', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('fotos')) {
          d.createObjectStore('fotos', { keyPath: 'id' }).createIndex('parteId', 'parteId');
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  return dbp;
}

async function tx(almacen, modo, fn) {
  const d = await abrir();
  return new Promise((res, rej) => {
    const t = d.transaction(almacen, modo);
    let salida;
    const req = fn(t.objectStore(almacen));
    if (req) req.onsuccess = () => { salida = req.result; };
    t.oncomplete = () => res(salida);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('Transacción cancelada'));
  });
}

export const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));

export const getParte = (id) => tx('partes', 'readonly', (s) => s.get(id));
export const putParte = (p) => tx('partes', 'readwrite', (s) => s.put(p));
export const listarPartes = () => tx('partes', 'readonly', (s) => s.getAll());
export const borrarParte = (id) => tx('partes', 'readwrite', (s) => s.delete(id));

export const getFoto = (id) => tx('fotos', 'readonly', (s) => s.get(id));
export const putFoto = (f) => tx('fotos', 'readwrite', (s) => s.put(f));
export const borrarFoto = (id) => tx('fotos', 'readwrite', (s) => s.delete(id));
export const fotosDeParte = (parteId) => tx('fotos', 'readonly', (s) => s.index('parteId').getAll(parteId));
