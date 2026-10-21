// Piezas de pantalla que usan varias vistas: barras de arriba, campos del formulario (horas, PK,
// Sí/No), la lista de lo que falta y el aviso de espera de las llamadas al servidor.

import { alReintentar } from './servidor.js';
import { esc, setPath, toast } from './util.js';
import { horaValida, textoBool, listaVias } from './validaciones.js';
import { estado, guardarPronto } from './estado.js';

export function barraSimple(titulo, volver) {
  return `
  <header class="barra">
    ${volver ? `<button class="btn-volver" data-action="ir" data-vista="${volver}">‹ Atrás</button>` : ''}
    <div class="barra-titulo">${titulo}</div>
  </header>`;
}

export function cabeceraParte(volver, textoVolver, titulo) {
  const p = estado.parte;
  return `
  <header class="barra ${p.tipo.toLowerCase()}">
    <button class="btn-volver" data-action="${volver}">‹ ${textoVolver}</button>
    <div class="barra-titulo">${titulo}</div>
    <span class="guardado" id="guardado"></span>
  </header>`;
}

export function refParte(p) {
  return `${p.tipo} · ${esc(p.ref)}${p.rev > 1 ? ` rev. ${p.rev}` : ''}`;
}

export function campo(etq, ruta, valor, extra = '') {
  return `<label class="campo"><span>${etq}</span><input data-bind="${ruta}" value="${esc(valor == null ? '' : valor)}" ${extra}></label>`;
}

/**
 * Horas con el teclado numérico en vez del reloj: se escriben las cifras («2330») y los dos
 * puntos salen solos. Al salir de la casilla se completa: «8» → 08:00, «830» → 08:30.
 */
export function campoHora(etq, ruta, valor) {
  return `<label class="campo"><span>${etq}</span><input inputmode="numeric" maxlength="5" placeholder="hh:mm"
    autocomplete="off" data-hora="${ruta}" value="${esc(valor || '')}"></label>`;
}

export function aplicarHora(el, final) {
  if (!estado.parte || estado.parte.estado !== 'borrador') return;
  let d = el.value.replace(/\D/g, '').slice(0, 4);
  if (final && d) {
    if (d.length <= 2) d = d.padStart(2, '0') + '00';
    else if (d.length === 3) d = `0${d}`;
  }
  el.value = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
  el.classList.toggle('mal', final && Boolean(el.value) && !horaValida(el.value));
  setPath(estado.parte, el.dataset.hora, el.value);
  const g = document.getElementById('guardado');
  if (g) g.textContent = 'Guardando…';
  guardarPronto();
}

/**
 * PK en dos casillas numéricas (km + metros), porque el teclado numérico del móvil no tiene «+».
 * Se guarda junto como «481+045».
 */
export function campoPk(etq, ruta, valor) {
  const [km = '', m = ''] = String(valor || '').split(/\s*[+.,/]\s*/);
  const attrs = `inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-pk="${ruta}"`;
  return `<div class="campo"><span>${etq}</span><div class="pk">
    <input ${attrs} data-pk-parte="km" value="${esc(km)}" placeholder="km" aria-label="${etq}: kilómetro">
    <b>+</b>
    <input ${attrs} data-pk-parte="m" value="${esc(m)}" placeholder="m" maxlength="3" aria-label="${etq}: metros"></div></div>`;
}

/** Junta las dos casillas del PK; al salir de la casilla de metros los completa a 3 cifras. */
export function aplicarPk(el, final) {
  if (!estado.parte || estado.parte.estado !== 'borrador') return;
  const caja = el.closest('.pk');
  const km = caja.querySelector('[data-pk-parte="km"]');
  const m = caja.querySelector('[data-pk-parte="m"]');
  km.value = km.value.replace(/\D/g, '');
  m.value = m.value.replace(/\D/g, '').slice(0, 3);
  if (final && m.value) m.value = m.value.padStart(3, '0');
  setPath(estado.parte, el.dataset.pk, km.value || m.value ? `${km.value}+${m.value.padStart(3, '0')}` : '');
  const g = document.getElementById('guardado');
  if (g) g.textContent = 'Guardando…';
  guardarPronto();
}

export function radio(ruta, valor, texto, actual, extra = '') {
  return `<label><input type="radio" name="${ruta}" value="${valor}" data-bind="${ruta}" ${extra} ${actual === valor ? 'checked' : ''}><span>${texto}</span></label>`;
}

/**
 * Casillas de vía: se pueden marcar varias. Salen con el mismo aspecto que los botones de elegir
 * una; el valor se guarda como «1, 2» (ver unirVias). `etiqueta` pone el texto de cada botón.
 */
export function casillasVias(ruta, valor, vias, { compacto = false, etiqueta = (v) => v } = {}) {
  const marcadas = listaVias(valor);
  return `<div class="segmentado${compacto ? ' compacto' : ''}">${vias.map((v) => `<label><input type="checkbox"
    data-vias-op="${ruta}" value="${v}" ${marcadas.includes(v) ? 'checked' : ''}><span>${etiqueta(v)}</span></label>`).join('')}</div>`;
}

/** Sí / No que vuelve a pintar la pantalla (para mostrar u ocultar lo que depende de la respuesta). */
export function siNo(ruta, v) {
  return `<div class="segmentado">${radio(ruta, 'si', 'Sí', textoBool(v), 'data-tipo="bool" data-rerender')}${radio(ruta, 'no', 'No', textoBool(v), 'data-tipo="bool" data-rerender')}</div>`;
}

export function opciones(ruta, lista, actual) {
  return `<div class="segmentado">${lista.map(([v, t]) => radio(ruta, v, t, actual, 'data-rerender')).join('')}</div>`;
}

export function vErrores() {
  return `
  <div class="capa" data-action="cerrar-errores"><div class="hoja" data-stop>
    <h2>Falta por completar</h2>
    <ul class="errores">
      ${estado.errores.map((e) => `<li><span>${esc(e.msg)}</span>${e.trabajo != null
    ? `<button class="btn mini" data-action="ir-trabajo" data-i="${e.trabajo}">Ir</button>` : ''}</li>`).join('')}
    </ul>
    <button class="btn primario" data-action="cerrar-errores">Entendido</button>
  </div></div>`;
}

/**
 * Ejecuta una llamada al servidor con un aviso de espera encima; si falla, avisa y devuelve null.
 * No vuelve a pintar la pantalla: así no se borra lo escrito en el formulario si hay que repetirlo.
 */
export async function conEspera(texto, fn) {
  const capa = document.createElement('div');
  capa.className = 'capa centro';
  capa.innerHTML = `<div class="hoja pequena"><div class="girando"></div><p>${esc(texto)}</p></div>`;
  document.body.append(capa);
  // Si Google tarda o falla, la app reintenta sola: que se vea que sigue trabajando.
  alReintentar((n, total) => {
    const p = capa.querySelector('p');
    if (p) p.innerHTML = `${esc(texto)}<br><small>El servidor tarda en responder. Intento ${n} de ${total}…</small>`;
  });
  document.body.classList.add('sin-scroll');
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 5000);
    return null;
  } finally {
    capa.remove();
    alReintentar(null);
    document.body.classList.toggle('sin-scroll',
      Boolean(estado.menu || estado.fotoVista || estado.preguntaOtro || estado.preguntaExtras || estado.errores.length || estado.procesando));
  }
}
