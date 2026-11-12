// Fotos compartidas desde otra app (WhatsApp → Compartir → Partes LAV). El service worker (sw.js)
// las deja en la clave «compartidas» del móvil; aquí están las reglas para elegir a qué trabajo y
// fase van. La pantalla está en vista-compartidas.js.

import * as db from './db.js';
import { FASES, FASES_HER } from './modelo.js';
import { isoLocal } from './util.js';

export const CLAVE_COMPARTIDAS = 'compartidas';
// Cuántas no se han podido guardar al compartir (no eran fotos, muy grandes, más del máximo o sin
// espacio). La escribe sw.js; la app lo dice una vez y la pone a cero.
export const CLAVE_DESCARTADAS = 'compartidasDescartadas';
// Los mismos límites están en sw.js (una prueba avisa si se separan).
export const MAX_COMPARTIDAS = 30;
export const MAX_MB_COMPARTIDA = 25;

// «Compartir → Partes LAV» activo en este móvil: { fecha, via }. Chrome solo lo activa al renovar la
// app instalada (no se puede forzar). Se apunta la primera vez que se nota, de dos formas:
// via 'compartir' = ha llegado algo compartido (lo apunta sw.js, con la misma clave);
// via 'arranque' = la app instalada arranca con la marca ?i=2 del manifest, que llega con la renovación.
export const CLAVE_ACTIVO = 'compartirActivo';

export async function compartirActivo() {
  const v = await db.kvGet(CLAVE_ACTIVO);
  return Boolean(v && typeof v === 'object' && v.fecha);
}

/**
 * Al arrancar: si la app instalada se abre con la marca, este móvil ya está renovado. Solo en Android:
 * en iPhone y en el ordenador la app instalada también arranca con la marca, pero allí no hay
 * «Compartir → Partes LAV».
 */
export async function anotarArranque({
  search = location.search,
  instalada = esInstalada(),
  android = esAndroid(),
} = {}) {
  if (!android || !instalada || new URLSearchParams(search).get('i') !== '2') return;
  if (await compartirActivo()) return;   // se guarda la primera vez
  await db.kvSet(CLAVE_ACTIVO, { fecha: isoLocal(), via: 'arranque' });
}

export const esAndroid = () => /Android/i.test(navigator.userAgent);
export const esInstalada = () => matchMedia('(display-mode: standalone)').matches;

/**
 * Qué pasa al tocar 🖼️ Galería: 'directo' = abre el selector como siempre (navegador, iPhone, ordenador
 * y móviles Android donde «Compartir → Partes LAV» aún no está activo); 'activado' = hoja con «Fotos del
 * móvil» y «Fotos de WhatsApp».
 */
export function modoOrigen({ activo, instalada, android }) {
  return android && instalada && activo ? 'activado' : 'directo';
}

// Pase de «Fotos de WhatsApp»: { parteId, trabajoId, fase } o { parteId, formato: true }, más desde/hasta
// (milisegundos). Lo crea la pantalla de pasos; compartir recarga la app y, mientras valga y haya fotos
// esperando, se entra sin PIN y van directas a su sitio (vista-compartidas.js, entrarConPase). Se renueva
// con cada foto y se acaba con «Hecho», «Atrás», «Bloquear» o a los 5 minutos sin fotos.
export const CLAVE_PASE = 'paseWhatsapp';
export const PASE_MS = 5 * 60 * 1000;

/** Vale si no ha caducado, no dura más de 5 minutos y el reloj no ha ido hacia atrás desde que se hizo. */
export function paseValido(p, ahora = Date.now()) {
  return Boolean(p && typeof p === 'object' && p.parteId && typeof p.desde === 'number' && typeof p.hasta === 'number' &&
    ahora >= p.desde && ahora < p.hasta && p.hasta - p.desde <= PASE_MS);
}

export async function crearPase(destino) {
  const ahora = Date.now();
  await db.kvSet(CLAVE_PASE, { ...destino, desde: ahora, hasta: ahora + PASE_MS });
}

export async function renovarPase(p) {
  const ahora = Date.now();
  await db.kvSet(CLAVE_PASE, { ...p, desde: ahora, hasta: ahora + PASE_MS });
}

export const borrarPase = () => db.kvSet(CLAVE_PASE, null);

/** El pase guardado si vale; si no, null. */
export async function leerPase() {
  const p = await db.kvGet(CLAVE_PASE);
  return paseValido(p) ? p : null;
}

/** Fotos que esperan: [{ id, archivo, llegada }]. Lista vacía si no hay nada o lo guardado no vale. */
export async function leerCompartidas() {
  const l = await db.kvGet(CLAVE_COMPARTIDAS);
  return Array.isArray(l) ? l.filter((x) => x && x.archivo instanceof Blob) : [];
}

export const borrarCompartidas = () => db.kvSet(CLAVE_COMPARTIDAS, null);

/** Quita una foto de la espera (ya colocada o imposible de usar); las demás siguen. */
export async function quitarCompartida(id) {
  const quedan = (await leerCompartidas()).filter((x) => x.id !== id);
  await db.kvSet(CLAVE_COMPARTIDAS, quedan.length ? quedan : null);
}

/** Cuántas se descartaron al compartir desde la última vez que se preguntó (y lo pone a cero). */
export async function tomarDescartadas() {
  const n = Number(await db.kvGet(CLAVE_DESCARTADAS)) || 0;
  if (n) await db.kvSet(CLAVE_DESCARTADAS, null);
  return n;
}

/**
 * La referencia que sale en el sello ('' si falta). Sin ella no se pueden poner fotos: lo usan
 * Cámara y Galería (eventos.js) y las fotos compartidas.
 */
export function referenciaDe(t) {
  const r = t.referencia || {};
  if (r.tipo === 'SIOS') return String(r.codigo || '').trim() ? `SIOS ${r.codigo.trim()}` : '';
  if (r.tipo === 'INCIDENCIA') return String(r.codigo || '').trim() ? `Incidencia ${r.codigo.trim()}` : '';
  if (r.tipo === 'SIN_REF') return String(r.motivo || '').trim();
  return '';
}

/**
 * Dónde pueden ir las fotos de un trabajo: antes, durante, después y, en SUPER con vía, los telefonemas.
 * Un caso de HERBICIDA, solo antes y después.
 */
export function fasesFoto(p, t) {
  if (p.tipo === 'HERBICIDA') return FASES_HER.slice();
  const f = FASES.slice();
  if (p.tipo === 'SUPER' && !t.sinVia) f.push(['telentrada', 'Telefonema de entrada'], ['telsalida', 'Telefonema de salida']);
  return f;
}

/**
 * Trabajos a los que se pueden mandar fotos: los de partes INFRA, SUPER y HERBICIDA en borrador
 * (maquinaria no lleva fotos), del parte tocado más recientemente al más antiguo.
 */
export function destinosFotos(partes) {
  return partes
    .filter((p) => p.estado === 'borrador' && ['INFRA', 'SUPER', 'HERBICIDA'].includes(p.tipo) && !p.sinTrabajos)
    .sort((a, b) => (b.modificado || '').localeCompare(a.modificado || ''))
    .flatMap((p) => (p.trabajos || []).map((t, ti) => ({
      parteId: p.id, trabajoId: t.id, ti, ref: p.ref, tipo: p.tipo, referencia: referenciaDe(t), fases: fasesFoto(p, t),
    })));
}
