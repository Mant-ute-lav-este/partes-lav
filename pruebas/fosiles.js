// «Partes fósiles»: los partes de ejemplo tal como los dejaba guardados en el móvil cada versión
// antigua de la app. Los capataces no desinstalan, así que en sus móviles conviven partes de
// muchas versiones; estas pruebas comprueban que se siguen abriendo, pintando y enviando.
//
// Se hacen quitando a los ejemplos de hoy lo que aún no existía en esa versión. Cronología sacada
// del historial de git (git log -S <campo> -- js):
//   0.6.0  maquinas, usaVehiculos (antes «usaMaquinaria» quería decir vehículos); trabajo.aparato
//   0.7.0  medidas, medidasOtrasSi, medidasOtras (antes solo el texto «antiincendios»)
//   0.8.0  usaExtras, extras
//   0.8.3  trabajo.horaInicio, trabajo.horaFin
//   0.9.1  trabajo.telefonema { numero, salida } (antes { numero, hora })
//   0.9.4  trabajo.tipoCoste
//   0.9.8  formato1
//   0.10.0 MAQUINARIA de vía (subtipo, maquinasVia, tajos, puestos)
//   0.11.0 locomotora y dresina
//   0.13.0 trabajo.noRealizado, motivoNoRealizado, sinFotos, motivoSinFotos
//   0.15.0 evb (vía y dresina)
//   0.20.0 sinTrabajos, motivoSinTrabajos
//   0.21.0 drp (vía)
// Antes de la 0.5.0 (2026-10-02, un solo día de pruebas) no hay partes guardados que importen.
// Las fotos tienen la misma forma desde la primera versión.

import * as ej from './ejemplos.js';

/** Versiones de las que se hacen fósiles: una por cada cambio de forma del parte. */
export const VERSIONES = ['0.5.0', '0.6.0', '0.7.0', '0.8.0', '0.8.3', '0.9.1', '0.9.4', '0.9.8', '0.10.0', '0.11.0', '0.13.0', '0.15.0', '0.20.0', '0.21.0'];

const num = (v) => v.split('.').map(Number);
/** ¿La versión `v` es anterior a `a`? */
export const antes = (v, a) => {
  const [x, y] = [num(v), num(a)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
};

function quitar(o, ...campos) { for (const c of campos) delete o[c]; }

/** El trabajo como lo guardaba la versión `v`. */
function trabajoFosil(t, v) {
  if (antes(v, '0.6.0')) quitar(t, 'aparato');
  if (antes(v, '0.8.3')) quitar(t, 'horaInicio', 'horaFin');
  if (antes(v, '0.9.1')) t.telefonema = { numero: t.telefonema.numero, hora: '08:05' };
  if (antes(v, '0.9.4')) quitar(t, 'tipoCoste');
  if (antes(v, '0.13.0')) quitar(t, 'noRealizado', 'motivoNoRealizado', 'sinFotos', 'motivoSinFotos');
  return t;
}

/**
 * El parte `p` (de ejemplos.js) como lo habría guardado la versión `v`, o null si en esa versión
 * aún no existía ese tipo de parte.
 */
export function fosil(p, v) {
  if (p.tipo === 'MAQUINARIA') {
    if (antes(v, '0.10.0')) return null;
    if (p.subtipo !== 'via' && antes(v, '0.11.0')) return null;
  }
  const f = structuredClone(p);
  f.id = crypto.randomUUID();
  f.app = { version: v };
  // Cada fósil con sus propios ids de foto: los ejemplos los repiten.
  for (const x of [...(f.trabajos || []).flatMap((t) => t.fotos), ...(f.formato1 || [])]) x.id = crypto.randomUUID();
  if (antes(v, '0.6.0')) {
    // Una sola tabla: «¿Se ha usado maquinaria?» guardaba en realidad los vehículos.
    f.usaMaquinaria = f.usaVehiculos;
    quitar(f, 'maquinas', 'usaVehiculos');
  }
  if (antes(v, '0.7.0')) quitar(f, 'medidas', 'medidasOtrasSi', 'medidasOtras');
  if (antes(v, '0.8.0')) quitar(f, 'usaExtras', 'extras');
  if (antes(v, '0.9.8')) quitar(f, 'formato1');
  if (antes(v, '0.15.0')) quitar(f, 'evb');
  if (antes(v, '0.20.0')) quitar(f, 'sinTrabajos', 'motivoSinTrabajos');
  if (antes(v, '0.21.0')) quitar(f, 'drp');
  if (f.trabajos) f.trabajos = f.trabajos.map((t) => trabajoFosil(t, v));
  // Un SUPER antiguo sin fotos de telefonema (la foto obligatoria llegó después): se dejan las que hay.
  return f;
}

/** Los 5 tipos de parte de ejemplo, con su nombre. */
export const TIPOS = [
  ['INFRA', () => ej.parteInfra()],
  ['SUPER', () => ej.parteSuper()],
  ['maquinaria de vía', () => ej.parteMaqVia()],
  ['locomotora', () => ej.parteLoco()],
  ['dresina', () => ej.parteLoco('dresina')],
];

/** Todos los fósiles: [{ v, nombre, p }] con p en estado «cerrado» (como sale de ejemplos.js). */
export function todos() {
  const r = [];
  for (const v of VERSIONES) {
    for (const [nombre, crear] of TIPOS) {
      const p = fosil(crear(), v);
      if (p) r.push({ v, nombre, p });
    }
  }
  return r;
}
