// Horas extra: opcionales, por persona del parte, con tipo (normales, nocturnas o festivas)
// y motivo opcional. Se guardan por nombre para que no se descoloquen al quitar a alguien.

import { esc, toast } from './util.js';
import { extrasDelParte } from './validaciones.js';
import { TIPOS_EXTRA } from './modelo.js';
import { estado, render, guardarPronto } from './estado.js';
import { radio } from './campos.js';

export const textoTotalExtras = (t) => (t ? `Total del equipo: <strong>${String(t).replace('.', ',')} h</strong>` : '');

/** La lista del personal para poner las horas, con el botón de «a todos» y el total. */
export function listaExtras(p) {
  const filas = p.personal.map((x, i) => {
    const e = p.extras.find((y) => y.nombre === x.nombre) || {};
    return `
      <div class="fila-extra">
        <strong>${esc(x.nombre)}</strong>
        <div class="extra-campos">
          <input inputmode="decimal" placeholder="Horas" autocomplete="off" data-extra="horas" data-i="${i}"
            value="${e.horas == null ? '' : esc(String(e.horas).replace('.', ','))}" aria-label="Horas extra de ${esc(x.nombre)}">
          <div class="segmentado compacto">${TIPOS_EXTRA.map(([v, t]) => `<label><input type="radio" name="extra-tipo-${i}" value="${v}" data-extra="tipo" data-i="${i}" ${e.tipo === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        </div>
        <input placeholder="Motivo (opcional)" data-extra="motivo" data-i="${i}" value="${esc(e.motivo || '')}" autocomplete="off">
      </div>`;
  }).join('');
  const total = extrasDelParte(p).reduce((s, e) => s + Number(e.horas), 0);
  return `
      <p class="nota">Pon las horas de cada persona que las haya hecho y elige el tipo. Deja en blanco a quien no tenga.</p>
      ${filas}
      ${p.personal.length > 1 ? '<button class="btn secundario" data-action="extras-a-todos">Poner las mismas horas a todos los que están en blanco</button>' : ''}
      <p class="nota" id="total-extras">${textoTotalExtras(total)}</p>`;
}

/** En el parte, solo si se ha contestado que sí (para revisarlas o cambiar a «No»). */
export function seccionExtras() {
  const p = estado.parte;
  const usa = p.usaExtras === true ? 'si' : p.usaExtras === false ? 'no' : '';
  return `
    <section class="tarjeta">
      <h2>Horas extra</h2>
      <div class="campo"><span>¿Ha habido horas extra?</span>
        <div class="segmentado">${radio('usaExtras', 'si', 'Sí', usa, 'data-tipo="bool" data-rerender')}${radio('usaExtras', 'no', 'No', usa, 'data-tipo="bool" data-rerender')}</div></div>
      ${p.usaExtras ? listaExtras(p) : ''}
    </section>`;
}

/** Al pulsar «Cerrar parte»: primero la pregunta y, si es que sí, la lista del personal. */
export function vPreguntaExtras() {
  const p = estado.parte;
  return `
  <div class="capa"><div class="hoja" data-stop>
    <h2>¿Ha habido horas extra?</h2>
    ${p.usaExtras ? `
    ${listaExtras(p)}
    <div class="fila-botones">
      <button class="btn secundario" data-action="extras-volver">Volver al parte</button>
      <button class="btn primario" data-action="extras-cerrar">Cerrar parte</button>
    </div>` : `
    <button class="btn primario grande" data-action="extras-si">Sí, apuntarlas</button>
    <button class="btn secundario grande" data-action="extras-no">No, cerrar el parte</button>
    <button class="btn enlace" data-action="extras-volver">Volver al parte</button>`}
  </div></div>`;
}

export function aplicarExtra(el) {
  const p = estado.parte;
  if (!p || p.estado !== 'borrador') return;
  const x = p.personal[Number(el.dataset.i)];
  if (!x) return;
  let e = p.extras.find((y) => y.nombre === x.nombre);
  if (!e) { e = { nombre: x.nombre, horas: null, tipo: '', motivo: '' }; p.extras.push(e); }
  if (el.dataset.extra === 'horas') {
    const n = parseFloat(el.value.replace(',', '.'));
    e.horas = Number.isFinite(n) && n > 0 ? n : null;
  }
  else if (el.dataset.extra === 'tipo') { if (el.checked) e.tipo = el.value; } else e.motivo = el.value;
  const tot = document.getElementById('total-extras');
  if (tot) tot.innerHTML = textoTotalExtras(extrasDelParte(p).reduce((s, y) => s + Number(y.horas), 0));
  guardarPronto();
}

/** Copia las horas y el tipo del primero que los tenga a quienes estén en blanco. */
export function extrasATodos() {
  const p = estado.parte;
  const base = extrasDelParte(p).find((e) => e.tipo);
  if (!base) return toast('Pon primero las horas y el tipo de una persona');
  let n = 0;
  for (const x of p.personal) {
    let e = p.extras.find((y) => y.nombre === x.nombre);
    if (e && Number(e.horas) > 0) continue;
    if (!e) { e = { nombre: x.nombre, horas: null, tipo: '', motivo: '' }; p.extras.push(e); }
    e.horas = base.horas;
    e.tipo = base.tipo;
    n++;
  }
  guardarPronto();
  render();
  toast(n ? `Puestas ${String(base.horas).replace('.', ',')} h ${base.tipo} a ${n} persona(s)` : 'Ya tenían todos horas puestas');
}
