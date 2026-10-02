// Comunicación con el servidor de envío (Google Apps Script, ver servidor/Code.gs).
// Se usa desde la app y desde el service worker (envío en segundo plano).

export const SERVIDOR_URL = '';

export const hayServidor = () => Boolean(SERVIDOR_URL);

/**
 * Llama a una acción del servidor. Los errores de red llevan `red = true`
 * (el parte se queda en cola y se reintenta); los demás traen el mensaje del servidor.
 */
export async function api(accion, datos = {}, { timeout = 60000 } = {}) {
  if (!SERVIDOR_URL) throw new Error('La app no tiene servidor configurado.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  let r;
  try {
    // Sin cabeceras propias: así es una petición «simple» y Google no exige CORS previo.
    r = await fetch(SERVIDOR_URL, {
      method: 'POST', body: JSON.stringify({ accion, ...datos }), redirect: 'follow', signal: ctrl.signal,
    });
  } catch {
    const err = new Error('Sin conexión con el servidor.');
    err.red = true;
    throw err;
  } finally {
    clearTimeout(t);
  }
  let j;
  try {
    j = await r.json();
  } catch {
    const err = new Error('El servidor no ha respondido bien. Se reintentará.');
    err.red = true;
    throw err;
  }
  if (!j.ok) throw new Error(j.error || 'Error del servidor');
  return j;
}
