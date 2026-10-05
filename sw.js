// Service worker: guarda la app para que funcione sin cobertura y envía los partes
// pendientes en segundo plano cuando vuelve la señal (Background Sync, Android).
// IMPORTANTE: al publicar cambios, sube VERSION; si no, los móviles seguirán con la copia antigua.
//
// Es un script clásico (sin import) a propósito: los móviles con la app ya instalada lo
// actualizan como script clásico, y un módulo no se podría cargar así. Por eso el envío
// en segundo plano repite aquí la lógica de js/salida.js.

const VERSION = 'v0.8.4';
const CACHE = `partes-lav-${VERSION}`;
const JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js';
const ARCHIVOS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/db.js',
  './js/envio.js',
  './js/fotos.js',
  './js/pdf.js',
  './js/salida.js',
  './js/servidor.js',
  './js/util.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './ejemplo/config-ejemplo.json',
  JSPDF,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('partes-lav-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const host = new URL(req.url).hostname;
  if (host.endsWith('google.com') || host.endsWith('googleusercontent.com')) return;   // servidor: siempre a la red
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') {
        const portada = await cache.match('./index.html');
        if (portada) return portada;
      }
      throw err;
    }
  })());
});

self.addEventListener('sync', (e) => {
  if (e.tag !== 'partes-salida') return;
  e.waitUntil(procesarSalida().then(async (r) => {
    const clientes = await self.clients.matchAll({ includeUncontrolled: true });
    clientes.forEach((c) => c.postMessage({ tipo: 'salida', ...r }));
    // Si quedan pendientes, el error hace que Chrome lo vuelva a intentar más tarde.
    if (r.pendientes) throw new Error('Quedan partes pendientes de enviar');
  }));
});

// ---------- Cola de salida (misma lógica que js/salida.js) ----------

function abrirDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('partes-lav', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('partes')) d.createObjectStore('partes', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('fotos')) d.createObjectStore('fotos', { keyPath: 'id' }).createIndex('parteId', 'parteId');
      if (!d.objectStoreNames.contains('salida')) d.createObjectStore('salida', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function op(almacen, modo, fn) {
  const d = await abrirDB();
  return new Promise((res, rej) => {
    const t = d.transaction(almacen, modo);
    let salida;
    const req = fn(t.objectStore(almacen));
    if (req) req.onsuccess = () => { salida = req.result; };
    t.oncomplete = () => res(salida);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

function isoLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` +
    `${off >= 0 ? '+' : '-'}${p(Math.floor(a / 60))}:${p(a % 60)}`;
}

async function procesarSalida() {
  const perfil = await op('kv', 'readonly', (s) => s.get('perfil'));
  const url = await op('kv', 'readonly', (s) => s.get('servidorUrl'));
  const items = (await op('salida', 'readonly', (s) => s.getAll())) || [];
  if (!perfil || !perfil.token || !url || !items.length) return { enviados: 0, pendientes: items.length };
  let enviados = 0;
  for (const it of items.sort((a, b) => (a.creado || '').localeCompare(b.creado || ''))) {
    let j;
    try {
      j = await llamar(url, JSON.stringify({
        accion: 'enviar', peticion: crypto.randomUUID(), token: perfil.token, envioId: it.id, ...it.datos,
      }));
    } catch {
      break;   // sin cobertura: se reintenta más tarde
    }
    const p = await op('partes', 'readonly', (s) => s.get(it.parteId));
    if (j.ok) {
      if (p) {
        p.envios = (p.envios || []).concat([{ fecha: isoLocal(), recibido: j.recibido }]);
        p.estado = 'enviado';
        p.recibido = j.recibido;
        delete p.errorEnvio;
        await op('partes', 'readwrite', (s) => s.put(p));
      }
      await op('salida', 'readwrite', (s) => s.delete(it.id));
      enviados++;
    } else {
      it.error = j.error;
      it.intentos = (it.intentos || 0) + 1;
      await op('salida', 'readwrite', (s) => s.put(it));
      if (p) {
        p.errorEnvio = j.error;
        await op('partes', 'readwrite', (s) => s.put(p));
      }
    }
  }
  const quedan = (await op('salida', 'readonly', (s) => s.getAll())) || [];
  return { enviados, pendientes: quedan.length };
}

// Google a veces pierde la respuesta aunque el parte haya llegado: se repite con el mismo
// identificador de petición y el servidor contesta lo mismo sin mandarlo otra vez.
async function llamar(url, cuerpo) {
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 2000 * i));
    try {
      const r = await fetch(url, { method: 'POST', redirect: 'follow', body: cuerpo });
      const j = await r.json();
      if (!j.reintentar) return j;
    } catch { /* sin cobertura o respuesta perdida */ }
  }
  throw new Error('Sin respuesta del servidor');
}
