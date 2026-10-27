// Cola de salida: partes cerrados pendientes de llegar a la oficina.
// Se procesa al pulsar Enviar, al abrir la app, al recuperar cobertura y, en Android,
// en segundo plano desde el service worker (Background Sync), aunque la app esté cerrada.

import * as db from './db.js';
import { api } from './servidor.js';
import { registrarFallo } from './fallos.js';
import { isoLocal } from './util.js';

let enCurso = null;

export function procesarSalida() {
  if (!enCurso) enCurso = procesar().finally(() => { enCurso = null; });
  return enCurso;
}

async function procesar() {
  const perfil = await db.kvGet('perfil');
  const items = await db.listarSalida();
  if (!perfil || !perfil.token || !items.length) return { enviados: 0, pendientes: items.length };
  let enviados = 0;
  for (const it of items.sort((a, b) => (a.creado || '').localeCompare(b.creado || ''))) {
    try {
      const r = await api('enviar', { token: perfil.token, envioId: it.id, ...it.datos }, { timeout: 240000 });
      const p = await db.getParte(it.parteId);
      if (p) {
        p.envios = (p.envios || []).concat([{ fecha: isoLocal(), recibido: r.recibido }]);
        p.estado = 'enviado';
        p.recibido = r.recibido;
        delete p.errorEnvio;
        await db.putParte(p);
      }
      await db.borrarSalida(it.id);
      enviados++;
    } catch (e) {
      if (e.red) break;   // sin cobertura: se reintenta más tarde
      registrarFallo('envio', e.message);
      it.error = e.message;
      it.intentos = (it.intentos || 0) + 1;
      await db.putSalida(it);
      const p = await db.getParte(it.parteId);
      if (p) {
        p.errorEnvio = e.message;
        await db.putParte(p);
      }
    }
  }
  return { enviados, pendientes: (await db.listarSalida()).length };
}

/**
 * Quita del móvil un parte cerrado o en cola que no se va a enviar: su entrada en la cola, sus
 * fotos y el parte. Las dos colas (esta y la de sw.js) ya aguantan que el parte no esté.
 */
export async function descartarDelMovil(parteId) {
  for (const x of await db.listarSalida()) if (x.parteId === parteId) await db.borrarSalida(x.id);
  for (const f of await db.fotosDeParte(parteId)) await db.borrarFoto(f.id);
  await db.borrarParte(parteId);
}
