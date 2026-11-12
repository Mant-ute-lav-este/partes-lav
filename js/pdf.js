// PDF A4 apaisado con el aspecto del parte en papel (HERBICIDA, vertical como su papel). Se genera en el móvil con jsPDF.

import { fmtFecha, fmtFechaHora, fmtNum, FORMATO1 } from './util.js';
import { puestosDe, listaAparatos, mismoNombre } from './validaciones.js';
import { calculosHerbicida, medioCaso, m2Caso, llevaAnexoFotos, NOMBRE_MEDIO } from './modelo.js';

const PT = 0.3528;              // 1 punto tipográfico en mm
const M = 8;                    // margen
const AN = 297 - 2 * M;         // ancho útil (281 mm)
const FONDO = 210 - 12;         // límite inferior (deja sitio al pie)
const PAD = 1.2;
const GRIS = [222, 222, 222];
const OSCURO = [45, 45, 45];
// Ancho útil y límite inferior de la hoja de este PDF (HERBICIDA va en vertical: c.an y c.fondo).
const anchoUtil = (c) => c.an || AN;
const fondo = (c) => c.fondo || FONDO;

// Las fuentes estándar del PDF solo tienen caracteres latinos (WinAnsi).
function limpia(s) {
  return String(s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
}

function lineas(doc, texto, ancho, tam, negrita) {
  doc.setFont('helvetica', negrita ? 'bold' : 'normal');
  doc.setFontSize(tam);
  return doc.splitTextToSize(limpia(texto), Math.max(2, ancho - 2 * PAD));
}

/** Dibuja una fila de celdas. Cada celda: { w, t, fill, b (negrita), s (tamaño), a (alineación), color }. */
function fila(c, celdas, { minH = 6, valign = 'middle' } = {}) {
  const { doc } = c;
  const med = celdas.map((x) => lineas(doc, x.t, x.w, x.s || 8, x.b));
  const lh = (x) => (x.s || 8) * PT * 1.18;
  const h = Math.max(minH, ...celdas.map((x, i) => med[i].length * lh(x) + 2 * PAD));
  if (c.y + h > fondo(c) && !c.sinSalto) nuevaPagina(c);
  let x = M;
  celdas.forEach((cel, i) => {
    if (cel.fill) { doc.setFillColor(...cel.fill); doc.rect(x, c.y, cel.w, h, 'FD'); } else doc.rect(x, c.y, cel.w, h, 'S');
    doc.setFont('helvetica', cel.b ? 'bold' : 'normal');
    doc.setFontSize(cel.s || 8);
    doc.setTextColor(...(cel.color || [0, 0, 0]));
    const alto = med[i].length * lh(cel);
    const ty = valign === 'top' ? c.y + PAD : c.y + (h - alto) / 2;
    const tx = cel.a === 'center' ? x + cel.w / 2 : cel.a === 'right' ? x + cel.w - PAD : x + PAD;
    if (med[i].length) doc.text(med[i], tx, ty, { baseline: 'top', align: cel.a || 'left', lineHeightFactor: 1.18 });
    x += cel.w;
  });
  doc.setTextColor(0, 0, 0);
  c.y += h;
  return h;
}

function altoFila(doc, celdas) {
  return Math.max(6, ...celdas.map((x) => lineas(doc, x.t, x.w, x.s || 8, x.b).length * (x.s || 8) * PT * 1.18 + 2 * PAD));
}

function nuevaPagina(c) {
  c.doc.addPage();
  c.y = M;
}

function seccion(c, titulo, reserva = 14) {
  if (c.y + 2 + 6 + reserva > fondo(c)) nuevaPagina(c); else c.y += 2.5;
  const { doc } = c;
  doc.setFillColor(...OSCURO);
  doc.rect(M, c.y, anchoUtil(c), 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text(limpia(titulo), M + 2, c.y + 1.4, { baseline: 'top' });
  doc.setTextColor(0, 0, 0);
  c.y += 6;
}

/**
 * Tabla con cabecera que se repite al saltar de página. cols: [{ t, w, a }]. Cada celda es un texto
 * o { t, color, s } para escribirla en otro color (p. ej. los avisos en rojo para la oficina) o tamaño.
 */
function tabla(c, cols, filas, { s = 7.5, vacio = '' } = {}) {
  const cab = () => fila(c, cols.map((col) => ({ w: col.w, t: col.t, fill: GRIS, b: true, s: 6.5, a: 'center' })), { minH: 6 });
  if (c.y + 14 > fondo(c)) nuevaPagina(c);
  cab();
  if (!filas.length && vacio) {
    fila(c, [{ w: anchoUtil(c), t: vacio, s, color: [90, 90, 90] }]);
    return;
  }
  for (const f of filas) {
    const celdas = cols.map((col, i) => {
      const v = f[i] && typeof f[i] === 'object' ? f[i] : { t: f[i] };
      return { w: col.w, t: v.t, s: v.s || s, a: col.a || 'left', color: v.color };
    });
    if (c.y + altoFila(c.doc, celdas) > fondo(c)) { nuevaPagina(c); cab(); }
    fila(c, celdas, { valign: 'top' });
  }
}

export function textoReferencia(t) {
  const r = t.referencia || {};
  if (r.tipo === 'SIOS') return `SIOS ${r.codigo || ''}`.trim();
  if (r.tipo === 'INCIDENCIA') return `Incidencia ${r.codigo || ''}`.trim();
  // Sin referencia: lo que escribe el capataz es la referencia (antes salía «Sin referencia: …»).
  if (r.tipo === 'SIN_REF') return (r.motivo || '').trim() || 'Sin referencia';
  return '';
}

/** Foto de galería cuyo archivo no traía la fecha original: se usó la fecha del archivo. */
export const sinFechaOriginal = (x) => x.origen === 'galeria' && x.fuenteFecha === 'archivo';

function contarFotos(t) {
  const n = (f) => t.fotos.filter((x) => x.fase === f).length;
  const sinFecha = t.fotos.filter(sinFechaOriginal).length;
  return `Fotos: ${n('antes')} antes · ${n('durante')} durante · ${n('despues')} después${t.fotos.length ? ' (ver anexo)' : ''}` +
    `${sinFecha ? `\n${sinFecha} sin fecha original` : ''}`;
}

/**
 * Descripción del trabajo en la tabla: lo escrito, el motivo si no se ha realizado y las fotos.
 * Sin fotos posibles, la celda va en rojo para que la oficina lo vea.
 */
function descripcionTrabajo(t) {
  const sinFotos = !t.noRealizado && t.sinFotos;
  const aviso = sinFotos ? `SIN FOTOS: ${t.motivoSinFotos || ''}` : t.noRealizado ? `No realizado: ${t.motivoNoRealizado || ''}` : null;
  // Sin aviso queda como siempre: la descripción (aunque esté vacía) y debajo las fotos.
  const texto = aviso
    ? [aviso, (t.descripcion || '').trim(), contarFotos(t)].filter(Boolean).join('\n')
    : `${t.descripcion || ''}\n${contarFotos(t)}`;
  return sinFotos ? { t: texto, color: [170, 0, 0] } : texto;
}

const FASE_TXT ={ antes: 'ANTES', durante: 'DURANTE', despues: 'DESPUÉS' };

/** Reduce la foto para el anexo del PDF (las originales van aparte, a tamaño completo). */
async function reducir(blob, lado = 900, calidad = 0.65) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, lado / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k);
  const h = Math.round(bmp.height * k);
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const b = await new Promise((res, rej) => cv.toBlob((x) => (x ? res(x) : rej(new Error('No se pudo preparar una foto'))), 'image/jpeg', calidad));
  cv.width = 0;
  cv.height = 0;
  return { datos: new Uint8Array(await b.arrayBuffer()), w, h };
}

/** Anexo fotográfico: dos fotos por página, en orden de trabajo y fase. */
async function anexoFotos(c, parte, leerFoto) {
  const lista = [];
  parte.trabajos.forEach((t, i) => ['antes', 'durante', 'despues'].forEach((f) => {
    t.fotos.filter((x) => x.fase === f).forEach((x) => lista.push({ t, i, x }));
  }));
  await paginasFotos(c, parte, leerFoto, lista, 'ANEXO FOTOGRÁFICO', ({ t, i, x }) =>
    `Trabajo ${i + 1} · ${textoReferencia(t)} · ${FASE_TXT[x.fase] || x.fase} · ` +
    `${x.origen === 'galeria' ? 'Galería' : 'Cámara'} · ${fmtFechaHora(x.fechaFoto)}`);
}

/** Anexo del formato de protección de la vía (solo SUPER): mismas páginas que el anexo fotográfico. */
async function anexoFormato(c, parte, leerFoto) {
  const lista = (parte.formato1 || []).map((x) => ({ x }));
  await paginasFotos(c, parte, leerFoto, lista, `ANEXO ${FORMATO1.toUpperCase()}`, ({ x }) =>
    `${FORMATO1} · ${x.origen === 'galeria' ? 'Galería' : 'Cámara'} · ${fmtFechaHora(x.fechaFoto)}`, 1600, 0.78);
}

/** Dos fotos por página, con el título del anexo y un pie por foto. */
async function paginasFotos(c, parte, leerFoto, lista, nombreAnexo, textoPie, lado = 900, calidad = 0.65) {
  if (!lista.length) return;
  const { doc } = c;
  const hueco = 6;
  const anchoCelda = (AN - hueco) / 2;
  const tituloAnexo = `${nombreAnexo}  ·  Ref. ${parte.ref}${parte.rev > 1 ? ` rev. ${parte.rev}` : ''}  ·  ` +
    `${parte.tipo === 'INFRA' ? 'Infraestructura' : 'Superestructura'}  ·  Jornada ${fmtFecha(parte.fecha)}  ·  ${parte.capataz}`;
  for (let k = 0; k < lista.length; k += 2) {
    nuevaPagina(c);
    fila(c, [{ w: AN, t: tituloAnexo, b: true, s: 9, fill: GRIS }], { minH: 8 });
    const y0 = c.y + 3;
    const altoMax = FONDO - y0 - 12;   // deja sitio al pie de foto
    for (let j = 0; j < 2 && k + j < lista.length; j++) {
      const item = lista[k + j];
      const x = item.x;
      const x0 = M + j * (anchoCelda + hueco);
      let yPie = y0;
      const blob = await leerFoto(x.id);
      if (blob) {
        const img = await reducir(blob, lado, calidad);
        const e = Math.min(anchoCelda / img.w, altoMax / img.h);
        const w = img.w * e;
        const h = img.h * e;
        doc.addImage(img.datos, 'JPEG', x0 + (anchoCelda - w) / 2, y0, w, h);
        doc.rect(x0 + (anchoCelda - w) / 2, y0, w, h, 'S');
        yPie = y0 + h + 2;
      }
      const sinFecha = sinFechaOriginal(x);
      const pie = textoPie(item) + (sinFecha ? ' · SIN FECHA ORIGINAL (fecha del archivo)' : '');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      if (sinFecha) doc.setTextColor(170, 0, 0);
      doc.text(doc.splitTextToSize(limpia(pie), anchoCelda), x0 + anchoCelda / 2, yPie, { baseline: 'top', align: 'center' });
      doc.setTextColor(0, 0, 0);
    }
  }
}

/**
 * Genera el PDF del parte. Si se pasa leerFoto(id) → Blob, añade el anexo fotográfico.
 * @returns {Promise<Blob>}
 */
export async function generarPDF(parte, config, versionApp = '', leerFoto = null) {
  const J = window.jspdf && window.jspdf.jsPDF;
  if (!J) throw new Error('Falta el generador de PDF. Abre la app una vez con cobertura y vuelve a intentarlo.');
  const vertical = parte.tipo === 'HERBICIDA';   // su papel es una hoja vertical
  const doc = new J({ orientation: vertical ? 'portrait' : 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setLineWidth(0.2);
  doc.setDrawColor(0, 0, 0);
  doc.setProperties({
    title: `Parte ${parte.tipo} ${fmtFecha(parte.fecha)} ${parte.ref}`,
    subject: 'Parte de trabajo diario',
    author: parte.capataz,
    creator: `Partes LAV ${versionApp}`,
  });
  const c = vertical ? { doc, y: M, an: 210 - 2 * M, fondo: 297 - 12 } : { doc, y: M };
  const cab = (config && config.cabecera) || {};
  const tipoTxt = parte.tipo === 'INFRA' ? 'INFRAESTRUCTURA' : 'SUPERESTRUCTURA';
  const linea = parte.tipo === 'INFRA' ? cab.lineaInfra : cab.lineaSuper;
  const L = { fill: GRIS, b: true, s: 7 };   // estilo de etiqueta

  if (parte.tipo === 'MAQUINARIA') {
    if (parte.subtipo && parte.subtipo !== 'via') cuerpoLocoDresina(c, parte, cab);
    else cuerpoMaquinaria(c, parte, cab);
    pdfPie(c, parte, versionApp);
    return doc.output('blob');
  }
  // HERBICIDA: como su papel. Sin anexo de fotos (llevaAnexoFotos): van sueltas en la carpeta del parte.
  if (parte.tipo === 'HERBICIDA') {
    cuerpoHerbicida(c, parte, cab);
    if (leerFoto && llevaAnexoFotos(parte)) await anexoFotos(c, parte, leerFoto);
    pdfPie(c, parte, versionApp);
    return doc.output('blob');
  }

  // Título
  fila(c, [
    { w: 52, t: `Ref. ${parte.ref}${parte.rev > 1 ? `   ·   Rev. ${parte.rev}` : ''}`, b: true, s: 9 },
    { w: AN - 104, t: `PARTE DE TRABAJO DE ${tipoTxt}`, b: true, s: 14, a: 'center' },
    { w: 52, t: `Fecha de la jornada\n${fmtFecha(parte.fecha)}${parte.nocturna ? ' (nocturna)' : ''}`, b: true, s: 9, a: 'center' },
  ], { minH: 13 });

  // Datos generales, como en el papel
  fila(c, [
    { ...L, w: 28, t: 'JEFATURA DE ÁREA' }, { w: 30, t: cab.jefatura || '', b: true },
    { ...L, w: 14, t: 'LÍNEA' }, { w: 32, t: linea || '', b: true },
    { ...L, w: 17, t: 'ÁMBITO' }, { w: 40, t: cab.ambito || '', b: true },
    { ...L, w: 18, t: 'EMPRESA' }, { w: AN - 179, t: cab.empresa || '', b: true },
  ], { minH: 8 });
  fila(c, [
    { ...L, w: 32, t: 'EQUIPO (CAPATAZ)' }, { w: 90, t: parte.capataz, b: true },
    { ...L, w: 22, t: 'DOTACIÓN' }, { w: 15, t: String(parte.personal.length), b: true, a: 'center' },
    { ...L, w: 40, t: 'HORA DE CIERRE (MÓVIL)' }, { w: AN - 199, t: fmtFechaHora(parte.cierre) || '—', b: true },
  ], { minH: 8 });

  avisoRectificativo(c, parte);

  // Personal
  seccion(c, `PERSONAL (${parte.personal.length})`);
  tabla(c, [
    { t: 'Nº', w: 10, a: 'center' }, { t: 'NOMBRE Y APELLIDOS', w: 85 }, { t: 'EMPRESA', w: 70 },
    { t: 'HABILITACIÓN', w: 66 }, { t: 'CATEGORÍA', w: 50 },
  ], parte.personal.map((p, i) => [String(i + 1), p.nombre + (p.otro ? ' *' : ''), p.empresa, p.habilitacion, p.categoria]),
  { vacio: 'Sin personal' });
  if (parte.personal.some((p) => p.otro)) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.text('* Añadido por el capataz: no está en la lista de la oficina.', M, c.y + 1, { baseline: 'top' });
    c.y += 4;
  }

  // Jornada en la que no se pudo trabajar: sin trabajos, maquinaria ni medidas, solo el motivo.
  if (parte.sinTrabajos) {
    seccionSinTrabajos(c, parte);
    pdfPie(c, parte, versionApp);
    return doc.output('blob');
  }

  pdfHorasExtra(c, parte);

  // Trabajos
  seccion(c, `TRABAJOS (${parte.trabajos.length})`, 20);
  // Solo INFRA lleva la columna RREE/POI (trabajos de coste directo, que se facturan aparte).
  const conCoste = parte.tipo === 'INFRA';
  const ANCHO_COSTE = 14;
  // SUPER admite varias vías («1, 2, 3»): la columna es algo más ancha. INFRA, una sola, como siempre.
  const ANCHO_VIA = parte.tipo === 'SUPER' ? 14 : 9;
  tabla(c, [
    { t: 'Nº', w: 7, a: 'center' }, { t: 'REFERENCIA', w: 30 },
    ...(conCoste ? [{ t: 'RREE /\nPOI', w: ANCHO_COSTE, a: 'center' }] : []),
    { t: 'Nº PIDAME', w: 18 },
    { t: 'TELEFONEMAS', w: 20 }, { t: 'ENTRADA\nVÍA', w: 15, a: 'center' }, { t: 'SALIDA\nVÍA', w: 13, a: 'center' },
    { t: 'LÍNEA', w: 11, a: 'center' }, { t: 'VÍA', w: ANCHO_VIA, a: 'center' }, { t: 'APARATO', w: 16 },
    { t: 'P.K. INICIO', w: 16, a: 'center' },
    { t: 'P.K. FIN', w: 16, a: 'center' }, { t: 'M. LIN', w: 11, a: 'center' }, { t: 'MOTIVO ACTUACIÓN', w: 26 },
    { t: '¿FIN?', w: 17, a: 'center' }, { t: 'DESCRIPCIÓN', w: AN - 216 - ANCHO_VIA - (conCoste ? ANCHO_COSTE : 0) },
  ], parte.trabajos.map((t, i) => [
    String(i + 1),
    textoReferencia(t),
    ...(conCoste ? [t.tipoCoste || '-'] : []),
    t.pidame,
    t.sinVia ? 'No ocupa vía' : [t.telefonema?.numero && `Ent. ${t.telefonema.numero}`, t.telefonema?.salida && `Sal. ${t.telefonema.salida}`, t.telefonema?.hora].filter(Boolean).join('\n'),
    // Sin ocupar la vía: en esas columnas van la hora de inicio y la de fin del trabajo.
    t.sinVia ? (t.horaInicio ? `Inicio\n${t.horaInicio}` : '-') : t.entradaVia,
    t.sinVia ? (t.horaFin ? `Fin\n${t.horaFin}` : '-') : t.salidaVia,
    t.linea,
    t.sinVia && !t.via ? '-' : t.via,
    listaAparatos(t.aparato).join('\n'),   // uno por línea
    t.pkInicio,
    t.pkFin,
    t.metrosLineales == null ? '' : String(t.metrosLineales),
    t.motivoActuacion,
    t.noRealizado ? { t: 'NO\nREALIZADO', s: 6.5 } : t.finalizado === true ? 'SÍ' : t.finalizado === false ? 'NO' : '',
    descripcionTrabajo(t),
  ]), { vacio: 'Sin trabajos' });

  // Maquinaria y vehículos (los partes de antes de v0.6.0 los llevan juntos en una tabla)
  const conDatos = (xs) => (xs || []).filter((v) => (v.descripcion || '').trim() || (v.matricula || '').trim());
  if (parte.maquinas) {
    const ms = parte.usaMaquinaria === false ? [] : conDatos(parte.maquinas);
    seccion(c, 'MAQUINARIA');
    tabla(c, [{ t: 'Nº', w: 10, a: 'center' }, { t: 'MÁQUINA', w: AN - 10 }],
      ms.map((v, i) => [String(i + 1), v.descripcion]), { vacio: 'No se ha usado maquinaria' });
    const vs = parte.usaVehiculos === false ? [] : conDatos(parte.vehiculos);
    seccion(c, 'VEHÍCULOS');
    tabla(c, [{ t: 'Nº', w: 10, a: 'center' }, { t: 'VEHÍCULO', w: 181 }, { t: 'MATRÍCULA', w: AN - 191 }],
      vs.map((v, i) => [String(i + 1), v.descripcion, v.matricula]), { vacio: 'No se han usado vehículos' });
  } else {
    const vs = parte.usaMaquinaria === false ? [] : conDatos(parte.vehiculos);
    seccion(c, 'MAQUINARIA Y VEHÍCULOS');
    tabla(c, [{ t: 'Nº', w: 10, a: 'center' }, { t: 'MÁQUINA / VEHÍCULO', w: 181 }, { t: 'MATRÍCULA', w: AN - 191 }],
      vs.map((v, i) => [String(i + 1), v.descripcion, v.matricula]), { vacio: 'No se ha usado maquinaria ni vehículos' });
  }

  // Medidas antiincendios y observaciones
  seccion(c, 'MEDIDAS ANTIINCENDIOS');
  fila(c, [{ w: AN, t: parte.antiincendios || '', s: 8 }], { minH: 9, valign: 'top' });
  if ((parte.observaciones || '').trim()) {
    seccion(c, 'OBSERVACIONES');
    fila(c, [{ w: AN, t: parte.observaciones, s: 8 }], { minH: 9, valign: 'top' });
  }

  if (leerFoto && llevaAnexoFotos(parte)) {
    await anexoFotos(c, parte, leerFoto);
    if (parte.tipo === 'SUPER') await anexoFormato(c, parte, leerFoto);
  }

  pdfPie(c, parte, versionApp);
  return doc.output('blob');
}

/** Parte rectificativo: una línea en rojo debajo de la cabecera. */
function avisoRectificativo(c, parte) {
  if (!parte.rectificaA) return;
  c.y += 1.5;
  fila(c, [{
    w: anchoUtil(c), b: true, s: 8.5, color: [170, 0, 0],
    t: `PARTE RECTIFICATIVO: sustituye a la revisión ${parte.rectificaA.rev} de este parte` +
      `${parte.rectificaA.cierre ? ` (cerrada el ${fmtFechaHora(parte.rectificaA.cierre)})` : ''}.`,
  }], { minH: 7 });
}

/** Jornada en la que no se pudo trabajar: una sección con el motivo, en rojo, y las observaciones. */
function seccionSinTrabajos(c, parte) {
  seccion(c, 'JORNADA SIN TRABAJOS');
  fila(c, [{ w: anchoUtil(c), t: `No se ha podido trabajar: ${parte.motivoSinTrabajos || ''}`, b: true, s: 10, color: [170, 0, 0] }], { minH: 12 });
  if ((parte.observaciones || '').trim()) {
    seccion(c, 'OBSERVACIONES');
    fila(c, [{ w: anchoUtil(c), t: parte.observaciones, s: 8 }], { minH: 9, valign: 'top' });
  }
}

/** Horas extra del parte (desde v0.8.0): tabla y total por tipo. */
function pdfHorasExtra(c, parte) {
  if (!parte.extras) return;
  const { doc } = c;
  const hs = parte.usaExtras ? (parte.personal || [])
    .map((x) => parte.extras.find((e) => e.nombre === x.nombre))
    .filter((e) => e && Number(e.horas) > 0) : [];
  const num = (n) => String(n).replace('.', ',');
  const tipos = { normales: 'Normales', nocturnas: 'Nocturnas', festivas: 'Festivas' };
  seccion(c, 'HORAS EXTRA');
  tabla(c, [
    { t: 'Nº', w: 10, a: 'center' }, { t: 'NOMBRE Y APELLIDOS', w: 85 }, { t: 'HORAS', w: 18, a: 'center' },
    { t: 'TIPO', w: 28 }, { t: 'MOTIVO', w: AN - 141 },
  ], hs.map((e, i) => [String(i + 1), e.nombre, num(e.horas), tipos[e.tipo] || '', e.motivo || '']),
  { vacio: 'Sin horas extra' });
  if (hs.length) {
    const suma = (t) => hs.filter((e) => e.tipo === t).reduce((s, e) => s + Number(e.horas), 0);
    const partes = Object.keys(tipos).map((t) => suma(t) && `${tipos[t].toLowerCase()} ${num(suma(t))} h`).filter(Boolean);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.text(`Total: ${num(hs.reduce((s, e) => s + Number(e.horas), 0))} h (${partes.join(', ')})`, M, c.y + 1, { baseline: 'top' });
    c.y += 5;
  }
}

/** Pie en todas las páginas: hora de cierre, versión e identificador, y número de página. */
function pdfPie(c, parte, versionApp) {
  const { doc } = c;
  const n = doc.getNumberOfPages();
  const ancho = c.an ? c.an + 2 * M : 297;
  const alto = c.fondo ? 297 : 210;
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(90, 90, 90);
    const yPie = alto - 7;
    doc.text(limpia(`Cerrado en el móvil: ${fmtFechaHora(parte.cierre) || '-'}`), M, yPie);
    doc.text(limpia(`Partes LAV ${versionApp} · id ${parte.id.slice(0, 8)}`), ancho / 2, yPie, { align: 'center' });
    doc.text(`Página ${i} de ${n}`, ancho - M, yPie, { align: 'right' });
  }
  doc.setTextColor(0, 0, 0);
}

// ---------- Parte de maquinaria de vía ----------
// PDF sencillo pero completo (fase 3a). En la fase 3b se le dará el aspecto del papel.

const SI_NO = (v) => (v === true ? 'SÍ' : v === false ? 'NO' : '');
const MODO_TXT = { calculado: 'Calculado', manual: 'Manual', auto: 'Auto', visor: 'Visor' };
const CUANDO_TXT = { antes: 'Antes', despues: 'Después', ambos: 'Ambos' };

/** Texto de una operación del tajo para su celda: «NO», o «SÍ» y sus detalles. */
function textoOperacion(nombre, o) {
  if (!o || o.si == null) return '';
  if (!o.si) return 'NO';
  const d = [];
  if (nombre === 'nivelado' || nombre === 'alineado') {
    d.push(MODO_TXT[o.modo] || '');
    if (o.modo === 'calculado') {
      d.push(`${nombre === 'nivelado' ? 'Lev' : 'Rip'}. máx. ${String(o.max).replace('.', ',')} mm`);
      d.push(`PK ${o.pk}`);
    }
  } else if (nombre === 'estabilizado') d.push(`Programada: ${SI_NO(o.programada)}`);
  else if (nombre === 'registro') d.push(CUANDO_TXT[o.cuando] || '', o.texto || '');
  else if (nombre === 'perfilado') d.push(`Cepillado: ${SI_NO(o.cepillado)}`);
  return ['SÍ', ...d.filter(Boolean)].join('\n');
}

/** Personal por puesto (los puestos vacíos salen con «-»). */
function tablaPersonalPuestos(c, parte, puestos) {
  const { doc } = c;
  seccion(c, `PERSONAL (${parte.personal.length})`);
  tabla(c, [
    { t: 'PUESTO', w: 50 }, { t: 'NOMBRE Y APELLIDOS', w: 100 }, { t: 'EMPRESA', w: 70 }, { t: 'CATEGORÍA', w: AN - 220 },
  ], puestos.flatMap(([clave, titulo]) => {
    const gente = parte.personal.filter((x) => x.puesto === clave);
    return gente.length ? gente.map((x) => [titulo, x.nombre + (x.otro ? ' *' : ''), x.empresa, x.categoria]) : [[titulo, '-', '', '']];
  }));
  if (parte.personal.some((x) => x.otro)) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.text('* Añadido a mano: no está en la lista de la oficina.', M, c.y + 1, { baseline: 'top' });
    c.y += 4;
  }
}

/** Número de semana (ISO) de una fecha «AAAA-MM-DD». */
function semanaIso(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia + 3);
  const primerJueves = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return String(1 + Math.round(((d - primerJueves) / 86400000 - 3 + ((primerJueves.getUTCDay() + 6) % 7)) / 7));
}

/** Partes de trabajos con locomotora o con dresina (PDF sencillo; el aspecto del papel, más adelante). */
function cuerpoLocoDresina(c, parte, cab) {
  const loco = parte.subtipo === 'locomotora';
  const L = { fill: GRIS, b: true, s: 7 };
  const num = (s) => String(s == null ? '' : s).replace('.', ',');
  fila(c, [
    { w: 52, t: `Ref. ${parte.ref}${parte.rev > 1 ? `   ·   Rev. ${parte.rev}` : ''}`, b: true, s: 9 },
    { w: AN - 104, t: `PARTE DE TRABAJOS CON ${loco ? 'LOCOMOTORA' : 'DRESINA'}`, b: true, s: 14, a: 'center' },
    { w: 52, t: `Fecha ${fmtFecha(parte.fecha)}\nSemana ${semanaIso(parte.fecha)}`, b: true, s: 9, a: 'center' },
  ], { minH: 13 });
  fila(c, [
    { ...L, w: 22, t: 'ÁMBITO' }, { w: 45, t: cab.ambito || '', b: true },
    { ...L, w: 22, t: 'Nº ACTA' }, { w: 40, t: parte.acta || '', b: true },
    { ...L, w: 22, t: 'LO RELLENA' }, { w: loco ? 70 : 50, t: parte.capataz, b: true },
    ...(loco ? [] : [{ ...L, w: 10, t: 'EVB' }, { w: 10, t: SI_NO(parte.evb), b: true, a: 'center' }]),
    { ...L, w: 30, t: 'CIERRE (MÓVIL)' }, { w: AN - 251, t: fmtFechaHora(parte.cierre) || '—', b: true },
  ], { minH: 8 });
  fila(c, [
    { ...L, w: 30, t: loco ? 'LOCOMOTORA' : 'DRESINA' },
    { w: loco ? AN - 30 : 140, t: `${parte.maquina.descripcion}${parte.maquina.uic ? `   ·   UIC ${parte.maquina.uic}` : ''}`, b: true },
    ...(loco ? [] : [{ ...L, w: 35, t: 'UIC PLATAFORMA' }, { w: AN - 205, t: parte.uicPlataforma || '', b: true }]),
  ], { minH: 8 });

  if (parte.rectificaA) {
    c.y += 1.5;
    fila(c, [{
      w: AN, b: true, s: 8.5, color: [170, 0, 0],
      t: `PARTE RECTIFICATIVO: sustituye a la revisión ${parte.rectificaA.rev} de este parte` +
        `${parte.rectificaA.cierre ? ` (cerrada el ${fmtFechaHora(parte.rectificaA.cierre)})` : ''}.`,
    }], { minH: 7 });
  }

  // Jornada sin trabajos (p. ej. avería de la máquina): solo el motivo y quién estaba.
  if (parte.sinTrabajos) {
    seccionSinTrabajos(c, parte);
    tablaPersonalPuestos(c, parte, puestosDe(parte));
    return;
  }

  if (!loco) {
    const t = parte.telefonemas || { entrada: {}, salida: {} };
    seccion(c, 'TELEFONEMAS');
    fila(c, [
      { ...L, w: 40, t: 'ENTRADA: NÚMERO' }, { w: 50, t: t.entrada.numero || '', b: true },
      { ...L, w: 20, t: 'HORA' }, { w: 30, t: t.entrada.hora || '', b: true, a: 'center' },
      { ...L, w: 40, t: 'SALIDA: NÚMERO' }, { w: 50, t: t.salida.numero || '', b: true },
      { ...L, w: 20, t: 'HORA' }, { w: AN - 250, t: t.salida.hora || '', b: true, a: 'center' },
    ], { minH: 8 });
  }

  seccion(c, 'SALIDA Y APARTADO');
  fila(c, [
    { ...L, w: 30, t: 'HORA SALIDA' }, { w: 30, t: parte.salida.hora || '', b: true, a: 'center' },
    { ...L, w: 30, t: 'LUGAR SALIDA' }, { w: 50, t: parte.salida.lugar || '', b: true },
    { ...L, w: 30, t: 'HORA APARTADO' }, { w: 30, t: parte.apartado.hora || '', b: true, a: 'center' },
    { ...L, w: 30, t: 'LUGAR APARTADO' }, { w: AN - 230, t: parte.apartado.lugar || '', b: true },
  ], { minH: 8 });

  if (loco) {
    const vs = parte.vagones || [];
    const total = vs.reduce((s, v) => s + (Number(String(v.m3 || '').replace(',', '.')) || 0), 0);
    seccion(c, `VAGONES (${vs.length})`);
    tabla(c, [
      { t: 'Nº', w: 10, a: 'center' }, { t: 'TIPO', w: 50 }, { t: 'UIC (ÚLTIMOS 4 DÍGITOS)', w: 60, a: 'center' },
      { t: 'DESCARGADAS (m³)', w: 50, a: 'center' }, { t: '', w: AN - 170 },
    ], vs.map((v, i) => [String(i + 1), v.tipo === 'tolva' ? 'Tolva' : v.tipo === 'plataforma' ? 'Plataforma' : '', v.uic, num(v.m3), '']),
    { vacio: 'Sin vagones' });
    fila(c, [
      { ...L, w: 50, t: 'PROCEDENCIA DEL BALASTO' }, { w: 120, t: parte.procedencia || '', b: true },
      { ...L, w: 50, t: 'TOTAL DESCARGADO' }, { w: AN - 220, t: total ? `${num(total)} m³` : '', b: true, a: 'center' },
    ], { minH: 8 });
  }

  const rs = parte.realizados || [];
  seccion(c, `TRABAJO REALIZADO (${rs.length})`, 20);
  tabla(c, [
    { t: 'Nº', w: 8, a: 'center' }, { t: 'VÍA', w: 12, a: 'center' }, { t: 'P.K. INICIO', w: 22, a: 'center' },
    { t: 'P.K. FIN', w: 22, a: 'center' }, { t: 'HORA INICIO', w: 20, a: 'center' }, { t: 'HORA FIN', w: 20, a: 'center' },
    { t: 'TRABAJO', w: loco ? AN - 124 : AN - 104 }, ...(loco ? [{ t: 'm³', w: 20, a: 'center' }] : []),
  ], rs.map((r, i) => [String(i + 1), r.via, r.pkInicio, r.pkFin, r.horaInicio, r.horaFin, r.trabajo, ...(loco ? [num(r.m3)] : [])]),
  { vacio: 'Sin trabajos' });

  if ((parte.observaciones || '').trim()) {
    seccion(c, 'OBSERVACIONES');
    fila(c, [{ w: AN, t: parte.observaciones, s: 8 }], { minH: 9, valign: 'top' });
  }

  seccion(c, 'COMBUSTIBLE Y KILÓMETROS');
  fila(c, [
    { ...L, w: 40, t: 'COMBUSTIBLE SALIDA' }, { w: 30, t: parte.combustible.salida ? `${num(parte.combustible.salida)} l` : '', b: true, a: 'center' },
    { ...L, w: 40, t: 'COMBUSTIBLE LLEGADA' }, { w: 30, t: parte.combustible.llegada ? `${num(parte.combustible.llegada)} l` : '', b: true, a: 'center' },
    { ...L, w: 35, t: 'KM SALIDA' }, { w: 35, t: num(parte.km.salida), b: true, a: 'center' },
    { ...L, w: 35, t: 'KM LLEGADA' }, { w: AN - 245, t: num(parte.km.llegada), b: true, a: 'center' },
  ], { minH: 8 });

  tablaPersonalPuestos(c, parte, puestosDe(parte));
  pdfHorasExtra(c, parte);
}

function cuerpoMaquinaria(c, parte, cab) {
  const { doc } = c;
  const L = { fill: GRIS, b: true, s: 7 };
  fila(c, [
    { w: 52, t: `Ref. ${parte.ref}${parte.rev > 1 ? `   ·   Rev. ${parte.rev}` : ''}`, b: true, s: 9 },
    { w: AN - 104, t: 'PARTE DE MAQUINARIA', b: true, s: 14, a: 'center' },
    { w: 52, t: `Fecha ${fmtFecha(parte.fecha)}${parte.sinTrabajos ? '' : `\nHorario ${parte.horaInicio || '--:--'} - ${parte.horaFin || '--:--'}`}`, b: true, s: 9, a: 'center' },
  ], { minH: 13 });
  fila(c, [
    { ...L, w: 22, t: 'EMPRESA' }, { w: 70, t: cab.empresa || '', b: true },
    { ...L, w: 22, t: 'LO RELLENA' }, { w: 50, t: parte.capataz, b: true },
    { ...L, w: 10, t: 'EVB' }, { w: 10, t: SI_NO(parte.evb), b: true, a: 'center' },
    { ...L, w: 40, t: 'HORA DE CIERRE (MÓVIL)' }, { w: AN - 224, t: fmtFechaHora(parte.cierre) || '—', b: true },
  ], { minH: 8 });

  if (parte.rectificaA) {
    c.y += 1.5;
    fila(c, [{
      w: AN, b: true, s: 8.5, color: [170, 0, 0],
      t: `PARTE RECTIFICATIVO: sustituye a la revisión ${parte.rectificaA.rev} de este parte` +
        `${parte.rectificaA.cierre ? ` (cerrada el ${fmtFechaHora(parte.rectificaA.cierre)})` : ''}.`,
    }], { minH: 7 });
  }

  const maquinas = (parte.maquinasVia || []).filter((m) => (m.descripcion || '').trim());
  seccion(c, 'MÁQUINAS');
  tabla(c, [
    { t: 'Nº', w: 10, a: 'center' }, { t: 'MÁQUINA', w: 110 }, { t: 'UIC', w: 60 },
    { t: 'TRABAJO', w: 66 }, { t: 'HORAS', w: AN - 246, a: 'center' },
  ], maquinas.map((m, i) => [String(i + 1), m.descripcion, m.uic || '', m.trabajo || '', String(m.horas || '').replace('.', ',')]),
  { vacio: 'Sin máquinas' });

  if (parte.sinTrabajos) {
    // Jornada sin trabajos (p. ej. avería): máquina, motivo y personal; sin viaje ni tajos.
    seccionSinTrabajos(c, parte);
    tablaPersonalPuestos(c, parte, puestosDe(parte));
    return;
  }

  const v = parte.viaje || {};
  seccion(c, 'VIAJE');
  fila(c, [
    { ...L, w: 30, t: 'HORA SALIDA' }, { w: 30, t: v.horaSalida || '', b: true, a: 'center' },
    { ...L, w: 30, t: 'LUGAR SALIDA' }, { w: 50, t: v.lugarSalida || '', b: true },
    { ...L, w: 30, t: 'HORA LLEGADA' }, { w: 30, t: v.horaLlegada || '', b: true, a: 'center' },
    { ...L, w: 30, t: 'LUGAR LLEGADA' }, { w: AN - 230, t: v.lugarLlegada || '', b: true },
  ], { minH: 8 });

  const tajos = parte.tajos || [];
  seccion(c, `TAJOS (${tajos.length})`, 20);
  const op = (AN - 144) / 5;
  tabla(c, [
    { t: 'Nº', w: 7, a: 'center' }, { t: 'LLEGADA\nTAJO', w: 15, a: 'center' }, { t: 'INICIO\nTRABAJO', w: 15, a: 'center' },
    { t: 'FIN\nTRABAJO', w: 15, a: 'center' }, { t: 'SALIDA\nTAJO', w: 15, a: 'center' }, { t: 'VÍA', w: 12, a: 'center' },
    { t: 'P.K. INICIO', w: 17, a: 'center' }, { t: 'P.K. FINAL', w: 17, a: 'center' }, { t: 'DESVÍO / AD', w: 31 },
    { t: 'NIVELADO', w: op }, { t: 'ALINEADO', w: op }, { t: 'ESTABILIZ.', w: op }, { t: 'REGISTRO', w: op }, { t: 'PERFILADO', w: op },
  ], tajos.map((t, i) => [
    String(i + 1), t.llegada, t.inicio, t.fin, t.salida, t.via, t.pkInicio, t.pkFin, t.desvio || '',
    textoOperacion('nivelado', t.nivelado), textoOperacion('alineado', t.alineado),
    textoOperacion('estabilizado', t.estabilizado), textoOperacion('registro', t.registro),
    textoOperacion('perfilado', t.perfilado),
  ]), { vacio: 'Sin tajos' });

  if ((parte.observaciones || '').trim()) {
    seccion(c, 'OBSERVACIONES');
    fila(c, [{ w: AN, t: parte.observaciones, s: 8 }], { minH: 9, valign: 'top' });
  }

  const PUESTOS = [['encargado', 'Encargado de trabajo'], ['maquinista', 'Maquinista tipo A'], ['piloto', 'Piloto'], ['omi', 'OMI'], ['operario', 'Operario/s']];
  seccion(c, `PERSONAL (${parte.personal.length})`);
  tabla(c, [
    { t: 'PUESTO', w: 50 }, { t: 'NOMBRE Y APELLIDOS', w: 100 }, { t: 'EMPRESA', w: 70 }, { t: 'CATEGORÍA', w: AN - 220 },
  ], PUESTOS.flatMap(([clave, titulo]) => {
    const gente = parte.personal.filter((x) => x.puesto === clave);
    return gente.length ? gente.map((x) => [titulo, x.nombre + (x.otro ? ' *' : ''), x.empresa, x.categoria]) : [[titulo, '-', '', '']];
  }));
  if (parte.personal.some((x) => x.otro)) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.text('* Añadido a mano: no está en la lista de la oficina.', M, c.y + 1, { baseline: 'top' });
    c.y += 4;
  }

  pdfHorasExtra(c, parte);
}

// ---------- Parte HERBICIDA (como «PARTE HERBICIDA» en papel) ----------
// Hoja A4 vertical, calcada del papel: cabecera (encargado y fecha), personal, ocupaciones de vía con la
// descripción, casos SIOS en dos columnas con la superficie total, casillas antiincendios y producto con
// la firma del aplicador. Lo que el papel no tiene (medio, solo una parte, sin fotos, L/ha) va dentro de
// su celda o en una línea debajo de la tabla. Sin anexo de fotos: van sueltas en la carpeta del parte.

const ROJO = [170, 0, 0];

/** Una celda suelta en (x, y): para las que ocupan varias filas (cabecera, descripción, firma). */
function caja(doc, x, y, w, h, texto, { s = 8, b = false, a = 'center', fill = null } = {}) {
  if (fill) { doc.setFillColor(...fill); doc.rect(x, y, w, h, 'FD'); } else doc.rect(x, y, w, h, 'S');
  if (texto == null || texto === '') return;
  const ls = lineas(doc, texto, w, s, b);
  const alto = ls.length * s * PT * 1.18;
  const tx = a === 'center' ? x + w / 2 : a === 'right' ? x + w - PAD : x + PAD;
  doc.text(ls, tx, y + Math.max(PAD, (h - alto) / 2), { baseline: 'top', align: a, lineHeightFactor: 1.18 });
}

/** Cabecera de una tabla del papel: gris, en negrita y centrada. cols: [[texto, ancho]]. */
const cabTabla = (cols, s = 6.5) => cols.map(([t, w]) => ({ w, t, fill: GRIS, b: true, s, a: 'center' }));

function cuerpoHerbicida(c, parte, cab) {
  const { doc } = c;
  const W = c.an;
  const k = calculosHerbicida(parte);

  // Cabecera: empresas, título, encargado y fecha (día, mes y año, cada uno en su casilla).
  const y0 = c.y;
  doc.rect(M, y0, 40, 14, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 120, 70);
  doc.text('coalvi', M + 4, y0 + 3, { baseline: 'top' });
  doc.setTextColor(30, 90, 170);
  doc.text('rover', M + 23, y0 + 3, { baseline: 'top' });
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.text('MANTENIMIENTO LAV ESTE UTE', M + 20, y0 + 10, { baseline: 'top', align: 'center' });
  caja(doc, M + 40, y0, W - 100, 14, 'PARTE HERBICIDA', { s: 15, b: true });
  const xd = M + W - 60;
  caja(doc, xd, y0, 36, 7, 'ENCARGADO', { s: 7.5 });
  caja(doc, xd + 36, y0, 24, 7, 'FECHA', { s: 7.5 });
  caja(doc, xd, y0 + 7, 36, 7, parte.capataz, { s: 7, b: true });
  const [aa, mm, dd] = String(parte.fecha || '').split('-');
  [dd, mm, aa].forEach((v, j) => caja(doc, xd + 36 + j * 8, y0 + 7, 8, 7, v || '', { s: j === 2 ? 6 : 7.5, b: true }));
  c.y = y0 + 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(90, 90, 90);
  doc.text(limpia(`Ref. ${parte.ref}${parte.rev > 1 ? `   ·   Rev. ${parte.rev}` : ''}${[cab.empresa, cab.ambito].filter(Boolean).map((x) => `   ·   ${x}`).join('')}`),
    M, c.y + 1, { baseline: 'top' });
  doc.setTextColor(0, 0, 0);
  c.y += 4.5;
  avisoRectificativo(c, parte);

  // Personal: el capataz es el aplicador cualificado (va el primero); los demás, básicos autorizados.
  // Las horas extra van en HORAS y su tipo y motivo en OBSERVACIONES (el papel no tiene más sitio).
  const gente = [...parte.personal].sort((a, b) => Number(mismoNombre(b.nombre, parte.capataz)) - Number(mismoNombre(a.nombre, parte.capataz)));
  const extra = (x) => (parte.usaExtras && (parte.extras || []).find((e) => e.nombre === x.nombre && Number(e.horas) > 0)) || null;
  const colsP = [['PERSONAL', 92], ['ET / PSH', 18], ['CATEGORIA', 24], ['HORAS', 18], ['OBSERVACIONES', W - 152]];
  const filasP = gente.map((x) => {
    const e = extra(x);
    return [`${mismoNombre(x.nombre, parte.capataz) ? 'Cualificado' : 'Básico'}: ${x.nombre}${x.otro ? ' *' : ''}`, '', x.categoria,
      e ? `${String(e.horas).replace('.', ',')} extra` : '',
      [x.empresa, e && [e.tipo, e.motivo].filter(Boolean).join(': ')].filter(Boolean).join(' · ')];
  });
  while (filasP.length < 6) filasP.push([filasP.length ? 'Básico:' : 'Cualificado:', '', '', '', '']);
  c.y += 2;
  fila(c, cabTabla(colsP, 7.5), { minH: 6 });
  for (const f of filasP) {
    fila(c, f.map((t, j) => ({ w: colsP[j][1], t, s: j === 4 ? 6.5 : 7.5, a: j === 0 || j === 4 ? 'left' : 'center' })), { minH: 5.5 });
  }
  if (gente.some((x) => x.otro)) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.text('* Añadido por el capataz: no está en la lista de la oficina.', M, c.y + 1, { baseline: 'top' });
    c.y += 4;
  }

  if (parte.sinTrabajos) { seccionSinTrabajos(c, parte); return; }

  // Ocupaciones de vía: tres filas como mínimo (como el papel) y la descripción del trabajo a la derecha.
  const ocs = parte.sinOcupacion ? [] : (parte.ocupaciones || []);
  const colsO = [['Nº\nACTA', 13], ['Nº TELEF\n/ HORA', 16], ['HORA\nENTRADA', 15], ['HORA\nSALIDA', 14], ['LINEA', 11], ['VIA', 10],
    ['PK INICIO', 18], ['PK FINAL', 18], ['¿FIN?\nSI/NO', 11]];
  const wIzq = colsO.reduce((s, [, w]) => s + w, 0);
  const nO = Math.max(3, ocs.length);
  c.y += 3;
  if (c.y + 8 + nO * 6 > fondo(c)) nuevaPagina(c);
  fila(c, [...cabTabla(colsO), { w: W - wIzq, t: 'DESCRIPCION TRABAJOS', fill: GRIS, b: true, s: 7.5, a: 'center' }], { minH: 8 });
  const yDesc = c.y;
  c.sinSalto = true;   // la descripción es una sola caja al lado de estas filas: no se parten
  for (let j = 0; j < nO; j++) {
    const o = ocs[j];
    const v = o ? [o.acta, o.telefonema, o.entrada, o.salida, o.linea, o.via, o.pkInicio, o.pkFin, SI_NO(o.terminada)] : colsO.map(() => '');
    fila(c, v.map((t, i) => ({ w: colsO[i][1], t, s: 7, a: 'center' })), { minH: 5.5 });
  }
  c.sinSalto = false;
  const maq = parte.maquinaHer && parte.maquinaHer.descripcion ? ` (${parte.maquinaHer.descripcion})` : '';
  const medios = [parte.usaMochila && 'Mochila', parte.usaMaquina && `Máquina${maq}`].filter(Boolean).join(' y ');
  caja(doc, M + wIzq, yDesc, W - wIzq, c.y - yDesc, [
    `Riego de herbicida: ${parte.trabajos.length} caso(s) SIOS, ${fmtNum(k.m2)} m².`,
    medios && `Con ${medios}.`,
    parte.sinOcupacion && `Hoy no se ha ocupado la vía. Hora de inicio: ${parte.horaInicio || '-'} · Hora de fin: ${parte.horaFin || '-'}.`,
  ].filter(Boolean).join('\n'), { s: 7.5, a: 'left' });

  // Casos SIOS en una sola columna (Ricardo, 12/11: caben mejor que en las dos del papel), con su PK, el
  // medio y, en rojo, los que van sin fotos. Al final, la superficie total, como en el papel.
  const casos = parte.trabajos || [];
  const colsC = [{ t: 'Nº', w: 9, a: 'center' }, { t: 'Línea', w: 15, a: 'center' }, { t: 'Caso SIOS', w: 28, a: 'center' },
    { t: 'P.K.', w: 46, a: 'center' }, { t: 'Medio', w: 22, a: 'center' }, { t: 'Superficie m2', w: 30, a: 'center' },
    { t: 'Zona / observaciones', w: W - 150 }];
  c.y += 3;
  tabla(c, colsC, casos.map((t, i) => {
    const rojo = (v) => (t.sinFotos ? { t: v, color: ROJO } : v);
    return [String(i + 1), t.linea, rojo((t.referencia && t.referencia.codigo) || ''), [t.pkInicio, t.pkFin].filter(Boolean).join(' - '),
      NOMBRE_MEDIO[medioCaso(parte, t)] || '-',
      t.parcial ? `${fmtNum(m2Caso(t))} de ${fmtNum(t.superficie)}\n(solo una parte)` : fmtNum(m2Caso(t)),
      rojo([t.ubicacion, t.sinFotos && 'SIN FOTOS'].filter(Boolean).join(' · '))];
  }), { vacio: 'Sin casos' });
  fila(c, [{ w: 120, t: 'Superficie Total', fill: GRIS, b: true, s: 8, a: 'right' }, { w: 30, t: `${fmtNum(k.m2)} m²`, b: true, s: 8, a: 'center' },
    { w: W - 150, t: '' }], { minH: 6 });
  // Debajo: m² por medio, hectáreas, fotos y, en rojo, los casos sin fotos.
  const porMedio = Object.entries(k.porMedio).filter(([, v]) => v).map(([m, v]) => `${NOMBRE_MEDIO[m]}: ${fmtNum(v)} m²`);
  const nFotos = casos.reduce((n, t) => n + (t.fotos || []).length, 0);
  fila(c, [{ w: W, s: 7, t: [...porMedio, `${fmtNum(k.ha)} ha`,
    `${nFotos} foto${nFotos === 1 ? '' : 's'} en la carpeta del parte (con el nº SIOS en el nombre de cada una)`].join('   ·   ') }], { minH: 5.5 });
  const sinFotos = casos.map((t, i) => ({ t, i })).filter(({ t }) => t.sinFotos);
  if (sinFotos.length) {
    fila(c, [{ w: W, s: 7.5, b: true, color: ROJO,
      t: `SIN FOTOS: ${sinFotos.map(({ t, i }) => `caso ${i + 1} (SIOS ${(t.referencia && t.referencia.codigo) || ''}): ${t.motivoSinFotos || ''}`).join('; ')}` }], { minH: 6 });
  }

  // Medidas antiincendios: las dos casillas del papel (extintores / otros medios).
  const medidas = parte.medidas || [];
  const extintores = medidas.some((x) => /^extintor/i.test(x));
  const otras = [...medidas.filter((x) => !/^extintor/i.test(x)), parte.medidasOtrasSi && (parte.medidasOtras || '').trim()].filter(Boolean).join('; ');
  c.y += 3;
  if (c.y + 14 > fondo(c)) nuevaPagina(c);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('SE TOMAN MEDIDAS PREVENTIVAS ANTIINCENDIOS:', M, c.y, { baseline: 'top' });
  c.y += 5;
  const casilla = (x, marcada) => {
    doc.rect(x, c.y + 0.3, 3, 3, 'S');
    if (marcada) { doc.line(x + 0.5, c.y + 0.8, x + 2.5, c.y + 2.8); doc.line(x + 2.5, c.y + 0.8, x + 0.5, c.y + 2.8); }
  };
  casilla(M + 2, extintores);
  doc.text('EXTINTORES', M + 7, c.y, { baseline: 'top' });
  casilla(M + 40, Boolean(otras));
  doc.text('OTROS MEDIOS:', M + 45, c.y, { baseline: 'top' });
  const xo = M + 72;
  const lo = lineas(doc, otras, M + W - xo, 8, false);
  if (lo.length) doc.text(lo, xo + PAD, c.y + 0.3, { baseline: 'top', lineHeightFactor: 1.18 });
  const altoO = Math.max(1, lo.length) * 8 * PT * 1.18;
  doc.line(xo, c.y + altoO + 0.8, M + W, c.y + altoO + 0.8);
  c.y += altoO + 3.5;

  // Producto y caldo, con la firma del aplicador cualificado a la derecha (como el papel). El producto
  // por hectárea, que el papel no tiene, va debajo del producto total.
  const colsPr = [['Producto', 40], ['Dosis / Litro', 22], ['Caldo / Hectárea', 26], ['Producto Total Utilizado', 36], ['Caldo Total Utilizado', 26]];
  const wPr = colsPr.reduce((s, [, w]) => s + w, 0);
  const nP = Math.max(3, k.productos.length);
  if (c.y + 8 + nP * 6.5 + 7 > fondo(c)) nuevaPagina(c);
  fila(c, [...colsPr.map(([t, w]) => ({ w, t, fill: GRIS, s: 7, a: 'center' })),
    { w: W - wPr, t: 'Firma Aplicador\nCualificado', fill: GRIS, s: 7, a: 'center' }], { minH: 8 });
  const yFirma = c.y;
  c.sinSalto = true;   // la firma es una sola caja al lado de estas filas
  for (let j = 0; j < nP; j++) {
    const x = k.productos[j];
    const v = [x ? x.nombre : '', x ? `${fmtNum(x.dosis)} ml/L` : '', j === 0 ? `${fmtNum(k.caldoHa)} L/ha` : '',
      x ? `${fmtNum(x.total)} L\n(${fmtNum(x.porHa)} L/ha)` : '', j === 0 ? `${fmtNum(k.caldo)} L` : ''];
    fila(c, v.map((t, i) => ({ w: colsPr[i][1], t, s: 7.5, a: i === 0 ? 'left' : 'center' })), { minH: 6 });
  }
  c.sinSalto = false;
  caja(doc, M + wPr, yFirma, W - wPr, c.y - yFirma, `${parte.capataz}\nFirmado al cerrar el parte en el móvil:\n${fmtFechaHora(parte.cierre) || '-'}`, { s: 6.5 });
  fila(c, [{ w: W, s: 7.5, b: true, color: parte.confirmaCantidades ? undefined : ROJO,
    t: parte.confirmaCantidades ? 'El aplicador confirma que son las cantidades reales.' : 'SIN CONFIRMAR que son las cantidades reales.' }], { minH: 6 });

  if ((parte.observaciones || '').trim()) {
    fila(c, [{ w: 30, t: 'OBSERVACIONES', fill: GRIS, b: true, s: 7 }, { w: W - 30, t: parte.observaciones, s: 7.5 }], { minH: 7, valign: 'top' });
  }
}
