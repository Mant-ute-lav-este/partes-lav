// Registro de fallos de campo: avisa a la oficina (hoja «Errores») de lo que falla en los móviles.
// No lleva datos personales: se limpia el texto de correos y números largos, y el servidor
// guarda solo un código del usuario, no su nombre ni su correo.
// Aquí va también el aviso de «cerrar sesión» al servidor: es el mismo tipo de envío de apoyo,
// que espera a la cobertura y nunca rompe nada.

import * as db from './db.js';
import { api } from './servidor.js';

const MAX_PENDIENTES = 20;
let version = '';
let enCurso = false;

export function iniciarFallos(v) { version = v; }

/** Los fallos sin mandar. Hasta la 0.20.2 esta clave podía guardar los intentos de PIN ({ n, hasta }): eso se ignora. */
async function pendientesGuardados() {
  const v = await db.kvGet('fallos');
  return Array.isArray(v) ? v : [];
}

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
    const pendientes = await pendientesGuardados();
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
    const pendientes = await pendientesGuardados();
    if (!perfil || !perfil.token || !pendientes.length || !navigator.onLine) return;
    await api('fallo', { token: perfil.token, fallos: pendientes }, { intentos: 1, timeout: 15000 });
    // Quita solo los enviados: puede haber entrado alguno nuevo mientras tanto.
    const ahora = await pendientesGuardados();
    await db.kvSet('fallos', ahora.slice(pendientes.length));
  } catch { /* se reintenta en el próximo arranque o al volver la cobertura */ } finally {
    enCurso = false;
  }
}

// ---------- Sesiones cerradas en el móvil ----------

const MAX_SESIONES = 10;
let cerrando = false;

async function sesionesGuardadas() {
  const v = await db.kvGet('sesionesPorCerrar');
  return Array.isArray(v) ? v : [];
}

/** Al cerrar sesión: el token se apunta y se avisa al servidor para que deje de valer. Nunca lanza error. */
export async function apuntarSesionCerrada(token) {
  try {
    const lista = await sesionesGuardadas();
    if (!lista.includes(token)) await db.kvSet('sesionesPorCerrar', [...lista, token].slice(-MAX_SESIONES));
    await cerrarSesionesPendientes();
  } catch { /* sin almacenamiento: la sesión caducará sola en el servidor */ }
}

/**
 * Manda `salir` por cada sesión apuntada. Sale de la lista cuando el servidor contesta, también si
 * dice que ya no valía; sin cobertura se queda para el próximo arranque o al volver la señal.
 */
export async function cerrarSesionesPendientes() {
  if (cerrando) return;
  cerrando = true;
  try {
    for (const token of await sesionesGuardadas()) {
      if (!navigator.onLine) return;
      try {
        await api('salir', { token }, { intentos: 1, timeout: 15000 });
      } catch (e) {
        if (e.red) return;
      }
      await db.kvSet('sesionesPorCerrar', (await sesionesGuardadas()).filter((t) => t !== token));
    }
  } catch { /* se reintenta más tarde */ } finally {
    cerrando = false;
  }
}
