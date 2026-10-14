// Registro de fallos de campo: avisa a la oficina (hoja «Errores») de lo que falla en los móviles.
// No lleva datos personales: se limpia el texto de correos y números largos, y el servidor
// guarda solo un código del usuario, no su nombre ni su correo.

import * as db from './db.js';
import { api } from './servidor.js';

const MAX_PENDIENTES = 20;
let version = '';
let enCurso = false;

export function iniciarFallos(v) { version = v; }

/** Quita correos, números largos (teléfonos, DNI) y rutas de archivo; recorta a 200 caracteres. */
function limpiar(texto) {
  return String(texto == null ? '' : texto)
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[correo]')
    .replace(/\d{6,}/g, '[nº]')
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** Guarda el fallo en el móvil y intenta mandarlo. Nunca lanza error: es un apoyo, no puede romper nada. */
export async function registrarFallo(tipo, mensaje) {
  try {
    const pendientes = (await db.kvGet('fallos')) || [];
    const m = limpiar(mensaje);
    if (!m || pendientes.some((f) => f.tipo === tipo && f.mensaje === m)) return;
    pendientes.push({ tipo: String(tipo).slice(0, 20), mensaje: m, fecha: new Date().toISOString(), version });
    await db.kvSet('fallos', pendientes.slice(-MAX_PENDIENTES));
    enviarFallos();
  } catch { /* sin almacenamiento: nada que hacer */ }
}

/** Manda los fallos guardados. Si no hay cobertura o sesión, se quedan para la próxima. */
export async function enviarFallos() {
  if (enCurso) return;
  enCurso = true;
  try {
    const perfil = await db.kvGet('perfil');
    const pendientes = (await db.kvGet('fallos')) || [];
    if (!perfil || !perfil.token || !pendientes.length || !navigator.onLine) return;
    await api('fallo', { token: perfil.token, fallos: pendientes }, { intentos: 1, timeout: 15000 });
    // Quita solo los enviados: puede haber entrado alguno nuevo mientras tanto.
    const ahora = (await db.kvGet('fallos')) || [];
    await db.kvSet('fallos', ahora.slice(pendientes.length));
  } catch { /* se reintenta en el próximo arranque o al volver la cobertura */ } finally {
    enCurso = false;
  }
}
