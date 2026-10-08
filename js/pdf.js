// PDF A4 apaisado con el aspecto del parte en papel. Se genera en el móvil con jsPDF.

import { fmtFecha, fmtFechaHora, FORMATO1 } from './util.js';

const PT = 0.3528;              // 1 punto tipográfico en mm
const M = 8;                    // margen
const AN = 297 - 2 * M;         // ancho útil (281 mm)
const FONDO = 210 - 12;         // límite inferior (deja sitio al pie)
const PAD = 1.2;
const GRIS = [222, 222, 222];
const OSCURO = [45, 45, 45];

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
  if (c.y + h > FONDO && !c.sinSalto) nuevaPagina(c);
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
  if (c.y + 2 + 6 + reserva > FONDO) nuevaPagina(c); else c.y += 2.5;
  const { doc } = c;
  doc.setFillColor(...OSCURO);
  doc.rect(M, c.y, AN, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text(limpia(titulo), M + 2, c.y + 1.4, { baseline: 'top' });
  doc.setTextColor(0, 0, 0);
  c.y += 6;
}

/** Tabla con cabecera que se repite al saltar de página. cols: [{ t, w, a }]. */
function tabla(c, cols, filas, { s = 7.5, vacio = '' } = {}) {
  const cab = () => fila(c, cols.map((col) => ({ w: col.w, t: col.t, fill: GRIS, b: true, s: 6.5, a: 'center' })), { minH: 6 });
  if (c.y + 14 > FONDO) nuevaPagina(c);
  cab();
  if (!filas.length && vacio) {
    fila(c, [{ w: AN, t: vacio, s, color: [90, 90, 90] }]);
    return;
  }
  for (const f of filas) {
    const celdas = cols.map((col, i) => ({ w: col.w, t: f[i], s, a: col.a || 'left' }));
    if (c.y + altoFila(c.doc, celdas) > FONDO) { nuevaPagina(c); cab(); }
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

const FASE_TXT = { antes: 'ANTES', durante: 'DURANTE', despues: 'DESPUÉS' };

/** Reduce la foto para el anexo del PDF (las originales van aparte, a tamaño completo). */
async function reducir(blob, lado = 1100, calidad = 0.72) {
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
async function paginasFotos(c, parte, leerFoto, lista, nombreAnexo, textoPie, lado = 1100, calidad = 0.72) {
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
  const doc = new J({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setLineWidth(0.2);
  doc.setDrawColor(0, 0, 0);
  doc.setProperties({
    title: `Parte ${parte.tipo} ${fmtFecha(parte.fecha)} ${parte.ref}`,
    subject: 'Parte de trabajo diario',
    author: parte.capataz,
    creator: `Partes LAV ${versionApp}`,
  });
  const c = { doc, y: M };
  const cab = (config && config.cabecera) || {};
  const tipoTxt = parte.tipo === 'INFRA' ? 'INFRAESTRUCTURA' : 'SUPERESTRUCTURA';
  const linea = parte.tipo === 'INFRA' ? cab.lineaInfra : cab.lineaSuper;
  const L = { fill: GRIS, b: true, s: 7 };   // estilo de etiqueta

  if (parte.tipo === 'MAQUINARIA') {
    cuerpoMaquinaria(c, parte, cab);
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

  if (parte.rectificaA) {
    c.y += 1.5;
    fila(c, [{
      w: AN, b: true, s: 8.5, color: [170, 0, 0],
      t: `PARTE RECTIFICATIVO: sustituye a la revisión ${parte.rectificaA.rev} de este parte` +
        `${parte.rectificaA.cierre ? ` (cerrada el ${fmtFechaHora(parte.rectificaA.cierre)})` : ''}.`,
    }], { minH: 7 });
  }

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

  pdfHorasExtra(c, parte);

  // Trabajos
  seccion(c, `TRABAJOS (${parte.trabajos.length})`, 20);
  // Solo INFRA lleva la columna RREE/POI (trabajos de coste directo, que se facturan aparte).
  const conCoste = parte.tipo === 'INFRA';
  const ANCHO_COSTE = 14;
  tabla(c, [
    { t: 'Nº', w: 7, a: 'center' }, { t: 'REFERENCIA', w: 30 },
    ...(conCoste ? [{ t: 'RREE /\nPOI', w: ANCHO_COSTE, a: 'center' }] : []),
    { t: 'Nº PIDAME', w: 18 },
    { t: 'TELEFONEMAS', w: 20 }, { t: 'ENTRADA\nVÍA', w: 15, a: 'center' }, { t: 'SALIDA\nVÍA', w: 13, a: 'center' },
    { t: 'LÍNEA', w: 11, a: 'center' }, { t: 'VÍA', w: 9, a: 'center' }, { t: 'APARATO', w: 16 },
    { t: 'P.K. INICIO', w: 16, a: 'center' },
    { t: 'P.K. FIN', w: 16, a: 'center' }, { t: 'M. LIN', w: 11, a: 'center' }, { t: 'MOTIVO ACTUACIÓN', w: 26 },
    { t: '¿FIN?', w: 10, a: 'center' }, { t: 'DESCRIPCIÓN', w: AN - 218 - (conCoste ? ANCHO_COSTE : 0) },
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
    t.aparato || '',
    t.pkInicio,
    t.pkFin,
    t.metrosLineales == null ? '' : String(t.metrosLineales),
    t.motivoActuacion,
    t.finalizado === true ? 'SÍ' : t.finalizado === false ? 'NO' : '',
    `${t.descripcion || ''}\n${contarFotos(t)}`,
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

  if (leerFoto) {
    await anexoFotos(c, parte, leerFoto);
    if (parte.tipo === 'SUPER') await anexoFormato(c, parte, leerFoto);
  }

  pdfPie(c, parte, versionApp);
  return doc.output('blob');
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
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(90, 90, 90);
    const yPie = 210 - 7;
    doc.text(limpia(`Cerrado en el móvil: ${fmtFechaHora(parte.cierre) || '-'}`), M, yPie);
    doc.text(limpia(`Partes LAV ${versionApp} · id ${parte.id.slice(0, 8)}`), 297 / 2, yPie, { align: 'center' });
    doc.text(`Página ${i} de ${n}`, 297 - M, yPie, { align: 'right' });
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

function cuerpoMaquinaria(c, parte, cab) {
  const { doc } = c;
  const L = { fill: GRIS, b: true, s: 7 };
  fila(c, [
    { w: 52, t: `Ref. ${parte.ref}${parte.rev > 1 ? `   ·   Rev. ${parte.rev}` : ''}`, b: true, s: 9 },
    { w: AN - 104, t: 'PARTE DE MAQUINARIA', b: true, s: 14, a: 'center' },
    { w: 52, t: `Fecha ${fmtFecha(parte.fecha)}\nHorario ${parte.horaInicio || '--:--'} - ${parte.horaFin || '--:--'}`, b: true, s: 9, a: 'center' },
  ], { minH: 13 });
  fila(c, [
    { ...L, w: 22, t: 'EMPRESA' }, { w: 70, t: cab.empresa || '', b: true },
    { ...L, w: 22, t: 'LO RELLENA' }, { w: 70, t: parte.capataz, b: true },
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
  const op = (AN - 141) / 5;
  tabla(c, [
    { t: 'Nº', w: 7, a: 'center' }, { t: 'LLEGADA\nTAJO', w: 15, a: 'center' }, { t: 'INICIO\nTRABAJO', w: 15, a: 'center' },
    { t: 'FIN\nTRABAJO', w: 15, a: 'center' }, { t: 'SALIDA\nTAJO', w: 15, a: 'center' }, { t: 'VÍA', w: 9, a: 'center' },
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
