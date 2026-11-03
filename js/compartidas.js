// Fotos compartidas desde otra app (WhatsApp → Compartir → Partes LAV). El service worker (sw.js)
// las deja en la clave «compartidas» del móvil; aquí están las reglas para elegir a qué trabajo y
// fase van. La pantalla está en vista-compartidas.js.

import * as db from './db.js';
import { FASES } from './modelo.js';

export const CLAVE_COMPARTIDAS = 'compartidas';
// Cuántas no se han podido guardar al compartir (no eran fotos, muy grandes, más del máximo o sin
// espacio). La escribe sw.js; la app lo dice una vez y la pone a cero.
export const CLAVE_DESCARTADAS = 'compartidasDescartadas';
// Los mismos límites están en sw.js (una prueba avisa si se separan).
export const MAX_COMPARTIDAS = 30;
export const MAX_MB_COMPARTIDA = 25;

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

/** Dónde pueden ir las fotos de un trabajo: antes, durante, después y, en SUPER con vía, los telefonemas. */
export function fasesFoto(p, t) {
  const f = FASES.slice();
  if (p.tipo === 'SUPER' && !t.sinVia) f.push(['telentrada', 'Telefonema de entrada'], ['telsalida', 'Telefonema de salida']);
  return f;
}

/**
 * Trabajos a los que se pueden mandar fotos: los de partes INFRA y SUPER en borrador (maquinaria no
 * lleva fotos), del parte tocado más recientemente al más antiguo.
 */
export function destinosFotos(partes) {
  return partes
    .filter((p) => p.estado === 'borrador' && (p.tipo === 'INFRA' || p.tipo === 'SUPER') && !p.sinTrabajos)
    .sort((a, b) => (b.modificado || '').localeCompare(a.modificado || ''))
    .flatMap((p) => (p.trabajos || []).map((t, ti) => ({
      parteId: p.id, trabajoId: t.id, ti, ref: p.ref, tipo: p.tipo, referencia: referenciaDe(t), fases: fasesFoto(p, t),
    })));
}
