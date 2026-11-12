// Parte HERBICIDA (campaña de herbicida, como el papel): la pantalla del parte (jornada, personal,
// ocupaciones de vía, cómo se ha regado, casos SIOS, producto y caldo, medidas), la lista de casos
// (como la maqueta: se escriben seguidos los nº de SIOS del día y cada uno lleva ahí mismo sus fotos de
// antes y después, el medio y «¿Solo una parte?») y la ficha de cada caso para corregir sus datos.
// Los casos se guardan en p.trabajos: las fotos, la cola y «Corregir» funcionan como en INFRA.

import { esc, fmtNum } from './util.js';
import { faltasCaso, faltasOcupacion, mismoNombre } from './validaciones.js';
import {
  FASES_HER, MEDIOS_HER, MAX_PRODUCTOS, MOTIVOS_SIN_FOTOS, NOMBRE_MEDIO, calculosHerbicida, m2Caso, buscarCasos, codigoSios,
} from './modelo.js';
import { estado } from './estado.js';
import { cabeceraParte, refParte, campo, campoHora, campoPk, radio, casillasVias, siNo, vErrores } from './campos.js';
import { vPreguntaExtras } from './vista-extras.js';
import { vOtroForm, seccionMedidas } from './vista-parte.js';
import { bloqueSinTrabajos, campoMotivoLista, trabajoActual, vFotoGrande } from './vista-trabajo.js';
import { vOrigenFoto } from './vista-origen-foto.js';

const VIAS = ['1', '2', '3', '4', '5'];

/** Listas de la campaña que manda el servidor (vacías si no hay campaña o es una lista antigua). */
export function herbicidaCfg() {
  const h = (estado.config && estado.config.herbicida) || {};
  return { visible: Boolean(h.visible), casos: h.casos || [], productos: h.productos || [], maquinas: h.maquinas || [] };
}


// ---------- Parte ----------

export function vParteHer() {
  if (estado.verCasos) return vCasosHer();
  const p = estado.parte;
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido con-pie">
    ${estado.avisoCopia ? `<div class="aviso">${esc(estado.avisoCopia)}</div>` : ''}
    ${p.rectificaA ? `<div class="aviso">Corrección del parte (revisión ${p.rectificaA.rev}). Al enviarla, la oficina guardará las dos versiones.</div>` : ''}
    <section class="tarjeta">
      <h2>Jornada</h2>
      <label class="campo"><span>Fecha de la jornada</span><input type="date" data-bind="fecha" value="${esc(p.fecha)}"></label>
      <div class="campo"><span>Capataz · aplicador cualificado</span><div class="valor-fijo">${esc(p.capataz)}</div></div>
      ${bloqueSinTrabajos(p)}
    </section>

    ${seccionPersonal(p)}

    ${p.sinTrabajos ? `
    <section class="tarjeta">
      <p class="nota">Con «Jornada sin trabajos» solo hace falta el personal y el motivo. No se piden ocupaciones, casos, producto ni medidas antiincendios.</p>
    </section>` : `
    ${seccionOcupaciones(p)}
    ${seccionMedio(p)}
    ${seccionCasos(p)}
    ${seccionProducto(p)}
    ${seccionMedidas(p)}`}

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
  ${estado.errores.length ? vErrores() : ''}
  ${estado.preguntaExtras ? vPreguntaExtras() : ''}`;
}

/** Personal: el capataz es el aplicador cualificado; los demás, básicos autorizados. */
function seccionPersonal(p) {
  return `
    <section class="tarjeta">
      <h2>Personal <span class="contador">${p.personal.length}</span></h2>
      <ul class="lista-personas">
        ${p.personal.map((x, i) => `
        <li><div><strong>${esc(x.nombre)}</strong> <span class="mini">${mismoNombre(x.nombre, p.capataz) ? 'Cualificado' : 'Básico'}</span>${x.otro ? ' <span class="mini">añadido</span>' : ''}
          <br><small>${esc([x.empresa, x.categoria, x.habilitacion].filter(Boolean).join(' · '))}</small></div>
          <button class="btn-quitar" data-action="quitar-persona" data-i="${i}" aria-label="Quitar a ${esc(x.nombre)}">✕</button></li>`).join('')}
      </ul>
      <p class="nota">El capataz es el aplicador cualificado; los demás van como básicos autorizados.</p>
      <button class="btn secundario" data-action="copiar-personal">Copiar el personal del último parte</button>
      <label class="campo"><span>Añadir de la lista</span>
        <input type="search" id="buscar-persona" placeholder="Escribe un nombre o una empresa" autocomplete="off" value="${esc(estado.busqueda)}"></label>
      <div id="resultados" class="resultados"></div>
      ${estado.otroAbierto ? vOtroForm() : '<button class="btn secundario" data-action="abrir-otro">+ Añadir a alguien que no está en la lista</button>'}
    </section>`;
}

function seccionOcupaciones(p) {
  const fichas = p.ocupaciones.map((o, i) => {
    const b = `ocupaciones.${i}`;
    const faltas = faltasOcupacion(o);
    return `
      <div class="sub-tarjeta ocupacion">
        <div class="tajo-cab"><h3>Ocupación ${i + 1}</h3>
          <button class="btn-quitar" data-action="quitar-ocupacion" data-i="${i}" aria-label="Quitar la ocupación ${i + 1}">✕</button></div>
        <div class="dos">${campo('Nº acta', `${b}.acta`, o.acta, 'inputmode="numeric" autocomplete="off"')}
          ${campo('Nº telefonema', `${b}.telefonema`, o.telefonema, 'inputmode="numeric" autocomplete="off"')}</div>
        <div class="dos">${campoHora('Entrada en vía', `${b}.entrada`, o.entrada)}${campoHora('Salida de vía', `${b}.salida`, o.salida)}</div>
        ${campo('Línea', `${b}.linea`, o.linea, 'inputmode="numeric" autocomplete="off" placeholder="Ej.: 040"')}
        <div class="campo"><span>Vía <small>(marca todas las que uses)</small></span>${casillasVias(`${b}.via`, o.via, VIAS, { compacto: true })}</div>
        <div class="dos">${campoPk('PK inicio', `${b}.pkInicio`, o.pkInicio)}${campoPk('PK fin', `${b}.pkFin`, o.pkFin)}</div>
        <div class="campo"><span>¿Terminada?</span>${siNo(`${b}.terminada`, o.terminada)}</div>
        ${faltas.length ? `<p class="falta">Falta: ${esc(faltas.map((f) => f.corto).join(', '))}</p>` : ''}
      </div>`;
  }).join('');
  return `
    <section class="tarjeta">
      <h2>Ocupaciones de vía <span class="contador">${p.sinOcupacion ? 0 : p.ocupaciones.length}</span></h2>
      <label class="check"><input type="checkbox" data-bind="sinOcupacion" data-rerender ${p.sinOcupacion ? 'checked' : ''}>
        <span>Hoy no se ha ocupado la vía</span></label>
      ${p.sinOcupacion ? `
      <div class="dos">${campoHora('Hora de inicio', 'horaInicio', p.horaInicio)}${campoHora('Hora de fin', 'horaFin', p.horaFin)}</div>` : `
      ${fichas}
      <button class="btn anadir" data-action="nueva-ocupacion">${p.ocupaciones.length ? '+ Añadir otra ocupación' : '+ Añadir ocupación de vía'}</button>
      <p class="nota">Como en el papel: una ficha por acta.</p>`}
    </section>`;
}

function seccionMedio(p) {
  const maquinas = herbicidaCfg().maquinas;
  const m = p.maquinaHer || { descripcion: '', otro: false };
  const k = m.otro ? -1 : maquinas.findIndex((x) => x.descripcion === m.descripcion);
  const otra = m.otro || (m.descripcion && k < 0);
  const elegir = !p.usaMaquina ? '' : maquinas.length ? `
      <div class="campo"><span>Máquina <small>(opcional)</small></span>
        <select data-maqher aria-label="Máquina">
          <option value="">Elige la máquina…</option>
          ${maquinas.map((x, j) => `<option value="${j}" ${j === k ? 'selected' : ''}>${esc(x.descripcion)}</option>`).join('')}
          <option value="otro" ${otra ? 'selected' : ''}>Otra (escribirla)</option>
        </select>
        ${otra ? `<input data-bind="maquinaHer.descripcion" value="${esc(m.descripcion)}" placeholder="Escribe la máquina" autocomplete="off">` : ''}
      </div>` : campo('Máquina <small>(opcional)</small>', 'maquinaHer.descripcion', m.descripcion, 'autocomplete="off" placeholder="Escribe la máquina"');
  return `
    <section class="tarjeta">
      <h2>¿Cómo se ha regado? <span class="oblig">obligatorio</span></h2>
      <div class="checks-fila">
        <label class="check"><input type="checkbox" data-bind="usaMochila" data-rerender ${p.usaMochila ? 'checked' : ''}><span>Mochila</span></label>
        <label class="check"><input type="checkbox" data-bind="usaMaquina" data-rerender ${p.usaMaquina ? 'checked' : ''}><span>Máquina</span></label>
      </div>
      ${elegir}
      <p class="nota">${p.usaMochila && p.usaMaquina ? 'Con las dos marcadas, en cada caso eliges mochila, máquina o ambas.'
    : p.usaMochila || p.usaMaquina ? `Todos los casos de hoy van con ${p.usaMochila ? 'mochila' : 'máquina'}. Si usaste las dos cosas, marca las dos.`
      : 'Marca mochila, máquina o las dos.'}</p>
    </section>`;
}

/** En el parte, solo el resumen: los casos se escriben y se completan en su lista (vCasosHer). */
function seccionCasos(p) {
  const c = calculosHerbicida(p);
  const incompletos = p.trabajos.filter((t) => faltasCaso(t, p).length).length;
  return `
    <section class="tarjeta">
      <h2>Casos SIOS regados <span class="contador">${p.trabajos.length}</span></h2>
      ${p.trabajos.length ? `
      <p><strong>${p.trabajos.length} caso(s) · ${fmtNum(c.m2)} m²</strong></p>
      <p class="nota">SIOS ${p.trabajos.map((t) => esc(t.referencia.codigo || '¿?')).join(' · ')}</p>
      ${incompletos ? `<p class="falta">${incompletos === 1 ? '1 caso sin completar' : `${incompletos} casos sin completar`} (fotos o datos)</p>` : '<p class="listo">Todos completos ✓</p>'}`
    : '<p class="nota">Escribe los nº de SIOS regados hoy y haz a cada uno sus fotos de antes y después.</p>'}
      <button class="btn primario" data-action="abrir-casos">${p.trabajos.length ? 'Ver y añadir casos SIOS' : '+ Añadir casos SIOS'}</button>
    </section>`;
}

// ---------- Lista de casos ----------

/** Casos sin todas sus fotos (los marcados «sin fotos» no cuentan). */
function casosSinFotos(p) {
  return p.trabajos.filter((t) => !t.sinFotos && FASES_HER.some(([f]) => !t.fotos.some((x) => x.fase === f))).length;
}

function vCasosHer() {
  const p = estado.parte;
  const c = calculosHerbicida(p);
  const sinFotos = casosSinFotos(p);
  return `
  ${cabeceraParte('cerrar-casos', 'Parte', `Casos SIOS · ${esc(p.ref)}`)}
  <main class="contenido con-pie">
    <section class="tarjeta">
      <h2>Casos SIOS regados <span class="contador">${p.trabajos.length}</span></h2>
      <label class="campo buscar-sios"><span>Escribe el nº de cada caso regado hoy</span>
        <input id="buscar-sios" inputmode="numeric" autocomplete="off" placeholder="nº SIOS (3 o 4 cifras)"
          value="${esc(estado.buscaSios)}" ${p.trabajos.length ? '' : 'data-autofocus'}></label>
      <div id="casos-sugeridos" class="resultados"></div>
      ${p.trabajos.length ? `<p class="nota"><strong>${p.trabajos.length} caso(s) · ${fmtNum(c.m2)} m²</strong> · ${sinFotos
    ? `<span class="falta">faltan fotos en ${sinFotos === 1 ? '1 caso' : `${sinFotos} casos`}</span>` : '<span class="listo">fotos completas ✓</span>'}</p>` : ''}
    </section>
    ${p.trabajos.length ? p.trabajos.map(filaCaso).join('') : '<p class="vacio">Todavía ninguno. Escribe arriba el nº del primer caso.</p>'}
  </main>
  <footer class="pie"><button class="btn primario grande" data-action="cerrar-casos">Volver al parte</button></footer>
  <input type="file" id="in-camara" accept="image/*" capture="environment" hidden>
  <input type="file" id="in-galeria" accept="image/*" multiple hidden>
  ${estado.fotoVista ? vFotoGrande() : ''}
  ${estado.origenFoto ? vOrigenFoto() : ''}`;
}

/** Un caso de la lista: fotos de antes y después (cámara o galería), medio, «¿Solo una parte?» y lo que falta. */
function filaCaso(t, i) {
  const p = estado.parte;
  const b = `trabajos.${i}`;
  const faltas = faltasCaso(t, p);
  const ubic = [t.linea && `L${t.linea}`, t.via, t.pkInicio && `PK ${t.pkInicio}${t.pkFin ? ` – ${t.pkFin}` : ''}`, t.ubicacion]
    .filter(Boolean).join(' · ');
  const fases = FASES_HER.map(([f, txt]) => {
    const n = t.fotos.filter((x) => x.fase === f).length;
    return `
      <div class="fase-caso ${n ? 'hecha' : t.sinFotos ? '' : 'sin-foto'}">
        <span class="fase-caso-txt">${txt}${n ? ` ✓${n > 1 ? ` ${n}` : ''}` : ''}</span>
        <button class="btn mini secundario" data-action="foto" data-i="${i}" data-fase="${f}" data-origen="camara" aria-label="${txt}: hacer foto">📷</button>
        <button class="btn mini secundario" data-action="foto" data-i="${i}" data-fase="${f}" data-origen="galeria" aria-label="${txt}: elegir de la galería">🖼️</button>
      </div>`;
  }).join('');
  return `
    <section class="tarjeta caso-her ${faltas.length ? 'incompleto' : 'completo'}">
      <div class="tajo-cab"><h3>${faltas.length ? `${i + 1}.` : '✓'} SIOS ${esc(t.referencia.codigo || '¿?')}</h3>
        <span class="caso-m2">${fmtNum(m2Caso(t))} m²</span></div>
      ${ubic ? `<p class="nota">${esc(ubic)}</p>` : ''}
      ${t.deLista && !t.desbroce ? '<p class="falta">⚠ En la lista a este caso le falta el desbroce.</p>' : ''}
      <div class="fotos-caso">${fases}</div>
      ${t.fotos.length ? `<div class="miniaturas">${t.fotos.map((x) => `
        <button class="mini-foto" data-action="ver-foto" data-id="${x.id}"><img data-foto-id="${x.id}" alt="Foto ${x.fase === 'antes' ? 'antes' : 'después'}"></button>`).join('')}</div>` : ''}
      ${t.sinFotos ? `<p class="falta">Sin fotos: ${esc(t.motivoSinFotos || 'falta el motivo')}</p>` : ''}
      ${p.usaMochila && p.usaMaquina ? `<div class="segmentado">${MEDIOS_HER.map(([v, txt]) => radio(`${b}.medio`, v, txt, t.medio)).join('')}</div>` : ''}
      <label class="check"><input type="checkbox" data-bind="${b}.parcial" data-rerender ${t.parcial ? 'checked' : ''}>
        <span>¿Solo una parte?</span></label>
      ${t.parcial ? campo(`m² hechos${t.superficie ? ` <small>(de ${esc(fmtNum(t.superficie))})</small>` : ''}`, `${b}.m2Hechos`, t.m2Hechos, 'inputmode="decimal" autocomplete="off"') : ''}
      ${faltas.length ? `<p class="falta">Falta: ${esc(faltas.map((f) => f.corto).join(', '))}</p>` : ''}
      <div class="fila-botones">
        <button class="btn secundario" data-action="editar-trabajo" data-i="${i}">Más datos ›</button>
        <button class="btn peligro-texto" data-action="borrar-trabajo" data-i="${i}">Quitar</button>
      </div>
    </section>`;
}

function seccionProducto(p) {
  const lista = herbicidaCfg().productos;
  const filas = p.productos.map((x, i) => {
    const k = x.otro ? -1 : lista.findIndex((y) => y.nombre === x.nombre);
    const otro = x.otro || (x.nombre && k < 0);
    const nombre = lista.length ? `
          <select data-producto="${i}" aria-label="Producto ${i + 1}">
            <option value="">Elige el producto…</option>
            ${lista.map((y, j) => `<option value="${j}" ${j === k ? 'selected' : ''}>${esc(y.nombre)}</option>`).join('')}
            <option value="otro" ${otro ? 'selected' : ''}>Otro (escribirlo)</option>
          </select>
          ${otro ? `<input data-bind="productos.${i}.nombre" value="${esc(x.nombre)}" placeholder="Escribe el producto" autocomplete="off">` : ''}`
      : `<input data-bind="productos.${i}.nombre" value="${esc(x.nombre)}" placeholder="Nombre del producto" autocomplete="off" aria-label="Producto ${i + 1}">`;
    return `
      <div class="sub-tarjeta producto">
        <div class="tajo-cab"><h3>Producto ${i + 1}</h3>
          ${p.productos.length > 1 ? `<button class="btn-quitar" data-action="quitar-producto" data-i="${i}" aria-label="Quitar el producto ${i + 1}">✕</button>` : ''}</div>
        <div class="campo"><span>Producto</span>${nombre}</div>
        ${campo('Dosis (ml por litro de caldo)', `productos.${i}.dosis`, x.dosis, 'inputmode="decimal" autocomplete="off"')}
      </div>`;
  }).join('');
  return `
    <section class="tarjeta">
      <h2>Producto y caldo <span class="oblig">obligatorio</span></h2>
      ${filas}
      ${p.productos.length < MAX_PRODUCTOS ? '<button class="btn secundario" data-action="nuevo-producto">+ Añadir otro producto (mezcla)</button>' : ''}
      ${campo('Caldo gastado en todo el parte (litros)', 'caldo', p.caldo, 'inputmode="decimal" autocomplete="off"')}
      <div class="calculos" id="calc-her">${textoCalculos(p)}</div>
      <p class="nota">Tú pones la dosis y los litros de caldo; el resto lo calcula la app con los m² de los casos.</p>
      <label class="check"><input type="checkbox" data-bind="confirmaCantidades" ${p.confirmaCantidades ? 'checked' : ''}>
        <span><strong>El aplicador confirma que son las cantidades reales</strong></span></label>
    </section>`;
}

/** Cálculos automáticos (se repintan al escribir la dosis o el caldo, sin volver a pintar la pantalla). */
export function textoCalculos(p) {
  const c = calculosHerbicida(p);
  const medios = Object.entries(c.porMedio).filter(([, v]) => v).map(([k, v]) => `${NOMBRE_MEDIO[k]} ${fmtNum(v)} m²`).join(' · ');
  return `
    <p><strong>${fmtNum(c.m2)} m²</strong> (${fmtNum(c.ha)} ha)${medios ? ` · ${esc(medios)}` : ''}</p>
    <p>Caldo por hectárea: <strong>${fmtNum(c.caldoHa)} L/ha</strong></p>
    ${c.productos.map((x) => `<p>${esc(x.nombre)}: <strong>${fmtNum(x.total)} L</strong> en total · <strong>${fmtNum(x.porHa)} L/ha</strong></p>`).join('')}`;
}

export function pintarCalculosHer() {
  const el = document.getElementById('calc-her');
  if (el && estado.parte && estado.parte.tipo === 'HERBICIDA') el.innerHTML = textoCalculos(estado.parte);
}

// ---------- Ficha de un caso SIOS ----------
// Se abre con «Más datos» desde la lista (o al añadir a mano un nº que no está en la lista de la campaña).

export function vCasoHer() {
  const p = estado.parte;
  const i = estado.trabajoIdx;
  const t = trabajoActual();
  const b = `trabajos.${i}`;
  const dos = p.usaMochila && p.usaMaquina;
  return `
  ${cabeceraParte('volver-parte', 'Casos', `Caso ${i + 1} · ${esc(p.ref)}`)}
  <main class="contenido con-pie">
    <section class="tarjeta">
      <h2>Caso SIOS</h2>
      <label class="campo"><span>Nº de SIOS <span class="oblig">obligatorio</span></span>
        <input id="buscar-caso" inputmode="numeric" autocomplete="off" data-bind="${b}.referencia.codigo" value="${esc(t.referencia.codigo)}"
          placeholder="Escribe 3 o 4 cifras" ${t.referencia.codigo ? '' : 'data-autofocus'}></label>
      <div id="casos-sugeridos" class="resultados"></div>
      ${t.fotos.length ? '<p class="nota">Las fotos ya hechas conservan el nº con el que se hicieron.</p>' : ''}
    </section>

    <section class="tarjeta">
      <h2>Ubicación</h2>
      ${t.deLista ? '<p class="nota">Datos de la lista de la campaña. Si algo no cuadra, cámbialo.</p>' : ''}
      ${t.deLista && !t.desbroce ? '<p class="falta">⚠ En la lista a este caso le falta el desbroce.</p>' : ''}
      <div class="dos">${campo('Línea', `${b}.linea`, t.linea, 'inputmode="numeric" autocomplete="off" placeholder="Ej.: 040"')}
        ${campo('Vía', `${b}.via`, t.via, 'autocomplete="off" placeholder="Ej.: V1 / V2"')}</div>
      <div class="dos">${campoPk('PK inicio', `${b}.pkInicio`, t.pkInicio)}${campoPk('PK fin', `${b}.pkFin`, t.pkFin)}</div>
      <div class="dos">${campo('m² del caso', `${b}.superficie`, t.superficie, 'inputmode="decimal" autocomplete="off"')}
        ${campo('Zona <small>(opcional)</small>', `${b}.ubicacion`, t.ubicacion, 'autocomplete="off"')}</div>
    </section>

    <section class="tarjeta">
      <h2>Riego</h2>
      ${dos ? `<div class="campo"><span>¿Con qué se ha regado este caso? <span class="oblig">obligatorio</span></span>
        <div class="segmentado">${MEDIOS_HER.map(([v, txt]) => radio(`${b}.medio`, v, txt, t.medio)).join('')}</div></div>`
    : `<p class="nota">${p.usaMochila ? 'Con mochila' : p.usaMaquina ? 'Con máquina' : 'Marca en el parte cómo se ha regado (mochila o máquina).'}</p>`}
      <label class="check"><input type="checkbox" data-bind="${b}.parcial" data-rerender ${t.parcial ? 'checked' : ''}>
        <span>¿Solo una parte? <small>(apunta los m² hechos)</small></span></label>
      ${t.parcial ? campo(`m² hechos${t.superficie ? ` <small>(de ${esc(fmtNum(t.superficie))})</small>` : ''}`, `${b}.m2Hechos`, t.m2Hechos, 'inputmode="decimal" autocomplete="off"') : ''}
    </section>

    <section class="tarjeta">
      <h2>Fotos</h2>
      <p class="nota">${t.sinFotos ? 'Opcionales: has marcado que no se han podido hacer fotos.'
    : 'Obligatorio: al menos una de <strong>antes</strong> y una de <strong>después</strong>.'} Cada foto lleva el nº de SIOS, la fecha y la hora.</p>
      ${FASES_HER.map(([f, txt]) => {
    const fs = t.fotos.filter((x) => x.fase === f);
    return `
      <div class="fase">
        <div class="fase-cab"><strong>${txt}</strong> <span class="contador">${fs.length}</span>${t.sinFotos ? '' : '<span class="oblig">mín. 1</span>'}</div>
        <div class="fila-botones">
          <button class="btn secundario" data-action="foto" data-fase="${f}" data-origen="camara">📷 Cámara</button>
          <button class="btn secundario" data-action="foto" data-fase="${f}" data-origen="galeria">🖼️ Galería</button>
        </div>
        ${fs.length ? `<div class="miniaturas">${fs.map((x) => `
          <button class="mini-foto" data-action="ver-foto" data-id="${x.id}"><img data-foto-id="${x.id}" alt="Foto ${txt.toLowerCase()}"></button>`).join('')}</div>` : ''}
      </div>`;
  }).join('')}
      <label class="check"><input type="checkbox" data-bind="${b}.sinFotos" data-rerender ${t.sinFotos ? 'checked' : ''}>
        <span>No se han podido hacer fotos</span></label>
      ${t.sinFotos ? `
      ${campoMotivoLista('¿Por qué?', b, t, 'motivoSinFotos', 'sinFotosOtro', MOTIVOS_SIN_FOTOS)}
      <p class="falta">Saldrá en rojo en el PDF y en el correo para que la oficina lo vea.</p>` : ''}
    </section>

    <button class="btn peligro-texto" data-action="borrar-trabajo">Eliminar este caso</button>
  </main>
  <footer class="pie"><button class="btn primario grande" data-action="trabajo-listo">Listo</button></footer>
  <input type="file" id="in-camara" accept="image/*" capture="environment" hidden>
  <input type="file" id="in-galeria" accept="image/*" multiple hidden>
  ${estado.fotoVista ? vFotoGrande() : ''}
  ${estado.origenFoto ? vOrigenFoto() : ''}`;
}

/**
 * Propuestas de la lista de la campaña mientras se escribe el nº de SIOS (sin volver a pintar la
 * pantalla, para no perder el teclado). En la lista de casos, tocar una añade el caso; en la ficha
 * de un caso, lo rellena.
 */
export function pintarCasos() {
  const cont = document.getElementById('casos-sugeridos');
  if (!cont || !estado.parte || estado.parte.tipo !== 'HERBICIDA') return;
  const lista = herbicidaCfg().casos;
  if (document.getElementById('buscar-sios')) { cont.innerHTML = propuestasLista(lista); return; }
  const t = trabajoActual();
  if (!t) return;
  const escrito = String(t.referencia.codigo || '').trim();
  if (!lista.length) {
    cont.innerHTML = escrito ? '<p class="vacio">La lista de casos de la campaña no está en este móvil: rellena los datos a mano (o Menú → Actualizar la lista de la oficina).</p>' : '';
    return;
  }
  const encontrados = buscarCasos(lista, escrito);
  // Si ya está elegido justo ese caso, no hace falta proponer nada.
  if (t.deLista && encontrados.length === 1 && String(encontrados[0].caso) === escrito) { cont.innerHTML = ''; return; }
  // SIOS ya puestos en los OTROS casos del parte (el que se está escribiendo no cuenta).
  const usados = new Map(estado.parte.trabajos.map((x, k) => [String(x.referencia.codigo || '').trim(), k])
    .filter(([, k]) => k !== estado.trabajoIdx));
  cont.innerHTML = encontrados.length ? encontrados.map((c) => {
    const otro = usados.has(String(c.caso));
    return `
      <button class="resultado" data-action="elegir-caso" data-caso="${esc(c.caso)}">
        <span><strong>${esc(c.caso)}</strong> · L${esc(c.linea)} · ${esc(c.via)}</span>
        <small>${esc(c.pkInicio)} → ${esc(c.pkFin)} · ${esc(fmtNum(c.superficie))} m²${c.ubicacion ? ` · ${esc(c.ubicacion)}` : ''}</small>
        ${c.desbroce ? '' : '<small class="falta">⚠ falta el desbroce</small>'}
        ${otro ? `<small class="falta">Ya está en el caso ${usados.get(String(c.caso)) + 1}</small>` : ''}
      </button>`;
  }).join('') : escrito.replace(/\D/g, '').length >= 3 ? '<p class="vacio">No está en la lista de la campaña. Revisa el número o rellena los datos a mano.</p>' : '';
}

/** Buscador de la lista de casos: propuestas de la campaña y, si el nº no está, añadirlo a mano. */
function propuestasLista(lista) {
  const cifras = String(estado.buscaSios || '').replace(/\D/g, '');
  if (cifras.length < 3) return '';
  const usados = new Map(estado.parte.trabajos.map((x, k) => [codigoSios(x), k]));
  const encontrados = buscarCasos(lista, cifras);
  const exacto = encontrados.some((c) => String(c.caso).replace(/\D/g, '') === cifras);
  const mano = exacto || usados.has(cifras) ? ''
    : `<button class="btn secundario" data-action="anadir-caso-mano" data-caso="${esc(cifras)}">Añadir el SIOS ${esc(cifras)} a mano</button>`;
  if (!lista.length) return `<p class="vacio">La lista de casos de la campaña no está en este móvil (Menú → Actualizar la lista de la oficina).</p>${mano}`;
  if (!encontrados.length) return `<p class="vacio">No está en la lista de la campaña. Revisa el número.</p>${mano}`;
  return encontrados.map((c) => {
    const ya = usados.get(String(c.caso).replace(/\D/g, ''));
    return `
      <button class="resultado" data-action="anadir-caso" data-caso="${esc(c.caso)}">
        <span><strong>${esc(c.caso)}</strong> · L${esc(c.linea)} · ${esc(c.via)}</span>
        <small>${esc(c.pkInicio)} → ${esc(c.pkFin)} · ${esc(fmtNum(c.superficie))} m²${c.ubicacion ? ` · ${esc(c.ubicacion)}` : ''}</small>
        ${c.desbroce ? '' : '<small class="falta">⚠ falta el desbroce</small>'}
        ${ya != null ? `<small class="falta">Ya está en la lista (caso ${ya + 1})</small>` : ''}
      </button>`;
  }).join('') + mano;
}
