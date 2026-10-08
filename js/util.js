// Utilidades comunes: escape de HTML, fechas locales, nombres de archivo y avisos.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

export const uuid = () => crypto.randomUUID();

// Formato que el SUPER puede adjuntar (impreso de cómo se va a proteger la vía).
// Cuando se sepa su nombre real, basta con cambiarlo aquí.
export const FORMATO1 = 'Formato 1';
export const MAX_FORMATO1 = 6;        // fotos como máximo
export const LADO_FORMATO1 = 2400;    // píxeles del lado largo (más que las fotos normales: se lee letra a mano)

const p2 = (n) => String(n).padStart(2, '0');

/** Fecha local "AAAA-MM-DD". */
export function fechaLocal(d = new Date()) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Fecha y hora local con zona horaria: "2026-10-02T07:12:33+02:00". */
export function isoLocal(d = new Date()) {
  const off = -d.getTimezoneOffset();
  const signo = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${fechaLocal(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}` +
    `${signo}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

/** "2026-10-02" o "2026-10-02T07:12..." → "02/10/2026". */
export function fmtFecha(f) {
  if (!f) return '';
  const [y, m, d] = String(f).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "2026-10-02T07:12:33+02:00" → "02/10/2026 07:12". */
export function fmtFechaHora(iso) {
  if (!iso) return '';
  return `${fmtFecha(iso)} ${String(iso).slice(11, 16)}`;
}

/** Minúsculas y sin tildes, para buscar. */
export function normaliza(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Texto apto para nombres de archivo y carpetas: "José Mª Pérez" → "Jose_M_Perez". */
export function slug(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'SinNombre';
}

export function debounce(fn, ms) {
  let t = null;
  let args = null;
  const f = (...a) => { args = a; clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  f.flush = () => { if (t) { clearTimeout(t); t = null; return fn(...args); } };
  return f;
}

export function blobABase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

/** Lee o escribe una ruta tipo "trabajos.0.referencia.tipo". */
export function getPath(obj, ruta) {
  return ruta.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, ruta, valor) {
  const ks = ruta.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
    o = o[ks[i]];
  }
  o[ks[ks.length - 1]] = valor;
}

let toastT = null;
export function toast(msg, ms = 2800) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('visible'), ms);
}
