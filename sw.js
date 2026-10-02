// Service worker (módulo): guarda la app para que funcione sin cobertura y envía los
// partes pendientes en segundo plano cuando vuelve la señal (Background Sync, Android).
// IMPORTANTE: al publicar cambios, sube VERSION; si no, los móviles seguirán con la copia antigua.

import { procesarSalida } from './js/salida.js';

const VERSION = 'v0.3.0';
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
