// PDF A4 apaisado con el aspecto del parte en papel. Se genera en el móvil con jsPDF.

import { fmtFecha, fmtFechaHora } from './util.js';

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

function contarFotos(t) {
  const n = (f) => t.fotos.filter((x) => x.fase === f).length;
  return `Fotos: ${n('antes')} antes · ${n('durante')} durante · ${n('despues')} después${t.fotos.length ? ' (ver anexo)' : ''}`;
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
  if (!lista.length) return;
  const { doc } = c;
  const hueco = 6;
  const anchoCelda = (AN - hueco) / 2;
  const tituloAnexo = `ANEXO FOTOGRÁFICO  ·  Ref. ${parte.ref}${parte.rev > 1 ? ` rev. ${parte.rev}` : ''}  ·  ` +
    `${parte.tipo === 'INFRA' ? 'Infraestructura' : 'Superestructura'}  ·  Jornada ${fmtFecha(parte.fecha)}  ·  ${parte.capataz}`;
  for (let k = 0; k < lista.length; k += 2) {
    nuevaPagina(c);
    fila(c, [{ w: AN, t: tituloAnexo, b: true, s: 9, fill: GRIS }], { minH: 8 });
    const y0 = c.y + 3;
    const altoMax = FONDO - y0 - 12;   // deja sitio al pie de foto
    for (let j = 0; j < 2 && k + j < lista.length; j++) {
      const { t, i, x } = lista[k + j];
      const x0 = M + j * (anchoCelda + hueco);
      let yPie = y0;
      const blob = await leerFoto(x.id);
      if (blob) {
        const img = await reducir(blob);
        const e = Math.min(anchoCelda / img.w, altoMax / img.h);
        const w = img.w * e;
        const h = img.h * e;
        doc.addImage(img.datos, 'JPEG', x0 + (anchoCelda - w) / 2, y0, w, h);
        doc.rect(x0 + (anchoCelda - w) / 2, y0, w, h, 'S');
        yPie = y0 + h + 2;
      }
      const pie = `Trabajo ${i + 1} · ${textoReferencia(t)} · ${FASE_TXT[x.fase] || x.fase} · ` +
        `${x.origen === 'galeria' ? 'Galería' : 'Cámara'} · ${fmtFechaHora(x.fechaFoto)}`;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(doc.splitTextToSize(limpia(pie), anchoCelda), x0 + anchoCelda / 2, yPie, { baseline: 'top', align: 'center' });
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

  // Horas extra (desde v0.8.0)
  if (parte.extras) {
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

  // Trabajos
  seccion(c, `TRABAJOS (${parte.trabajos.length})`, 20);
  tabla(c, [
    { t: 'Nº', w: 7, a: 'center' }, { t: 'REFERENCIA', w: 30 }, { t: 'Nº PIDAME', w: 18 },
    { t: 'TELEFONEMAS', w: 20 }, { t: 'ENTRADA\nVÍA', w: 15, a: 'center' }, { t: 'SALIDA\nVÍA', w: 13, a: 'center' },
    { t: 'LÍNEA', w: 11, a: 'center' }, { t: 'VÍA', w: 9, a: 'center' }, { t: 'APARATO', w: 16 },
    { t: 'P.K. INICIO', w: 16, a: 'center' },
    { t: 'P.K. FIN', w: 16, a: 'center' }, { t: 'M. LIN', w: 11, a: 'center' }, { t: 'MOTIVO ACTUACIÓN', w: 26 },
    { t: '¿FIN?', w: 10, a: 'center' }, { t: 'DESCRIPCIÓN', w: AN - 218 },
  ], parte.trabajos.map((t, i) => [
    String(i + 1),
    textoReferencia(t),
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

  if (leerFoto) await anexoFotos(c, parte, leerFoto);

  // Pie en todas las páginas
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
  return doc.output('blob');
}
