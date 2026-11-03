// Fotos compartidas desde WhatsApp (u otra app): aviso en Inicio y hoja para elegir a qué trabajo y
// fase van. Las reglas están en compartidas.js; las fotos se añaden igual que desde Galería.

import * as db from './db.js';
import { esc, toast } from './util.js';
import {
  leerCompartidas, borrarCompartidas, quitarCompartida, tomarDescartadas, destinosFotos, MAX_COMPARTIDAS, MAX_MB_COMPARTIDA,
} from './compartidas.js';
import { estado, ir, render, guardarYa } from './estado.js';
import { anadirFotos } from './vista-trabajo.js';

const MINIATURAS = 4;
let colocando = false;   // un segundo toque mientras se colocan no las mete otra vez

/** Al entrar: si al compartir se quedó alguna fuera (no era foto, muy grande, demasiadas), se dice una vez. */
export async function avisarDescartadas() {
  const n = await tomarDescartadas();
  if (n) {
    toast(`${n === 1 ? '1 foto compartida no se ha podido guardar' : `${n} fotos compartidas no se han podido guardar`}. ` +
      `Solo valen fotos, de hasta ${MAX_MB_COMPARTIDA} MB y como mucho ${MAX_COMPARTIDAS} esperando a la vez.`, 7000);
  }
}

/** Aviso en Inicio mientras haya fotos esperando y la hoja esté cerrada. */
export function avisoCompartidas() {
  const n = estado.nCompartidas;
  if (!n || estado.compartidas) return '';
  return `
    <div class="aviso aviso-envio">
      <span>${n === 1 ? 'Tienes 1 foto compartida esperando' : `Tienes ${n} fotos compartidas esperando`}</span>
      <button class="btn secundario" data-action="compartidas-abrir">Colocarlas</button>
    </div>`;
}

export async function abrirCompartidas() {
  const fotos = await leerCompartidas();
  cerrarCompartidas(false);
  estado.nCompartidas = fotos.length;
  if (!fotos.length) return render();
  const destinos = destinosFotos(await db.listarPartes());
  // Con un solo trabajo posible (y con su referencia) no hace falta preguntar cuál.
  const unico = destinos.length === 1 && destinos[0].referencia ? destinos[0] : null;
  estado.compartidas = {
    destinos,
    elegido: unico,
    miniaturas: fotos.slice(0, MINIATURAS).map((x) => URL.createObjectURL(x.archivo)),
  };
  return render();
}

/** Cierra la hoja (las fotos siguen esperando) y suelta las miniaturas. */
export function cerrarCompartidas(pintar = true) {
  if (estado.compartidas) estado.compartidas.miniaturas.forEach((u) => URL.revokeObjectURL(u));
  estado.compartidas = null;
  if (pintar) render();
}

export function elegirTrabajoCompartidas(k) {
  const d = estado.compartidas && estado.compartidas.destinos[k];
  if (!d) return;
  if (!d.referencia) {
    toast('Ese trabajo aún no tiene la referencia, que sale en el sello. Ábrelo, ponla y vuelve aquí: las fotos te esperan.', 6000);
    return;
  }
  estado.compartidas.elegido = d;
  render();
}

export function otroTrabajoCompartidas() {
  if (!estado.compartidas) return;
  estado.compartidas.elegido = null;
  render();
}

export async function descartarCompartidas() {
  if (!confirm('¿Descartar estas fotos? Siguen en WhatsApp: puedes volver a compartirlas.')) return;
  await borrarCompartidas();
  estado.nCompartidas = 0;
  cerrarCompartidas();
}

/** Abre el trabajo elegido y le añade las fotos en la fase `fase`, como si vinieran de Galería. */
export async function colocarCompartidas(fase) {
  const d = estado.compartidas && estado.compartidas.elegido;
  if (colocando || !d || !d.fases.some(([f]) => f === fase)) return;
  colocando = true;
  try {
    const fotos = await leerCompartidas();
    const p = await db.getParte(d.parteId);
    const ti = p && p.estado === 'borrador' ? p.trabajos.findIndex((t) => t.id === d.trabajoId) : -1;
    if (ti < 0) {
      toast('Ese trabajo ya no está en un borrador. Elige otro.', 4000);
      await abrirCompartidas();
      return;
    }
    cerrarCompartidas(false);
    estado.nCompartidas = 0;
    if (!fotos.length) { render(); return; }
    estado.parte = p;
    estado.trabajoIdx = ti;
    await ir('trabajo');
    // Una a una: el parte se guarda con cada foto y solo entonces sale de la espera. Si la app se
    // cierra a medias, las colocadas no se repiten y las demás siguen esperando. Las que no se han
    // podido usar también salen (anadirFotos ya lo ha dicho y queda en la hoja Errores).
    await anadirFotos(fotos.map((x) => x.archivo), {
      fase,
      origen: 'galeria',
      trasCada: async (k) => { await guardarYa(); await quitarCompartida(fotos[k].id); },
    });
  } finally {
    colocando = false;
  }
}

export function vCompartidas() {
  const c = estado.compartidas;
  const n = estado.nCompartidas;
  const mas = n - c.miniaturas.length;
  const minis = `<div class="miniaturas">${c.miniaturas.map((u) => `<span class="mini-foto"><img src="${u}" alt="Foto compartida"></span>`).join('')}${mas > 0 ? `<span class="mini-foto mini-mas">+${mas}</span>` : ''}</div>`;
  let cuerpo;
  if (!c.destinos.length) {
    cuerpo = `<p>No tienes ningún parte INFRA o SUPER en borrador con trabajos.</p>
    <p class="nota">Crea el parte de hoy y añade el trabajo: las fotos te esperan aquí, en Inicio.</p>`;
  } else if (!c.elegido) {
    cuerpo = `<h3>¿De qué trabajo son?</h3>
    ${c.destinos.map((d, k) => `
    <button class="btn secundario opcion" data-action="compartidas-trabajo" data-k="${k}">${esc(d.ref)} · Trabajo ${d.ti + 1}
      <br><small>${d.referencia ? esc(d.referencia) : 'Falta la referencia'}</small></button>`).join('')}`;
  } else {
    const d = c.elegido;
    cuerpo = `<p class="nota">Van a <strong>${esc(d.ref)} · Trabajo ${d.ti + 1}</strong> · ${esc(d.referencia)}</p>
    <h3>¿Dónde van?</h3>
    ${d.fases.map(([f, txt]) => `<button class="btn secundario grande" data-action="compartidas-fase" data-fase="${f}">${esc(txt)}</button>`).join('')}
    ${c.destinos.length > 1 ? '<button class="btn enlace" data-action="compartidas-otro">Es de otro trabajo</button>' : ''}`;
  }
  return `
  <div class="capa" data-action="compartidas-cerrar"><div class="hoja" data-stop>
    <h2>${n === 1 ? '1 foto compartida' : `${n} fotos compartidas`}</h2>
    ${minis}
    ${cuerpo}
    <button class="btn" data-action="compartidas-cerrar">Ahora no</button>
    <button class="btn peligro-texto" data-action="compartidas-descartar">Descartar estas fotos</button>
  </div></div>`;
}
