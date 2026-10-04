// Comunicación con el servidor de envío (Google Apps Script, ver servidor/Code.gs).
// Se usa desde la app y desde el service worker (envío en segundo plano).

import { uuid } from './util.js';

export const SERVIDOR_URL = 'https://script.google.com/macros/s/AKfycby7EzTsuZ0q8pitvVX2zFh8SpK-s2WR1qSn2XktoH7-M5vKoi2-5u-SthXn2F-Es2yu/exec';

export const hayServidor = () => Boolean(SERVIDOR_URL);

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

// Quien muestra el aviso de espera puede escuchar los reintentos para decir «intento 2 de 5».
let avisoReintento = null;
export function alReintentar(fn) { avisoReintento = fn; }

/**
 * Llama a una acción del servidor. Los errores de red llevan `red = true`
 * (el parte se queda en cola y se reintenta); los demás traen el mensaje del servidor.
 *
 * Google a veces pierde la respuesta aunque la acción se haya hecho, y devuelve una página
 * de error. Por eso se reintenta solo, con el mismo identificador de petición: el servidor
 * reconoce la repetición y contesta lo mismo sin volver a hacer nada.
 */
export async function api(accion, datos = {}, { timeout = 45000, intentos = 5 } = {}) {
  if (!SERVIDOR_URL) throw new Error('La app no tiene servidor configurado.');
  const cuerpo = JSON.stringify({ accion, peticion: uuid(), ...datos });
  let error;
  for (let i = 0; i < intentos; i++) {
    if (i) {
      if (avisoReintento) avisoReintento(i + 1, intentos);
      await espera(Math.min(2000 * i, 5000));
    }
    try {
      return await llamar(cuerpo, timeout);
    } catch (e) {
      if (!e.red || !navigator.onLine) throw e;
      error = e;
    }
  }
  throw error;
}

async function llamar(cuerpo, timeout) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    let r;
    try {
      // Sin cabeceras propias: así es una petición «simple» y Google no exige CORS previo.
      r = await fetch(SERVIDOR_URL, { method: 'POST', body: cuerpo, redirect: 'follow', signal: ctrl.signal });
    } catch {
      throw fallo('Sin conexión con el servidor.');
    }
    let j;
    try {
      j = await r.json();
    } catch {
      throw fallo('El servidor no ha respondido bien. Se reintentará.');
    }
    if (j.reintentar) throw fallo(j.error || 'El servidor está ocupado. Se reintentará.');
    if (!j.ok) throw new Error(j.error || 'Error del servidor');
    return j;
  } finally {
    clearTimeout(t);
  }
}

function fallo(mensaje) {
  const err = new Error(mensaje);
  err.red = true;
  return err;
}
