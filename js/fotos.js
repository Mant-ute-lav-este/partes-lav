// Fotos: lee la fecha original (EXIF), reduce el tamaño y añade el sello en una franja
// bajo la imagen. La foto se vuelve a generar desde cero con canvas, así que sale SIN
// ningún metadato: ni GPS, ni modelo de móvil, ni nada.

const LADO_MAX = 1600;     // píxeles del lado largo
const CALIDAD = 0.82;      // JPEG

export const FASES = { antes: 'ANTES', durante: 'DURANTE', despues: 'DESPUÉS' };

/** Busca en un JPEG la fecha de la foto. Devuelve { fechaOriginal, fecha, offsetOriginal } o null. */
export function leerExif(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;   // no es JPEG
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marca = v.getUint16(off);
    if ((marca & 0xFF00) !== 0xFF00 || marca === 0xFFDA || marca === 0xFFD9) break;
    const len = v.getUint16(off + 2);
    if (marca === 0xFFE1 && len >= 8 && v.getUint32(off + 4) === 0x45786966 && v.getUint16(off + 8) === 0) {
      return leerTiff(v, off + 10, off + 2 + len);
    }
    off += 2 + len;
  }
  return null;
}

function leerTiff(v, base, fin) {
  fin = Math.min(fin, v.byteLength);
  if (base + 8 > fin) return null;
  const le = v.getUint16(base) === 0x4949;
  const u16 = (o) => v.getUint16(o, le);
  const u32 = (o) => v.getUint32(o, le);
  if (u16(base + 2) !== 42) return null;

  const ascii = (o, n) => {
    let s = '';
    for (let i = 0; i < n && o + i < fin; i++) {
      const c = v.getUint8(o + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  const recorrer = (ifd, cb) => {
    const p = base + ifd;
    if (p + 2 > fin) return;
    const n = u16(p);
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 12;
      if (e + 12 > fin) break;
      const tag = u16(e);
      const tipo = u16(e + 2);
      const cuenta = u32(e + 4);
      const texto = () => (tipo === 2 ? ascii(cuenta > 4 ? base + u32(e + 8) : e + 8, cuenta) : '');
      cb(tag, texto, e + 8);
    }
  };

  const res = {};
  let punteroExif = null;
  recorrer(u32(base + 4), (tag, texto, valor) => {
    if (tag === 0x8769) punteroExif = u32(valor);
    else if (tag === 0x0132) res.fecha = texto();
  });
  if (punteroExif) {
    recorrer(punteroExif, (tag, texto) => {
      if (tag === 0x9003) res.fechaOriginal = texto();
      else if (tag === 0x9011) res.offsetOriginal = texto();
    });
  }
  return res;
}

/** "2026:10:02 06:45:12" → "2026-10-02T06:45:12" (+ zona si se conoce). */
function fechaExifAIso(s, offset) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m || Number(m[1]) < 1995 || m[2] === '00') return null;
  const zona = /^[+-]\d{2}:\d{2}$/.test(offset || '') ? offset : '';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${zona}`;
}

function isoSinZona(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "2026-10-02T06:45:12" → "02/10/2026 06:45". */
function textoFecha(iso) {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

// ---------- Fotos HEIC ----------
// Muchos móviles guardan las fotos de la cámara en HEIC, que Chrome en Android no sabe abrir.
// Si una foto HEIC no se abre, se convierte a JPG en el propio móvil con heic2any. La librería
// solo se descarga si hace falta, y el service worker la deja guardada para usarla sin cobertura.
export const HEIC2ANY = 'https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js';
let heicCargando = null;

function cargarHeic2any() {
  if (window.heic2any) return Promise.resolve(window.heic2any);
  if (!heicCargando) {
    heicCargando = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = HEIC2ANY;
      s.onload = () => (window.heic2any ? res(window.heic2any) : rej(new Error('Convertidor HEIC no disponible')));
      s.onerror = () => { heicCargando = null; s.remove(); rej(new Error('No se pudo cargar el convertidor HEIC')); };
      document.head.append(s);
    });
  }
  return heicCargando;
}

/** ¿Es HEIC/HEIF? Por el tipo, la extensión o la firma del archivo («ftyp» + heic, heix, mif1…). */
export function esHeic(file, buf) {
  if (/hei[cf]/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '')) return true;
  if (!buf || buf.byteLength < 12) return false;
  const b = new Uint8Array(buf, 4, 8);
  const txt = String.fromCharCode(...b);
  return txt.startsWith('ftyp') && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(txt.slice(4));
}

/**
 * La fecha de una foto HEIC: el bloque EXIF va dentro del archivo con la cabecera «Exif\0\0»
 * seguida de la cabecera TIFF, igual que en un JPEG.
 */
export function leerExifHeic(buf) {
  const b = new Uint8Array(buf);
  for (let i = 0; i + 14 < b.length; i++) {
    if (b[i] !== 0x45 || b[i + 1] !== 0x78 || b[i + 2] !== 0x69 || b[i + 3] !== 0x66 || b[i + 4] || b[i + 5]) continue;
    const t = i + 6;
    const ii = b[t] === 0x49 && b[t + 1] === 0x49 && b[t + 2] === 0x2A && b[t + 3] === 0;
    const mm = b[t] === 0x4D && b[t + 1] === 0x4D && b[t + 2] === 0 && b[t + 3] === 0x2A;
    if (ii || mm) return leerTiff(new DataView(buf), t, Math.min(buf.byteLength, t + 262144));
  }
  return null;
}

async function decodificar(file, heic = false) {
  try {
    return await abrirImagen(file);
  } catch (e) {
    if (!heic) throw e;
    let h2a;
    try {
      h2a = await cargarHeic2any();
    } catch (err) {
      // Sin cobertura y sin el convertidor guardado todavía en el móvil.
      throw Object.assign(new Error('No se pudo cargar el convertidor HEIC'), { heicSinConvertir: true, causa: err });
    }
    const r = await h2a({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return abrirImagen(Array.isArray(r) ? r[0] : r);   // las HEIC con varias imágenes devuelven una lista
  }
}

async function abrirImagen(file) {
  // Chrome aplica la orientación EXIF al decodificar, así la foto no sale girada.
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function ajustarTexto(ctx, texto, anchoMax, tam) {
  let t = tam;
  ctx.font = `bold ${t}px sans-serif`;
  while (t > 10 && ctx.measureText(texto).width > anchoMax) {
    t -= 1;
    ctx.font = `bold ${t}px sans-serif`;
  }
}

/**
 * Procesa una foto de la cámara o de la galería.
 * @param {File} file
 * @param {{origen:'camara'|'galeria', fase:string, etiqueta:string, ref:string}} o
 * @returns {Promise<{blob:Blob, fechaFoto:string, fuenteFecha:'exif'|'captura'|'archivo', ancho:number, alto:number}>}
 */
export async function procesarFoto(file, { origen, fase, etiqueta, ref, faseTxt, ladoMax = LADO_MAX, calidad = CALIDAD }) {
  let exif = null;
  let buf = null;
  try { buf = await file.arrayBuffer(); } catch { buf = null; }
  const heic = esHeic(file, buf);
  try { exif = buf && (heic ? leerExifHeic(buf) : leerExif(buf)); } catch { exif = null; }

  let fechaFoto = fechaExifAIso(exif?.fechaOriginal, exif?.offsetOriginal) || fechaExifAIso(exif?.fecha);
  let fuenteFecha = 'exif';
  if (!fechaFoto) {
    if (origen === 'camara') {
      fechaFoto = isoSinZona(new Date());
      fuenteFecha = 'captura';
    } else {
      fechaFoto = isoSinZona(new Date(file.lastModified || Date.now()));
      fuenteFecha = 'archivo';
    }
  }

  if (!file.size) throw Object.assign(new Error('Archivo vacío'), { motivo: 'vacia' });
  let img;
  try {
    img = await decodificar(file, heic);
  } catch (e) {
    throw Object.assign(new Error('No se pudo abrir la imagen'), { motivo: 'formato', heic, sinConexion: Boolean(e && e.heicSinConvertir), causa: e });
  }
  const w0 = img.width || img.naturalWidth;
  const h0 = img.height || img.naturalHeight;
  if (!w0 || !h0) throw Object.assign(new Error('Imagen vacía'), { motivo: 'vacia' });
  const escala = Math.min(1, ladoMax / Math.max(w0, h0));
  const w = Math.round(w0 * escala);
  const h = Math.round(h0 * escala);
  const banda = Math.max(64, Math.round(Math.min(w, h) * 0.09));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h + banda;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  if (img.close) img.close();

  // Sello: franja negra bajo la foto, sin tapar nada de la imagen.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, h, w, banda);
  const origenTxt = origen === 'galeria'
    ? (fuenteFecha === 'exif' ? 'GALERÍA' : 'GALERÍA · FECHA DEL ARCHIVO')
    : 'CÁMARA';
  const linea1 = `${textoFecha(fechaFoto)} · ${etiqueta}`;
  const linea2 = `${faseTxt || FASES[fase] || fase} · ${origenTxt}${ref ? ` · ${ref}` : ''}`;
  const margen = Math.round(banda * 0.25);
  const tam = Math.round(banda * 0.32);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ajustarTexto(ctx, linea1, w - 2 * margen, tam);
  ctx.fillText(linea1, margen, h + banda * 0.3);
  ctx.fillStyle = origen === 'galeria' ? '#ffd23f' : '#fff';
  ajustarTexto(ctx, linea2, w - 2 * margen, Math.round(tam * 0.9));
  ctx.fillText(linea2, margen, h + banda * 0.72);

  const blob = await new Promise((res, rej) => canvas.toBlob(
    (b) => (b ? res(b) : rej(Object.assign(new Error('No se pudo generar la foto'), { motivo: 'memoria' }))), 'image/jpeg', calidad,
  ));
  const alto = canvas.height;
  canvas.width = 0;   // libera memoria en móviles modestos
  canvas.height = 0;
  return { blob, fechaFoto, fuenteFecha, ancho: w, alto };
}
