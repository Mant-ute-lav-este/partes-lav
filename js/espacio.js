// Espacio del móvil: borra las fotos de los partes enviados hace más de 30 días (la oficina ya
// las tiene). El parte se queda, sin fotos, para repetirlo o rectificarlo.

import * as db from './db.js';
import { fotosCaducadas } from './modelo.js';
import { isoLocal } from './util.js';

/** Se llama al arrancar. Nunca toca borradores, partes cerrados ni nada que esté en la cola. */
export async function limpiarFotosAntiguas(ahora = new Date()) {
  const enCola = new Set((await db.listarSalida()).map((x) => x.parteId));
  let partes = 0;
  let fotos = 0;
  for (const p of await db.listarPartes()) {
    if (!fotosCaducadas(p, ahora) || enCola.has(p.id)) continue;
    for (const f of await db.fotosDeParte(p.id)) {
      await db.borrarFoto(f.id);
      fotos++;
    }
    p.fotosBorradas = isoLocal(ahora);
    await db.putParte(p);
    partes++;
  }
  return { partes, fotos };
}

/** Línea «Espacio usado» del Menú, a partir de navigator.storage.estimate(). Aviso si quedan menos de 300 MB. */
export function textoEspacio({ usage, quota }) {
  const mb = (n) => Math.round(n / 1048576);
  const libre = quota - usage;
  const poco = libre < 300 * 1048576;
  return {
    poco,
    texto: `Espacio usado: ${mb(usage)} MB` +
      (poco ? `. Queda poco sitio (${mb(libre)} MB): envía los partes pendientes y libera espacio en el móvil.` : ''),
  };
}
