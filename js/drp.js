// Registros DRP de la bateadora (archivos .drp de la máquina): reglas puras de qué se admite,
// cuántos caben y cómo se leen sus nombres. La pantalla y el guardado están en vista-drp.js.

import { MAX_DRP, MAX_DRP_BYTES } from './util.js';

/**
 * ¿Este parte de maquinaria de vía lleva una bateadora? Solo entonces se piden los DRP.
 * Por el nombre o por el trabajo («Bateo»), porque la oficina puede llamarla p. ej. «Unimat 08-4x4/4s».
 */
export function llevaDrp(p) {
  return Boolean(p) && p.tipo === 'MAQUINARIA' && (p.subtipo || 'via') === 'via' &&
    (p.maquinasVia || []).some((m) => /bateadora/i.test(m.descripcion || '') || /bateo/i.test(m.trabajo || ''));
}

/**
 * Reparte los archivos elegidos entre admitidos y rechazados (con el motivo).
 * @param {{nombre:string, tam:number}[]} actuales  los que ya tiene el parte
 * @param {{name:string, size:number}[]} nuevos     los que se acaban de elegir
 */
export function admitirDrp(actuales, nuevos) {
  const ok = [];
  const rechazados = [];
  const vistos = new Set(actuales.map((x) => `${x.nombre}|${x.tam}`));   // mismo nombre y tamaño: repetido
  let n = actuales.length;
  let bytes = actuales.reduce((s, x) => s + (x.tam || 0), 0);
  for (const f of nuevos) {
    const nombre = String(f.name || '');
    let motivo = '';
    if (!/\.drp$/i.test(nombre)) motivo = 'extension';
    else if (!f.size) motivo = 'vacio';
    else if (vistos.has(`${nombre}|${f.size}`)) motivo = 'repetido';
    else if (n >= MAX_DRP) motivo = 'cantidad';
    else if (bytes + f.size > MAX_DRP_BYTES) motivo = 'peso';
    if (motivo) { rechazados.push({ nombre, motivo }); continue; }
    ok.push(f);
    vistos.add(`${nombre}|${f.size}`);
    n++;
    bytes += f.size;
  }
  return { ok, rechazados };
}

const TEXTO_MOTIVO = {
  extension: 'no es un archivo .drp',
  vacio: 'está vacío',
  repetido: 'ya estaba añadido',
  cantidad: `solo caben ${MAX_DRP}`,
  peso: `el total pasaría de ${Math.round(MAX_DRP_BYTES / 1048576)} MB`,
};

export const textoMotivoDrp = (m) => TEXTO_MOTIVO[m] || 'no se puede añadir';

/** «495+940 al 495+840 via2 reg1.drp» → { pkInicio, pkFin, via, registro }, o null si el nombre es otro. */
export function leerNombreDrp(nombre) {
  const m = /^(\d+\+\d{3})\s+al\s+(\d+\+\d{3})\s+v[ií]a\s*(\d+)\s+reg\s*(\d+)/i.exec(String(nombre || '').trim());
  return m ? { pkInicio: m[1], pkFin: m[2], via: m[3], registro: m[4] } : null;
}

/** 205851 → «201 KB»; 2500000 → «2,4 MB». */
export function tamTexto(bytes) {
  const n = Number(bytes) || 0;
  return n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
