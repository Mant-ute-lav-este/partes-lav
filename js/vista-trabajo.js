// Pantalla de un trabajo de INFRA o SUPER (referencia, ubicación, horas, motivo) y sus fotos:
// añadirlas desde la cámara o la galería, verlas en grande y borrarlas.

import * as db from './db.js';
import { procesarFoto } from './fotos.js';
import { registrarFallo } from './fallos.js';
import { esc, uuid, isoLocal, toast, FORMATO1, MAX_FORMATO1, LADO_FORMATO1 } from './util.js';
import { faltasTrabajo } from './validaciones.js';
import { FASES, LINEAS, MOTIVOS_NO_REALIZADO, MOTIVOS_SIN_FOTOS } from './modelo.js';
import { app, estado, urls, ir, render, guardarYa, guardarPronto, motivosCfg } from './estado.js';
import { cabeceraParte, campo, campoHora, campoPk, radio, casillasVias } from './campos.js';

// ---------- Trabajo ----------

export function trabajoActual() {
  return estado.parte && estado.parte.trabajos[estado.trabajoIdx];
}

export function nuevoTrabajo() {
  const p = estado.parte;
  const previo = p.trabajos[p.trabajos.length - 1];
  p.trabajos.push({
    id: uuid(),
    referencia: { tipo: '', codigo: '', motivo: '' },
    tipoCoste: '',   // solo INFRA: '' (ninguno), 'RREE' o 'POI'; trabajos de coste directo que se facturan aparte
    pidame: '',
    sinVia: false,
    telefonema: { numero: '', salida: '' },   // nº del telefonema de entrada y del de salida
    entradaVia: '',
    salidaVia: '',
    horaInicio: '',
    horaFin: '',
    linea: previo ? previo.linea : '',
    via: '',
    aparato: '',
    pkInicio: '',
    pkFin: '',
    metrosLineales: null,
    motivoActuacion: '',
    finalizado: null,
    noRealizado: false,       // «No realizado» (lluvia, sin corte…): pide el motivo en vez de horas, PK y fotos
    motivoNoRealizado: '',
    sinFotos: false,          // «No se han podido hacer fotos»: pide el motivo en vez de las fotos
    motivoSinFotos: '',
    descripcion: '',
    fotos: [],
  });
  estado.trabajoIdx = p.trabajos.length - 1;
  ir('trabajo');
}

/**
 * Motivo de actuación: desplegable normal con la lista de la oficina (en el móvil sale como
 * lista vertical) más «Otro» para escribirlo. Antes era un datalist, que Android muestra en fila.
 */
export function campoMotivo(p, t, b) {
  const lista = motivosCfg(p.tipo);
  const m = t.motivoActuacion || '';
  const otro = t.motivoOtro || (m && !lista.includes(m));
  return `
      <div class="campo"><span>Motivo de actuación <span class="oblig">obligatorio</span></span>
        <select data-motivo="${b}" aria-label="Motivo de actuación">
          <option value="">Elige el motivo…</option>
          ${lista.map((x) => `<option value="${esc(x)}" ${!otro && x === m ? 'selected' : ''}>${esc(x)}</option>`).join('')}
          <option value="__otro" ${otro ? 'selected' : ''}>Otro (escribirlo)</option>
        </select>
        ${otro ? `<input data-bind="${b}.motivoActuacion" value="${esc(m)}" placeholder="Escribe el motivo" autocomplete="off">` : ''}
      </div>`;
}

/**
 * Motivo de una lista fija (no realizado, sin fotos) más «Otro» para escribirlo. Guarda el texto en
 * t[campo] y si es «Otro» en t[campoOtro].
 */
function campoMotivoLista(titulo, b, t, campo, campoOtro, lista) {
  const m = t[campo] || '';
  const otro = t[campoOtro] || (m && !lista.includes(m));
  return `
      <div class="campo"><span>${titulo} <span class="oblig">obligatorio</span></span>
        <select data-motivo-lista="${b}" data-campo="${campo}" data-otro="${campoOtro}" aria-label="${titulo}">
          <option value="">Elige el motivo…</option>
          ${lista.map((x) => `<option value="${esc(x)}" ${!otro && x === m ? 'selected' : ''}>${esc(x)}</option>`).join('')}
          <option value="__otro" ${otro ? 'selected' : ''}>Otro (escribirlo)</option>
        </select>
        ${otro ? `<input data-bind="${b}.${campo}" value="${esc(m)}" placeholder="Escribe el motivo" autocomplete="off">` : ''}
      </div>`;
}

/** Mismo corte que el trabajo anterior: copia línea, vía, horas, telefonema y PIDAME (se pueden cambiar). */
export function copiarTrabajoAnterior() {
  const p = estado.parte;
  const i = estado.trabajoIdx;
  const t = p.trabajos[i];
  const a = p.trabajos[i - 1];
  if (!t || !a) return;
  Object.assign(t, {
    linea: a.linea, via: a.via, sinVia: a.sinVia, entradaVia: a.entradaVia, salidaVia: a.salidaVia,
    telefonema: { ...a.telefonema }, pidame: a.pidame, horaInicio: a.horaInicio || '', horaFin: a.horaFin || '',
  });
  guardarPronto();
  render();
  toast(`Copiado del trabajo ${i}. Revisa los PK.`);
}

/** Texto que va en el sello de las fotos. */
export function etiquetaFoto(t) {
  const r = t.referencia || {};
  if (r.tipo === 'SIOS') return `SIOS ${r.codigo}`.trim();
  if (r.tipo === 'INCIDENCIA') return `INCIDENCIA ${r.codigo}`.trim();
  return (r.motivo || '').trim().toUpperCase() || 'SIN REFERENCIA';
}

/**
 * Aparato (opcional): con la lista de la oficina sale un desplegable agrupado por estación y, al
 * elegir uno, se rellenan solos los PK de inicio y fin (que se pueden cambiar). Sin lista, o con
 * «Otro», se escribe a mano.
 */
export function campoAparato(t, b) {
  const lista = (estado.config && estado.config.aparatos) || [];
  if (!lista.length) return campo('Aparato <small>(opcional)</small>', `${b}.aparato`, t.aparato, 'placeholder="Ej.: aguja 3" autocomplete="off"');
  const a = t.aparato || '';
  const otro = t.aparatoOtro || (a && !lista.some((x) => x.nombre === a));
  const grupos = new Map();
  lista.forEach((x) => {
    const est = x.nombre.split(/\s+/)[1] || 'Otros';
    if (!grupos.has(est)) grupos.set(est, []);
    grupos.get(est).push(x);
  });
  return `
      <div class="campo"><span>Aparato <small>(opcional)</small></span>
        <select data-aparato="${b}" aria-label="Aparato">
          <option value="">Sin aparato</option>
          ${[...grupos].map(([est, xs]) => `<optgroup label="${esc(est)}">${xs.map((x) => `<option value="${esc(x.nombre)}" ${!otro && x.nombre === a ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</optgroup>`).join('')}
          <option value="__otro" ${otro ? 'selected' : ''}>Otro (escribirlo)</option>
        </select>
        ${otro ? `<input data-bind="${b}.aparato" value="${esc(a)}" placeholder="Escribe el aparato" autocomplete="off">` : ''}
      </div>`;
}

export function vTrabajo() {
  const p = estado.parte;
  const i = estado.trabajoIdx;
  const t = trabajoActual();
  const b = `trabajos.${i}`;
  const r = t.referencia;
  const rr = `${b}.referencia.tipo`;
  const fin = t.noRealizado ? 'noreal' : t.finalizado === true ? 'si' : t.finalizado === false ? 'no' : '';
  const previo = i > 0 ? p.trabajos[i - 1] : null;
  const sinTocar = !t.via && !t.entradaVia && !t.salidaVia && !t.telefonema.numero && !t.pidame;
  const sinTerminar = t.finalizado === false && !t.noRealizado;
  const fotosOpcionales = t.noRealizado || t.sinFotos;
  const opcionFin = (v, txt) => `<label><input type="radio" name="${b}.fin" value="${v}" data-fin="${b}" ${fin === v ? 'checked' : ''}><span>${txt}</span></label>`;
  return `
  ${cabeceraParte('volver-parte', 'Parte', `Trabajo ${i + 1} · ${esc(p.ref)}`)}
  <main class="contenido con-pie">
    ${previo && sinTocar ? `
    <section class="tarjeta copiar">
      <p>¿Es del mismo corte que el trabajo ${i}?</p>
      <button class="btn secundario" data-action="copiar-trabajo-anterior">Copiar línea, vía, horas, telefonema y PIDAME del trabajo ${i}</button>
    </section>` : ''}
    <section class="tarjeta">
      <h2>Referencia</h2>
      <div class="segmentado">
        ${radio(rr, 'SIOS', 'SIOS', r.tipo, 'data-rerender')}${radio(rr, 'INCIDENCIA', 'Incidencia', r.tipo, 'data-rerender')}${radio(rr, 'SIN_REF', 'Sin referencia', r.tipo, 'data-rerender')}
      </div>
      ${r.tipo === 'SIOS' || r.tipo === 'INCIDENCIA'
    ? campo(r.tipo === 'SIOS' ? 'Nº de SIOS' : 'Nº de incidencia', `${b}.referencia.codigo`, r.codigo, 'autocomplete="off"') : ''}
      ${r.tipo === 'SIN_REF' ? `<label class="campo"><span>Escribe la referencia <span class="oblig">obligatorio</span></span>
        <textarea data-bind="${b}.referencia.motivo" rows="2">${esc(r.motivo)}</textarea></label>` : ''}
      ${t.fotos.length ? '<p class="nota">Las fotos ya hechas conservan la referencia con la que se hicieron.</p>' : ''}
      ${p.tipo === 'INFRA' ? `
      <div class="campo"><span>Tipo de trabajo <small>(opcional, solo uno)</small></span>
        <div class="checks-fila">
          <label class="check"><input type="checkbox" data-coste="RREE" ${t.tipoCoste === 'RREE' ? 'checked' : ''}><span>RREE</span></label>
          <label class="check"><input type="checkbox" data-coste="POI" ${t.tipoCoste === 'POI' ? 'checked' : ''}><span>POI</span></label>
        </div></div>` : ''}
      ${campo('Nº acta PIDAME', `${b}.pidame`, t.pidame, 'autocomplete="off"')}
    </section>

    <section class="tarjeta">
      <h2>Vía y horario</h2>
      <label class="check"><input type="checkbox" data-bind="${b}.sinVia" data-rerender ${t.sinVia ? 'checked' : ''}>
        <span>No se ocupa la vía <small>(p. ej. trabajos en base)</small></span></label>
      ${t.sinVia ? '' : `
      <div class="dos">${campo('Telefonema de entrada nº', `${b}.telefonema.numero`, t.telefonema.numero, 'inputmode="numeric" autocomplete="off"')}
        ${campo('Telefonema de salida nº', `${b}.telefonema.salida`, t.telefonema.salida, 'inputmode="numeric" autocomplete="off"')}</div>
      <div class="dos">${campoHora('Entrada en vía', `${b}.entradaVia`, t.entradaVia)}
        ${campoHora('Salida de vía', `${b}.salidaVia`, t.salidaVia)}</div>`}
      <div class="campo"><span>Línea</span>
        <div class="segmentado">${LINEAS.map((l) => radio(`${b}.linea`, l, l, t.linea)).join('')}</div></div>
      ${p.tipo === 'SUPER'
    ? `<div class="campo"><span>Vía <small>(marca todas las que uses)</small></span>${casillasVias(`${b}.via`, t.via, ['1', '2', '3', '4', '5'], { compacto: true })}</div>`
    : `<div class="campo"><span>Vía</span>
        <div class="segmentado compacto">${['1', '2', '3', '4', '5'].map((v) => radio(`${b}.via`, v, v, t.via)).join('')}</div></div>`}
      ${campoAparato(t, b)}
      <div class="dos">${campoPk('PK inicio', `${b}.pkInicio`, t.pkInicio)}${campoPk('PK fin', `${b}.pkFin`, t.pkFin)}</div>
      ${t.sinVia ? `<div class="dos">${campoHora('Hora de inicio', `${b}.horaInicio`, t.horaInicio)}
        ${campoHora('Hora de fin', `${b}.horaFin`, t.horaFin)}</div>` : ''}
    </section>

    <section class="tarjeta">
      <h2>Trabajo realizado</h2>
      ${campoMotivo(p, t, b)}
      ${campo('Metros lineales <small>(opcional)</small>', `${b}.metrosLineales`, t.metrosLineales, 'type="number" inputmode="decimal" min="0" step="any"')}
      <label class="campo"><span>Descripción <small>(opcional)</small></span><textarea data-bind="${b}.descripcion" rows="3">${esc(t.descripcion)}</textarea></label>
      <div class="campo"><span>¿Trabajo finalizado?</span>
        <div class="segmentado">${opcionFin('si', 'Sí')}${opcionFin('no', 'No, sin terminar')}${opcionFin('noreal', 'No realizado')}</div></div>
      ${t.noRealizado ? `
      ${campoMotivoLista('¿Por qué no se ha realizado?', b, t, 'motivoNoRealizado', 'noRealizadoOtro', MOTIVOS_NO_REALIZADO)}
      <p class="nota">No hace falta poner horas de vía, PK ni fotos. Si llegasteis a ocupar la vía, puedes ponerlas igual.</p>` : ''}
    </section>

    <section class="tarjeta">
      <h2>Fotos</h2>
      <p class="nota">${t.noRealizado ? 'Opcionales: el trabajo no se ha realizado.'
    : t.sinFotos ? 'Opcionales: has marcado que no se han podido hacer fotos.'
    : sinTerminar
      ? 'Trabajo sin terminar: al menos una de <strong>antes</strong> y una de <strong>durante</strong> o de <strong>después</strong>.'
      : 'Obligatorio: al menos una de <strong>antes</strong> y una de <strong>después</strong>.'}
        Cada foto lleva fecha, hora y referencia, y se le quita la ubicación.</p>
      ${FASES.map(([f, txt]) => {
    const fs = t.fotos.filter((x) => x.fase === f);
    let marca = '';
    if (fotosOpcionales) marca = '';
    else if (f === 'antes') marca = '<span class="oblig">mín. 1</span>';
    else if (sinTerminar) marca = '<span class="oblig">esta o la otra</span>';
    else if (f === 'despues') marca = '<span class="oblig">mín. 1</span>';
    return `
      <div class="fase">
        <div class="fase-cab"><strong>${txt}</strong> <span class="contador">${fs.length}</span>${marca}</div>
        <div class="fila-botones">
          <button class="btn secundario" data-action="foto" data-fase="${f}" data-origen="camara">📷 Cámara</button>
          <button class="btn secundario" data-action="foto" data-fase="${f}" data-origen="galeria">🖼️ Galería</button>
        </div>
        ${fs.length ? `<div class="miniaturas">${fs.map((x) => `
          <button class="mini-foto" data-action="ver-foto" data-id="${x.id}"><img data-foto-id="${x.id}" alt="Foto ${txt.toLowerCase()}"></button>`).join('')}</div>` : ''}
      </div>`;
  }).join('')}
      ${t.noRealizado ? '' : `
      <label class="check"><input type="checkbox" data-bind="${b}.sinFotos" data-rerender ${t.sinFotos ? 'checked' : ''}>
        <span>No se han podido hacer fotos</span></label>
      ${t.sinFotos ? `
      ${campoMotivoLista('¿Por qué?', b, t, 'motivoSinFotos', 'sinFotosOtro', MOTIVOS_SIN_FOTOS)}
      <p class="falta">Saldrá en rojo en el PDF y en el correo para que la oficina lo vea.</p>` : ''}`}
    </section>

    <button class="btn peligro-texto" data-action="borrar-trabajo">Eliminar este trabajo</button>
  </main>
  <footer class="pie"><button class="btn primario grande" data-action="trabajo-listo">Listo</button></footer>
  <input type="file" id="in-camara" accept="image/*" capture="environment" hidden>
  <input type="file" id="in-galeria" accept="image/*" multiple hidden>
  ${estado.fotoVista ? vFotoGrande() : ''}
  ${estado.preguntaOtro ? vPreguntaOtro(t) : ''}`;
}

/** Al pulsar «Listo» en el último trabajo: ¿hay otro trabajo en la jornada? */
export function vPreguntaOtro(t) {
  const faltas = faltasTrabajo(t);
  return `
  <div class="capa" data-action="cerrar-pregunta"><div class="hoja" data-stop>
    <h2>¿Has hecho otro trabajo en esta jornada?</h2>
    ${faltas.length ? `<p class="falta">A este trabajo aún le falta: ${esc(faltas.map((f) => f.corto).join(', '))}. Puedes completarlo luego.</p>` : ''}
    <button class="btn primario grande" data-action="nuevo-trabajo">Sí, añadir otro trabajo</button>
    <button class="btn secundario grande" data-action="volver-parte">No, volver al parte</button>
  </div></div>`;
}

export function vFotoGrande() {
  return `
  <div class="capa" data-action="cerrar-foto"><div class="hoja" data-stop>
    <img class="foto-grande" data-foto-id="${estado.fotoVista}" alt="Foto ampliada">
    <div class="fila-botones">
      <button class="btn peligro" data-action="borrar-foto" data-id="${estado.fotoVista}">Borrar foto</button>
      <button class="btn" data-action="cerrar-foto">Cerrar</button>
    </div>
  </div></div>`;
}

/** Explica por qué una foto no se ha podido usar, en lugar de culpar siempre al formato. */
export function textoErrorFoto(e, file) {
  const nombre = `«${String((file && file.name) || 'la foto').slice(0, 30)}»`;
  const heic = (e && e.heic) || /heic|heif/i.test((file && file.type) || '') || /\.(heic|heif)$/i.test((file && file.name) || '');
  if (e && e.motivo === 'vacia') return `${nombre} está vacía o no se ha descargado entera.`;
  if (e && e.motivo === 'formato') {
    if (heic && e.sinConexion) {
      return `${nombre} es HEIC y hay que convertirla, pero el convertidor aún no está en el móvil. Vuelve a intentarlo con cobertura (solo la primera vez) o hazla con la cámara de la app.`;
    }
    return heic
      ? `${nombre} es HEIC y no se ha podido convertir. Hazla con la cámara de la app.`
      : `${nombre} no se puede abrir en este navegador (formato no compatible). Prueba con otra foto o desde Chrome.`;
  }
  if (e && e.name === 'QuotaExceededError') return 'No hay espacio en el móvil para guardar la foto. Libera espacio.';
  if (e && e.motivo === 'memoria') return `${nombre} es demasiado grande para este móvil. Prueba con menos fotos a la vez.`;
  return `No se ha podido usar la foto ${nombre}.`;
}

/**
 * Añade fotos al trabajo actual o, con `formato: true`, al formato 1 del parte (SUPER).
 * Las del formato salen más grandes (se lee letra a mano) y hay un máximo.
 */
export async function anadirFotos(archivos, { fase, origen, formato = false }) {
  const p = estado.parte;
  const t = formato ? null : trabajoActual();
  if (!formato && !t) return;
  if (formato && !p.formato1) p.formato1 = [];
  let files = [...archivos];
  let sobran = 0;
  if (formato) {
    const hueco = Math.max(0, MAX_FORMATO1 - p.formato1.length);
    sobran = Math.max(0, files.length - hueco);
    files = files.slice(0, hueco);
  }
  let ok = 0;
  const fallos = [];
  for (const [k, file] of files.entries()) {
    estado.procesando = files.length > 1 ? `Preparando foto ${k + 1} de ${files.length}…` : 'Preparando foto…';
    render();
    try {
      const etiqueta = formato ? FORMATO1.toUpperCase() : etiquetaFoto(t);
      const r = await procesarFoto(file, formato
        ? { origen, fase: 'formato', faseTxt: FORMATO1.toUpperCase(), etiqueta, ref: p.ref, ladoMax: LADO_FORMATO1, calidad: 0.85 }
        : { origen, fase, etiqueta, ref: p.ref });
      const id = uuid();
      await db.putFoto({ id, parteId: p.id, blob: r.blob });
      const meta = {
        id, origen, etiqueta, fechaFoto: r.fechaFoto, fuenteFecha: r.fuenteFecha,
        ancho: r.ancho, alto: r.alto, anadida: isoLocal(),
      };
      if (formato) p.formato1.push(meta);
      else t.fotos.push({ ...meta, fase });
      ok++;
    } catch (e) {
      console.error(e);
      registrarFallo('foto', `${textoErrorFoto(e, file)} [${file.type || 'sin tipo'}, ${Math.round(file.size / 1024)} KB]`);
      fallos.push(textoErrorFoto(e, file));
    }
  }
  if (sobran) fallos.push(`Solo caben ${MAX_FORMATO1} fotos del ${FORMATO1.toLowerCase()}: ${sobran === 1 ? 'una no se ha añadido' : `${sobran} no se han añadido`}.`);
  estado.procesando = '';
  await guardarYa();
  render();
  const hechas = ok === 1 ? 'Foto añadida' : `${ok} fotos añadidas`;
  if (fallos.length) {
    const aviso = fallos.length === 1 ? fallos[0] : `${fallos.length} fotos no se han podido usar. ${fallos[0]}`;
    toast(ok ? `${hechas}. ${aviso}` : aviso, 7000);
  } else if (ok) {
    toast(hechas);
  }
}

export async function borrarFoto(id) {
  if (!confirm('¿Borrar esta foto?')) return;
  for (const t of estado.parte.trabajos) t.fotos = t.fotos.filter((f) => f.id !== id);
  estado.parte.formato1 = (estado.parte.formato1 || []).filter((f) => f.id !== id);
  await db.borrarFoto(id);
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  estado.fotoVista = null;
  await guardarYa();
  render();
}

export async function urlFoto(id) {
  if (!urls.has(id)) {
    const r = await db.getFoto(id);
    if (!r) throw new Error('Foto no encontrada');
    urls.set(id, URL.createObjectURL(r.blob));
  }
  return urls.get(id);
}

export async function cargarMiniaturas() {
  for (const img of app.querySelectorAll('img[data-foto-id]')) {
    try { img.src = await urlFoto(img.dataset.fotoId); } catch { img.alt = 'Foto no disponible'; }
  }
}

export function liberarFotos() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

export async function borrarTrabajo() {
  const p = estado.parte;
  const t = trabajoActual();
  if (!confirm(`¿Eliminar el trabajo ${estado.trabajoIdx + 1} y sus fotos?`)) return;
  for (const f of t.fotos) await db.borrarFoto(f.id);
  p.trabajos.splice(estado.trabajoIdx, 1);
  estado.trabajoIdx = null;
  ir('parte');
}
