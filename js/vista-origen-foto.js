// Hoja «¿De dónde es la foto?» al tocar 🖼️ Galería. Según el móvil (ver modoOrigen en compartidas.js):
// 'directo' no hay hoja (se abre el selector como siempre); 'activado' ofrece «Fotos del móvil» y
// «Fotos de WhatsApp» (pasos para compartir desde WhatsApp); 'sinActivar' solo «Fotos del móvil» con
// la ayuda de dónde están las de WhatsApp y el aviso de que el envío directo se activará solo.

import { esc, FORMATO1 } from './util.js';
import { estado, render, guardarYa } from './estado.js';
import { fasesFoto, modoOrigen, esAndroid, esInstalada, crearPase, borrarPase } from './compartidas.js';

/** Abre el selector de fotos del móvil para la foto pendiente (hay que llamarlo en un toque del usuario). */
function abrirSelector(pendiente) {
  estado.fotoPendiente = pendiente;
  const input = document.getElementById('in-galeria');
  if (input) input.click();
}

/**
 * Al tocar Galería (de una fase o del formato): hoja de origen o, sin nada que elegir, el selector.
 * `modo` solo se pasa en las pruebas.
 */
export function abrirOrigenFoto(pendiente, modo = modoOrigen({ activo: estado.compartirActivo, instalada: esInstalada(), android: esAndroid() })) {
  if (modo === 'directo') { estado.origenFoto = null; abrirSelector(pendiente); return; }
  estado.origenFoto = { modo, paso: 'elige', pendiente };
  render();
}

export function origenFotoMovil() {
  const o = estado.origenFoto;
  if (!o) return;
  estado.origenFoto = null;
  render();
  abrirSelector(o.pendiente);
}

/**
 * «Fotos de WhatsApp»: enseña los pasos y guarda el pase (a dónde van y 5 minutos sin PIN). El parte se
 * guarda antes: al compartir, la app se recarga y lo lee del móvil.
 */
export async function origenFotoWhatsapp() {
  const o = estado.origenFoto;
  const p = estado.parte;
  if (!o || o.modo !== 'activado' || !p) return;
  o.paso = 'whatsapp';
  o.anadidas = false;
  render();
  await guardarYa();
  const t = !o.pendiente.formato && p.trabajos ? p.trabajos[estado.trabajoIdx] : null;
  if (!o.pendiente.formato && !t) return;
  await crearPase(o.pendiente.formato
    ? { parteId: p.id, formato: true }
    : { parteId: p.id, trabajoId: t.id, fase: o.pendiente.fase });
  // Si mientras se guardaba ya ha pulsado «Atrás» o «Hecho», el pase no se queda.
  if (estado.origenFoto !== o || o.paso !== 'whatsapp') await borrarPase();
}

export async function origenFotoVolver() {
  if (!estado.origenFoto) return;
  estado.origenFoto.paso = 'elige';
  render();
  await borrarPase();
}

/** «Hecho» en la pantalla de pasos: se acaba el pase. */
export async function origenFotoHecho() {
  estado.origenFoto = null;
  render();
  await borrarPase();
}

export function cerrarOrigenFoto() {
  estado.origenFoto = null;
  render();
}

/** «Trabajo 2 · Después», o el formato de protección en SUPER. */
function destinoTexto(pendiente) {
  if (pendiente.formato) return esc(FORMATO1);
  const p = estado.parte;
  const t = p && p.trabajos && p.trabajos[estado.trabajoIdx];
  if (!t) return '';
  const fase = fasesFoto(p, t).find(([f]) => f === pendiente.fase);
  return `Trabajo ${estado.trabajoIdx + 1}${fase ? ` · ${esc(fase[1])}` : ''}`;
}

export function vOrigenFoto() {
  const o = estado.origenFoto;
  let cuerpo;
  if (o.modo === 'activado' && o.paso === 'whatsapp') {
    cuerpo = `
    <h2>Fotos de WhatsApp</h2>
    ${o.anadidas ? '<p><strong>✓ Añadida.</strong> Comparte la siguiente o pulsa <strong>Hecho</strong>.</p>' : ''}
    <p class="nota">Irán a: <strong>${destinoTexto(o.pendiente)}</strong></p>
    <ol class="pasos">
      <li>Abre <strong>WhatsApp</strong> y busca la foto.</li>
      <li><strong>Mantén pulsada</strong> la foto y toca <strong>⋮</strong> (arriba a la derecha).</li>
      <li>Toca <strong>Compartir</strong>.</li>
      <li><strong>Desliza hasta ver Partes LAV</strong> y tócala.</li>
    </ol>
    <p class="nota">Se manda una foto cada vez: vuelve a esta app después de cada una.
      ¿Muchas fotos de golpe? Usa <strong>Fotos del móvil → Colecciones → WhatsApp</strong>.</p>
    <button class="btn primario grande" data-action="origen-foto-hecho">Hecho</button>
    <button class="btn" data-action="origen-foto-volver">‹ Atrás</button>`;
  } else if (o.modo === 'activado') {
    cuerpo = `
    <h2>¿De dónde es la foto?</h2>
    <button class="btn secundario grande" data-action="origen-foto-movil">🖼️ Fotos del móvil</button>
    <button class="btn secundario grande" data-action="origen-foto-whatsapp">💬 Fotos de WhatsApp</button>
    <button class="btn" data-action="origen-foto-cerrar">Cancelar</button>`;
  } else {
    cuerpo = `
    <h2>Elige las fotos</h2>
    <p>Las fotos de WhatsApp están en <strong>Colecciones → WhatsApp</strong>.</p>
    <button class="btn primario grande" data-action="origen-foto-movil">🖼️ Fotos del móvil</button>
    <p class="nota">El envío directo desde WhatsApp se activará solo: deja una noche el móvil cargando con WiFi.</p>
    <button class="btn" data-action="origen-foto-cerrar">Cancelar</button>`;
  }
  // En la pantalla de pasos, tocar fuera no la cierra: se acabaría el pase sin querer. Solo «Hecho» o «Atrás».
  const fuera = o.paso === 'whatsapp' ? '' : ' data-action="origen-foto-cerrar"';
  return `<div class="capa"${fuera}><div class="hoja" data-stop>${cuerpo}</div></div>`;
}
