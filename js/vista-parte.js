// Pantalla del parte de INFRA y SUPER (jornada, trabajos, personal, maquinaria y vehículos,
// medidas antiincendios, formato 1) y el cierre y borrado de cualquier parte.

import * as db from './db.js';
import { textoReferencia } from './pdf.js';
import { esc, normaliza, toast, isoLocal, fmtFecha, FORMATO1, MAX_FORMATO1 } from './util.js';
import { faltasTrabajo, validar, validarMaq, validarLD, subtipoDe } from './validaciones.js';
import { EQUIPOS, textoEquipo, persona, normalizarParte } from './modelo.js';
import {
  estado, ir, render, guardarYa, guardarPronto, catalogo, equiposCfg, indiceEquipo, medidasCfg,
} from './estado.js';
import { cabeceraParte, refParte, radio, vErrores } from './campos.js';
import { seccionExtras, vPreguntaExtras } from './vista-extras.js';
import { vParteMaq } from './vista-maquinaria.js';
import { vFotoGrande } from './vista-trabajo.js';

// ---------- Parte ----------

/** SUPER: foto(s) del formato con la protección de la vía. Opcional. */
export function seccionFormato1(p) {
  const fs = p.formato1 || [];
  const lleno = fs.length >= MAX_FORMATO1;
  return `
    <section class="tarjeta">
      <h2>Adjuntar ${esc(FORMATO1.toLowerCase())} <span class="contador">${fs.length}</span></h2>
      <p class="nota">Opcional. Si el trabajo lleva este formato, haz una foto de cada hoja (hasta ${MAX_FORMATO1}).</p>
      <div class="fila-botones">
        <button class="btn secundario" data-action="foto-formato" data-origen="camara" ${lleno ? 'disabled' : ''}>📷 Cámara</button>
        <button class="btn secundario" data-action="foto-formato" data-origen="galeria" ${lleno ? 'disabled' : ''}>🖼️ Galería</button>
      </div>
      ${fs.length ? `<div class="miniaturas">${fs.map((x) => `
        <button class="mini-foto" data-action="ver-foto" data-id="${x.id}"><img data-foto-id="${x.id}" alt="${esc(FORMATO1)}"></button>`).join('')}</div>` : ''}
    </section>`;
}

export function vParte() {
  if (estado.parte.tipo === 'MAQUINARIA') return vParteMaq();
  const p = normalizarParte(estado.parte);
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido con-pie">
    ${p.rectificaA ? `<div class="aviso">Corrección del parte (revisión ${p.rectificaA.rev}). Al enviarla, la oficina guardará las dos versiones.</div>` : ''}
    <section class="tarjeta">
      <h2>Jornada</h2>
      <label class="campo"><span>Fecha de la jornada</span><input type="date" data-bind="fecha" value="${esc(p.fecha)}"></label>
      ${p.tipo === 'INFRA' ? '' : `<label class="check"><input type="checkbox" data-bind="nocturna" ${p.nocturna ? 'checked' : ''}>
        <span>Jornada nocturna <small>(pon la fecha del día en que empezó)</small></span></label>`}
      <div class="campo"><span>Capataz</span><div class="valor-fijo">${esc(p.capataz)}</div></div>
    </section>

    <section class="tarjeta">
      <h2>Personal <span class="contador">${p.personal.length}</span></h2>
      <ul class="lista-personas">
        ${p.personal.map((x, i) => `
        <li><div><strong>${esc(x.nombre)}</strong>${x.otro ? ' <span class="mini">añadido</span>' : ''}
          <br><small>${esc([x.empresa, x.categoria, x.habilitacion].filter(Boolean).join(' · '))}</small></div>
          <button class="btn-quitar" data-action="quitar-persona" data-i="${i}" aria-label="Quitar a ${esc(x.nombre)}">✕</button></li>`).join('')}
      </ul>
      <button class="btn secundario" data-action="copiar-personal">Copiar el personal del último parte</button>
      <label class="campo"><span>Añadir de la lista</span>
        <input type="search" id="buscar-persona" placeholder="Escribe un nombre o una empresa" autocomplete="off" value="${esc(estado.busqueda)}"></label>
      <div id="resultados" class="resultados"></div>
      ${estado.otroAbierto ? vOtroForm() : '<button class="btn secundario" data-action="abrir-otro">+ Añadir a alguien que no está en la lista</button>'}
    </section>

    ${estado.parte.usaExtras && !estado.preguntaExtras ? seccionExtras() : ''}
    ${seccionEquipos('maquinas')}
    ${seccionEquipos('vehiculos')}

    <section class="tarjeta">
      <h2>Trabajos <span class="contador">${p.trabajos.length}</span></h2>
      ${p.trabajos.length ? '' : '<p class="nota">Añade cada trabajo de la jornada por separado, con sus fotos.</p>'}
      ${p.trabajos.map(resumenTrabajo).join('')}
      <button class="btn anadir" data-action="nuevo-trabajo">${p.trabajos.length ? '+ Añadir otro trabajo' : '+ Añadir trabajo'}</button>
    </section>

    <section class="tarjeta">
      <h2>Medidas antiincendios <span class="oblig">obligatorio</span></h2>
      <p class="nota">Marca todas las que se hayan tomado.</p>
      ${medidasCfg().map((m) => `<label class="check"><input type="checkbox" data-medida="${esc(m)}" ${p.medidas.includes(m) ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('')}
      <label class="check"><input type="checkbox" data-bind="medidasOtrasSi" data-rerender ${p.medidasOtrasSi ? 'checked' : ''}><span>Otras</span></label>
      ${p.medidasOtrasSi ? `<textarea data-bind="medidasOtras" rows="2" placeholder="Escribe las otras medidas">${esc(p.medidasOtras)}</textarea>` : ''}
    </section>

    ${p.tipo === 'SUPER' ? seccionFormato1(p) : ''}

    <section class="tarjeta">
      <h2>Observaciones</h2>
      <textarea data-bind="observaciones" rows="3" placeholder="Opcional">${esc(p.observaciones)}</textarea>
    </section>

    <button class="btn peligro-texto" data-action="borrar-parte">Borrar este borrador</button>
  </main>
  <footer class="pie"><div class="fila-botones">
    <button class="btn secundario grande" data-action="guardar-salir">Guardar y salir</button>
    <button class="btn primario grande" data-action="cerrar-parte">Cerrar parte</button>
  </div></footer>
  ${p.tipo === 'SUPER' ? `<input type="file" id="in-camara" accept="image/*" capture="environment" hidden>
  <input type="file" id="in-galeria" accept="image/*" multiple hidden>` : ''}
  ${estado.fotoVista ? vFotoGrande() : ''}
  ${estado.errores.length ? vErrores() : ''}
  ${estado.preguntaExtras ? vPreguntaExtras() : ''}`;
}

export function vOtroForm() {
  return `
  <div class="sub-tarjeta">
    <h3>Persona que no está en la lista</h3>
    <label class="campo"><span>Nombre y apellidos *</span><input id="otro-nombre" autocomplete="off" data-autofocus></label>
    <label class="campo"><span>Empresa</span><input id="otro-empresa" autocomplete="off"></label>
    <label class="campo"><span>Habilitación</span><input id="otro-habilitacion" autocomplete="off"></label>
    <label class="campo"><span>Categoría</span><input id="otro-categoria" autocomplete="off"></label>
    <div class="fila-botones">
      <button class="btn secundario" data-action="cancelar-otro">Cancelar</button>
      <button class="btn primario" data-action="anadir-otro">Añadir</button>
    </div>
  </div>`;
}

export function resumenTrabajo(t, i) {
  const ubic = [t.linea && `Línea ${t.linea}`, t.via && `vía ${t.via}`, t.aparato,
    t.pkInicio && `PK ${t.pkInicio}${t.pkFin ? ` – ${t.pkFin}` : ''}`].filter(Boolean).join(' · ');
  const n = (f) => t.fotos.filter((x) => x.fase === f).length;
  const fin = t.noRealizado ? `<span class="mini">No realizado${t.motivoNoRealizado ? ` · ${esc(t.motivoNoRealizado)}` : ''}</span>`
    : t.finalizado === true ? 'Finalizado' : t.finalizado === false ? 'Sin finalizar' : '¿Finalizado?';
  const sinFotos = !t.noRealizado && t.sinFotos ? ` · <span class="mini">Sin fotos${t.motivoSinFotos ? `: ${esc(t.motivoSinFotos)}` : ''}</span>` : '';
  const faltas = faltasTrabajo(t);
  return `
  <button class="item item-trabajo ${faltas.length ? 'incompleto' : 'completo'}" data-action="editar-trabajo" data-i="${i}">
    <span class="num">${faltas.length ? i + 1 : '✓'}</span>
    <span class="item-info"><strong>${esc(textoReferencia(t) || 'Sin referencia todavía')}</strong>
      ${ubic ? `<br><small>${esc(ubic)}</small>` : ''}
      <br><small>${fin} · fotos: ${n('antes')} antes, ${n('durante')} durante, ${n('despues')} después${sinFotos}</small>
      <br>${faltas.length
    ? `<small class="falta">Falta: ${esc(faltas.map((f) => f.corto).join(', '))}</small>`
    : '<small class="listo">Completo</small>'}</span>
    <span class="flecha">›</span>
  </button>`;
}

export function seccionEquipos(lista) {
  const p = estado.parte;
  const e = EQUIPOS[lista];
  const usa = p[e.usa] === true ? 'si' : p[e.usa] === false ? 'no' : '';
  const cfg = equiposCfg(lista);
  const filas = p[e.usa] ? p[lista].map((x, i) => {
    const k = indiceEquipo(lista, x);
    const otro = k < 0 && (x.otro || x.descripcion);
    return `
      <div class="fila-equipo">
        <div class="equipo-campos">
          <select data-lista="${lista}" data-i="${i}" aria-label="${e.titulo} ${i + 1}">
            <option value="">${e.elegir}</option>
            ${cfg.map((c, j) => `<option value="${j}" ${j === k ? 'selected' : ''}>${esc(textoEquipo(c))}</option>`).join('')}
            <option value="otro" ${otro ? 'selected' : ''}>${e.otra}</option>
          </select>
          ${otro ? `
          <input placeholder="${e.conMatricula ? 'Vehículo' : 'Máquina'}" data-bind="${lista}.${i}.descripcion" value="${esc(x.descripcion)}" autocomplete="off">
          ${e.conMatricula ? `<input placeholder="Matrícula" data-bind="${lista}.${i}.matricula" value="${esc(x.matricula)}" autocapitalize="characters" autocomplete="off">` : ''}` : ''}
        </div>
        <button class="btn-quitar" data-action="quitar-equipo" data-lista="${lista}" data-i="${i}" aria-label="Quitar">✕</button>
      </div>`;
  }).join('') : '';
  return `
    <section class="tarjeta">
      <h2>${e.titulo} <span class="oblig">obligatorio</span></h2>
      <div class="campo"><span>${e.pregunta}</span>
        <div class="segmentado">${radio(e.usa, 'si', 'Sí', usa, 'data-tipo="bool" data-rerender')}${radio(e.usa, 'no', 'No', usa, 'data-tipo="bool" data-rerender')}</div></div>
      ${p[e.usa] ? `${filas}<button class="btn secundario" data-action="nuevo-equipo" data-lista="${lista}">${e.anadir}</button>` : ''}
    </section>`;
}

export function pintarResultados() {
  const cont = document.getElementById('resultados');
  if (!cont || !estado.parte) return;
  const q = normaliza(estado.busqueda);
  if (!q) { cont.innerHTML = ''; return; }
  const ya = new Set(estado.parte.personal.map((x) => normaliza(x.nombre)));
  const res = catalogo()
    .filter((x) => !ya.has(normaliza(x.nombre)) && normaliza(`${x.nombre} ${x.empresa} ${x.categoria}`).includes(q))
    .slice(0, 30);
  cont.innerHTML = res.length
    ? res.map((x) => `
      <button class="resultado" data-action="anadir-persona" data-nombre="${esc(x.nombre)}">
        <strong>${esc(x.nombre)}</strong>
        <small>${esc([x.empresa, x.categoria].filter(Boolean).join(' · '))}${x.otro ? ' · añadido por ti' : ''}</small>
      </button>`).join('')
    : '<p class="vacio">No hay nadie con ese nombre. Usa «Añadir a alguien que no está en la lista».</p>';
}

export async function copiarPersonal() {
  const p = estado.parte;
  const previos = (await db.listarPartes())
    .filter((x) => x.id !== p.id && x.personal && x.personal.length)
    .sort((a, b) => `${b.fecha}${b.modificado}`.localeCompare(`${a.fecha}${a.modificado}`));
  if (!previos.length) return toast('No hay partes anteriores de los que copiar');
  const ya = new Set(p.personal.map((x) => normaliza(x.nombre)));
  let n = 0;
  for (const x of previos[0].personal) {
    if (!ya.has(normaliza(x.nombre))) { p.personal.push(persona(x)); ya.add(normaliza(x.nombre)); n++; }
  }
  guardarPronto();
  render();
  toast(n ? `${n} persona(s) copiadas del parte del ${fmtFecha(previos[0].fecha)}` : 'Ya estaban todos');
}

export async function anadirOtro() {
  const val = (id) => (document.getElementById(id) || {}).value || '';
  const x = persona({
    nombre: val('otro-nombre'), empresa: val('otro-empresa'),
    habilitacion: val('otro-habilitacion'), categoria: val('otro-categoria'), otro: true,
  });
  if (!x.nombre) return toast('Escribe al menos el nombre');
  if (estado.parte.personal.some((y) => normaliza(y.nombre) === normaliza(x.nombre))) return toast('Esa persona ya está en el parte');
  estado.parte.personal.push(x);
  estado.otros = [x, ...estado.otros.filter((y) => normaliza(y.nombre) !== normaliza(x.nombre))].slice(0, 60);
  await db.kvSet('otros', estado.otros);
  estado.otroAbierto = false;
  guardarPronto();
  render();
}

// ---------- Cierre y borrado del parte ----------

export async function cerrarParte() {
  await guardarYa();
  const maq = estado.parte.tipo === 'MAQUINARIA';
  const errores = !maq ? validar(estado.parte)
    : subtipoDe(estado.parte) === 'via' ? validarMaq(estado.parte) : validarLD(estado.parte);
  if (errores.length) {
    estado.errores = errores;
    render();
    return;
  }
  // Sin nadie en el parte de maquinaria no hay a quién poner horas extra.
  if (maq && !estado.parte.personal.length) estado.parte.usaExtras = false;
  // Las horas extra se preguntan al cerrar: Sí abre la lista del personal; No sigue cerrando.
  if (estado.parte.usaExtras == null) {
    estado.preguntaExtras = true;
    render();
    return;
  }
  if (!confirm('¿Cerrar el parte? Después ya no se puede cambiar: solo corregir con una revisión nueva.')) return;
  estado.parte.cierre = isoLocal();
  estado.parte.estado = 'cerrado';
  await guardarYa();
  ir('envio');
}

export async function borrarParte() {
  const p = estado.parte;
  if (!confirm('¿Borrar este borrador y sus fotos? No se puede deshacer.')) return;
  for (const f of await db.fotosDeParte(p.id)) await db.borrarFoto(f.id);
  await db.borrarParte(p.id);
  estado.parte = null;
  ir('inicio');
}
