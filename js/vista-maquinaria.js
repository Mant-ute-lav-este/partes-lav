// Pantallas de los partes de maquinaria: de vía (tajos con nivelado, alineado…), de locomotora
// (vagones y balasto) y de dresina (plataforma y telefonemas).

import { esc } from './util.js';
import { semanaIso, numeroValido, aNumero, faltasTajo, faltasRealizado, subtipoDe, puestosDe, puestosObligatorios, llevaEvb } from './validaciones.js';
import { MAX_TOLVA, MODOS_NIVELADO, MODOS_ALINEADO, CUANDO_REGISTRO, normalizarParte } from './modelo.js';
import { estado, maquinasDeVia, personalMaqCfg } from './estado.js';
import { cabeceraParte, refParte, campo, campoHora, campoPk, radio, siNo, opciones, vErrores, casillasVias } from './campos.js';
import { seccionExtras, vPreguntaExtras } from './vista-extras.js';

// ---------- Parte de maquinaria de vía ----------
// Sigue el orden del papel: jornada (fecha y horario), máquinas con sus horas, viaje, tajos,
// observaciones y personal por puesto. Normalmente es una máquina por noche, pero caben varias.

/** Una operación del tajo: Sí/No y, si es que sí, sus detalles. */
export function operacion(titulo, ruta, o, detalle) {
  return `
      <div class="operacion">
        <div class="campo"><span>${titulo}</span>${siNo(`${ruta}.si`, o.si)}</div>
        ${o.si ? detalle : ''}
      </div>`;
}

/** Nivelado o alineado: método y, si es calculado, el máximo en mm y su PK. */
export function detalleGeometria(ruta, o, modos, etqMax) {
  return `
        ${opciones(`${ruta}.modo`, modos, o.modo)}
        ${o.modo === 'calculado' ? `<div class="dos">
          ${campo(`${etqMax} (mm)`, `${ruta}.max`, o.max, 'inputmode="decimal" autocomplete="off"')}
          ${campoPk(`PK del ${etqMax.toLowerCase()}`, `${ruta}.pk`, o.pk)}</div>` : ''}`;
}

export function seccionTajo(t, i, total) {
  const b = `tajos.${i}`;
  const faltas = faltasTajo(t);
  return `
    <div class="sub-tarjeta tajo">
      <div class="tajo-cab"><h3>Tajo ${i + 1}</h3>
        ${total > 1 ? `<button class="btn-quitar" data-action="quitar-tajo" data-i="${i}" aria-label="Quitar el tajo ${i + 1}">✕</button>` : ''}</div>
      <div class="dos">${campoHora('Llegada a tajo', `${b}.llegada`, t.llegada)}${campoHora('Inicio de trabajo', `${b}.inicio`, t.inicio)}</div>
      <div class="dos">${campoHora('Fin de trabajo', `${b}.fin`, t.fin)}${campoHora('Salida de tajo', `${b}.salida`, t.salida)}</div>
      <div class="campo"><span>Vía <small>(marca todas las que uses)</small></span>
        ${casillasVias(`${b}.via`, t.via, ['1', '2', '3', '4', '5'], { etiqueta: (v) => `Vía ${v}`, compacto: true })}</div>
      <div class="dos">${campoPk('PK inicio', `${b}.pkInicio`, t.pkInicio)}${campoPk('PK final', `${b}.pkFin`, t.pkFin)}</div>
      ${campo('Nombre del desvío / AD <small>(opcional)</small>', `${b}.desvio`, t.desvio, 'autocomplete="off"')}
      ${operacion('Nivelado', `${b}.nivelado`, t.nivelado, detalleGeometria(`${b}.nivelado`, t.nivelado, MODOS_NIVELADO, 'Lev. máx.'))}
      ${operacion('Alineado', `${b}.alineado`, t.alineado, detalleGeometria(`${b}.alineado`, t.alineado, MODOS_ALINEADO, 'Rip. máx.'))}
      ${operacion('Estabilizado', `${b}.estabilizado`, t.estabilizado,
    `<div class="campo"><span>¿Programada?</span>${siNo(`${b}.estabilizado.programada`, t.estabilizado.programada)}</div>`)}
      ${operacion('Registro', `${b}.registro`, t.registro, `
        ${opciones(`${b}.registro.cuando`, CUANDO_REGISTRO, t.registro.cuando)}
        ${campo('Anotación <small>(opcional)</small>', `${b}.registro.texto`, t.registro.texto, 'autocomplete="off"')}`)}
      ${operacion('Perfilado', `${b}.perfilado`, t.perfilado,
    `<div class="campo"><span>Cepillado</span>${siNo(`${b}.perfilado.cepillado`, t.perfilado.cepillado)}</div>`)}
      ${faltas.length ? `<p class="falta">Falta: ${esc(faltas.map((f) => f.corto).join(', '))}</p>` : '<p class="listo">Tajo completo</p>'}
    </div>`;
}

/** Parte de vía: una sola máquina (se elige al crear el parte; aquí se puede cambiar por otra de vía). */
export function seccionMaquinasVia(p) {
  const cfg = maquinasDeVia();
  const filas = p.maquinasVia.map((m, i) => {
    const k = m.otro ? -1 : cfg.findIndex((c) => c.descripcion === m.descripcion);
    return `
      <div class="fila-equipo">
        <div class="equipo-campos">
          <select data-maqvia="${i}" aria-label="Máquina ${i + 1}">
            <option value="">Elige la máquina…</option>
            ${cfg.map((c, j) => `<option value="${j}" ${j === k ? 'selected' : ''}>${esc(c.descripcion)}${c.uic ? ` · UIC ${esc(c.uic)}` : ''}</option>`).join('')}
            <option value="otro" ${m.otro ? 'selected' : ''}>Otra (escribirla)</option>
          </select>
          ${m.otro ? `
          <input placeholder="Máquina" data-bind="maquinasVia.${i}.descripcion" value="${esc(m.descripcion)}" autocomplete="off">
          <input placeholder="Trabajo (bateo, perfilado…)" data-bind="maquinasVia.${i}.trabajo" value="${esc(m.trabajo)}" autocomplete="off">`
    : m.trabajo ? `<small>Trabajo: ${esc(m.trabajo)}</small>` : ''}
          ${campo('Horas', `maquinasVia.${i}.horas`, m.horas, 'inputmode="decimal" autocomplete="off"')}
        </div>
        ${p.maquinasVia.length > 1 ? `<button class="btn-quitar" data-action="quitar-maqvia" data-i="${i}" aria-label="Quitar la máquina ${i + 1}">✕</button>` : ''}
      </div>`;
  }).join('');
  return `
    <section class="tarjeta">
      <h2>Máquina <span class="oblig">obligatorio</span></h2>
      ${filas}
    </section>`;
}

/** Vía y dresina: ¿va en entrega de vía bloqueada? De eso dependen los puestos obligatorios. */
export function campoEvb(p) {
  return `<div class="campo"><span>¿Va en entrega de vía bloqueada (EVB)? <span class="oblig">obligatorio</span></span>${siNo('evb', p.evb)}</div>`;
}

export function seccionPersonalMaq(p) {
  const lista = personalMaqCfg();
  const oblig = puestosObligatorios(p);
  const sinEvb = llevaEvb(p) && p.evb !== true && p.evb !== false;
  const bloques = puestosDe(p).map(([clave, titulo, varios]) => {
    const gente = p.personal.map((x, i) => ({ x, i })).filter(({ x }) => x.puesto === clave);
    const filas = gente.map(({ x, i }) => `
        <div class="fila-equipo">
          <div class="equipo-campos">${x.otro
    ? `<input placeholder="Nombre y apellidos" data-bind="personal.${i}.nombre" value="${esc(x.nombre)}" autocomplete="off">`
    : `<strong>${esc(x.nombre)}</strong>`}</div>
          <button class="btn-quitar" data-action="quitar-persona" data-i="${i}" aria-label="Quitar a ${esc(x.nombre || titulo)}">✕</button>
        </div>`).join('');
    const anadir = varios || !gente.length ? `
        <select data-puesto="${clave}" aria-label="Añadir ${titulo}">
          <option value="">${gente.length ? '+ Añadir otro…' : 'Elige…'}</option>
          ${lista.map((c, j) => `<option value="${j}">${esc(c.nombre)}</option>`).join('')}
          <option value="otro">Otra persona (escribirla)</option>
        </select>` : '';
    return `<div class="campo"><span>${titulo}${oblig.includes(clave) ? ' <span class="oblig">obligatorio</span>' : ''}</span>${filas}${anadir}</div>`;
  }).join('');
  return `
    <section class="tarjeta">
      <h2>Personal <span class="contador">${p.personal.length}</span></h2>
      <p class="nota">${sinEvb ? 'Contesta arriba si va en EVB: de eso depende qué puestos son obligatorios.'
    : 'Elige quién ocupa cada puesto. Los que no son obligatorios pueden quedar vacíos.'}</p>
      ${bloques}
    </section>`;
}

export function vParteMaq() {
  if (subtipoDe(estado.parte) !== 'via') return vParteLD();
  const p = normalizarParte(estado.parte);
  const v = p.viaje;
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido con-pie">
    ${p.rectificaA ? `<div class="aviso">Corrección del parte (revisión ${p.rectificaA.rev}). Al enviarla, la oficina guardará las dos versiones.</div>` : ''}
    <section class="tarjeta">
      <h2>Jornada</h2>
      <label class="campo"><span>Fecha <small>(si es de noche, el día en que empieza)</small></span><input type="date" data-bind="fecha" value="${esc(p.fecha)}"></label>
      <div class="dos">${campoHora('Horario: inicio', 'horaInicio', p.horaInicio)}${campoHora('Horario: fin', 'horaFin', p.horaFin)}</div>
      ${campoEvb(p)}
      <div class="campo"><span>Lo rellena</span><div class="valor-fijo">${esc(p.capataz)}</div></div>
    </section>

    ${seccionMaquinasVia(p)}

    <section class="tarjeta">
      <h2>Viaje</h2>
      <div class="dos">${campoHora('Hora de salida', 'viaje.horaSalida', v.horaSalida)}
        ${campo('Lugar de salida', 'viaje.lugarSalida', v.lugarSalida, 'autocomplete="off"')}</div>
      <div class="dos">${campoHora('Hora de llegada', 'viaje.horaLlegada', v.horaLlegada)}
        ${campo('Lugar de llegada', 'viaje.lugarLlegada', v.lugarLlegada, 'autocomplete="off"')}</div>
    </section>

    <section class="tarjeta">
      <h2>Tajos <span class="contador">${p.tajos.length}</span></h2>
      ${p.tajos.map((t, i) => seccionTajo(t, i, p.tajos.length)).join('')}
      <button class="btn anadir" data-action="nuevo-tajo">+ Añadir tajo</button>
    </section>

    <section class="tarjeta">
      <h2>Observaciones</h2>
      <textarea data-bind="observaciones" rows="3" placeholder="Opcional">${esc(p.observaciones)}</textarea>
    </section>

    ${seccionPersonalMaq(p)}
    ${p.usaExtras && !estado.preguntaExtras ? seccionExtras() : ''}

    <button class="btn peligro-texto" data-action="borrar-parte">Borrar este borrador</button>
  </main>
  <footer class="pie"><div class="fila-botones">
    <button class="btn secundario grande" data-action="guardar-salir">Guardar y salir</button>
    <button class="btn primario grande" data-action="cerrar-parte">Cerrar parte</button>
  </div></footer>
  ${estado.errores.length ? vErrores() : ''}
  ${estado.preguntaExtras ? vPreguntaExtras() : ''}`;
}

// ---------- Partes de locomotora y de dresina ----------

export function seccionRealizado(r, i, total, loco) {
  const b = `realizados.${i}`;
  const faltas = faltasRealizado(r);
  return `
    <div class="sub-tarjeta tajo">
      <div class="tajo-cab"><h3>Trabajo ${i + 1}</h3>
        ${total > 1 ? `<button class="btn-quitar" data-action="quitar-realizado" data-i="${i}" aria-label="Quitar el trabajo ${i + 1}">✕</button>` : ''}</div>
      <div class="campo"><span>Vía <small>(marca todas las que uses)</small></span>
        ${casillasVias(`${b}.via`, r.via, ['1', '2', '3', '4', '5'], { etiqueta: (v) => `Vía ${v}`, compacto: true })}</div>
      <div class="dos">${campoPk('PK inicio', `${b}.pkInicio`, r.pkInicio)}${campoPk('PK fin', `${b}.pkFin`, r.pkFin)}</div>
      <div class="dos">${campoHora('Hora inicio', `${b}.horaInicio`, r.horaInicio)}${campoHora('Hora fin', `${b}.horaFin`, r.horaFin)}</div>
      ${campo('Trabajo', `${b}.trabajo`, r.trabajo, 'autocomplete="off"')}
      ${loco ? campo('m³ <small>(opcional)</small>', `${b}.m3`, r.m3, 'inputmode="decimal" autocomplete="off"') : ''}
      ${faltas.length ? `<p class="falta">Falta: ${esc(faltas.map((f) => f.corto).join(', '))}</p>` : '<p class="listo">Trabajo completo</p>'}
    </div>`;
}

export function seccionVagones(p) {
  const filas = p.vagones.map((v, i) => `
      <div class="sub-tarjeta">
        <div class="tajo-cab"><h3>Vagón ${i + 1}</h3>
          <button class="btn-quitar" data-action="quitar-vagon" data-i="${i}" aria-label="Quitar el vagón ${i + 1}">✕</button></div>
        <div class="segmentado">${radio(`vagones.${i}.tipo`, 'tolva', 'Tolva', v.tipo, 'data-rerender')}${radio(`vagones.${i}.tipo`, 'plataforma', 'Plataforma', v.tipo, 'data-rerender')}</div>
        <div class="dos">${campo('UIC (últimos 4 dígitos)', `vagones.${i}.uic`, v.uic, 'inputmode="numeric" maxlength="4" autocomplete="off"')}
          ${campo('Descargadas (m³)', `vagones.${i}.m3`, v.m3, 'inputmode="decimal" autocomplete="off"')}</div>
        ${v.tipo === 'tolva' && aNumero(v.m3) > MAX_TOLVA ? `<p class="falta">Más de ${MAX_TOLVA} m³ en una tolva: revísalo.</p>` : ''}
      </div>`).join('');
  const total = p.vagones.reduce((s, v) => s + (numeroValido(v.m3) ? aNumero(v.m3) : 0), 0);
  return `
    <section class="tarjeta">
      <h2>Vagones <span class="contador">${p.vagones.length}</span></h2>
      <p class="nota">Opcional. Tolva o plataforma, últimos 4 dígitos del UIC y m³ descargados (${MAX_TOLVA} por tolva).</p>
      ${filas}
      ${total ? `<p class="nota">Total descargado: <strong>${String(total).replace('.', ',')} m³</strong></p>` : ''}
      <button class="btn secundario" data-action="nuevo-vagon">+ Añadir vagón</button>
      ${campo('Procedencia del balasto', 'procedencia', p.procedencia, 'autocomplete="off"')}
    </section>`;
}

export function vParteLD() {
  const p = normalizarParte(estado.parte);
  const loco = subtipoDe(p) === 'locomotora';
  const m = p.maquina;
  const t = p.telefonemas;
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido con-pie">
    ${p.rectificaA ? `<div class="aviso">Corrección del parte (revisión ${p.rectificaA.rev}). Al enviarla, la oficina guardará las dos versiones.</div>` : ''}
    <section class="tarjeta">
      <h2>${loco ? 'Locomotora' : 'Dresina'}</h2>
      ${m.otro ? `${campo('Locomotora', 'maquina.descripcion', m.descripcion, 'autocomplete="off"')}
        ${campo('UIC <small>(opcional)</small>', 'maquina.uic', m.uic, 'autocomplete="off"')}`
    : `<div class="valor-fijo">${esc(m.descripcion)}${m.uic ? ` · UIC ${esc(m.uic)}` : ''}</div>`}
      ${loco ? '' : campo('UIC de la plataforma', 'uicPlataforma', p.uicPlataforma, 'autocomplete="off"')}
    </section>

    <section class="tarjeta">
      <h2>Jornada</h2>
      <label class="campo"><span>Fecha</span><input type="date" data-bind="fecha" data-rerender value="${esc(p.fecha)}"></label>
      <div class="dos"><div class="campo"><span>Semana</span><div class="valor-fijo">${semanaIso(p.fecha)}</div></div>
        ${campo('Nº de acta', 'acta', p.acta, 'autocomplete="off"')}</div>
      ${loco ? '' : campoEvb(p)}
      <div class="campo"><span>Lo rellena</span><div class="valor-fijo">${esc(p.capataz)}</div></div>
    </section>

    ${loco ? '' : `
    <section class="tarjeta">
      <h2>Telefonemas</h2>
      <div class="dos">${campo('Entrada: número', 'telefonemas.entrada.numero', t.entrada.numero, 'inputmode="numeric" autocomplete="off"')}
        ${campoHora('Entrada: hora', 'telefonemas.entrada.hora', t.entrada.hora)}</div>
      <div class="dos">${campo('Salida: número', 'telefonemas.salida.numero', t.salida.numero, 'inputmode="numeric" autocomplete="off"')}
        ${campoHora('Salida: hora', 'telefonemas.salida.hora', t.salida.hora)}</div>
    </section>`}

    <section class="tarjeta">
      <h2>Salida y apartado</h2>
      <div class="dos">${campoHora('Hora de salida', 'salida.hora', p.salida.hora)}
        ${campo('Lugar de salida', 'salida.lugar', p.salida.lugar, 'autocomplete="off"')}</div>
      <div class="dos">${campoHora('Hora de apartado', 'apartado.hora', p.apartado.hora)}
        ${campo('Lugar de apartado', 'apartado.lugar', p.apartado.lugar, 'autocomplete="off"')}</div>
    </section>

    ${loco ? seccionVagones(p) : ''}

    <section class="tarjeta">
      <h2>Trabajo realizado <span class="contador">${p.realizados.length}</span></h2>
      ${p.realizados.map((r, i) => seccionRealizado(r, i, p.realizados.length, loco)).join('')}
      <button class="btn anadir" data-action="nuevo-realizado">+ Añadir trabajo</button>
    </section>

    <section class="tarjeta">
      <h2>Combustible y kilómetros</h2>
      <div class="dos">${campo('Combustible salida (l)', 'combustible.salida', p.combustible.salida, 'inputmode="decimal" autocomplete="off"')}
        ${campo('Combustible llegada (l)', 'combustible.llegada', p.combustible.llegada, 'inputmode="decimal" autocomplete="off"')}</div>
      <div class="dos">${campo('Kilómetros salida', 'km.salida', p.km.salida, 'inputmode="decimal" autocomplete="off"')}
        ${campo('Kilómetros llegada', 'km.llegada', p.km.llegada, 'inputmode="decimal" autocomplete="off"')}</div>
    </section>

    <section class="tarjeta">
      <h2>Observaciones</h2>
      <textarea data-bind="observaciones" rows="3" placeholder="Opcional">${esc(p.observaciones)}</textarea>
    </section>

    ${seccionPersonalMaq(p)}
    ${p.usaExtras && !estado.preguntaExtras ? seccionExtras() : ''}

    <button class="btn peligro-texto" data-action="borrar-parte">Borrar este borrador</button>
  </main>
  <footer class="pie"><div class="fila-botones">
    <button class="btn secundario grande" data-action="guardar-salir">Guardar y salir</button>
    <button class="btn primario grande" data-action="cerrar-parte">Cerrar parte</button>
  </div></footer>
  ${estado.errores.length ? vErrores() : ''}
  ${estado.preguntaExtras ? vPreguntaExtras() : ''}`;
}
