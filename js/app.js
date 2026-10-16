// Partes LAV: app del capataz. Todo se guarda en el móvil y funciona sin cobertura.
// El capataz se registra con su Gmail; al pulsar Enviar, el parte va al servidor
// (servidor/Code.gs), que lo manda por correo a la oficina. Si no hay cobertura se queda
// en cola y sale solo al volver la señal. Sin servidor configurado (copias de prueba), la lista
// se carga desde un archivo y el parte se envía con Gmail.
//
// Este archivo solo arranca la app. El resto está en js/: estado.js (estado compartido, navegación
// y guardado), vista-*.js (pantallas), campos.js (piezas de formulario), eventos.js (botones y
// formularios), validaciones.js (lo que falta para cerrar un parte) y modelo.js (datos del parte).

import * as db from './db.js';
import { hayServidor, SERVIDOR_URL } from './servidor.js';
import { iniciarFallos, registrarFallo, enviarFallos } from './fallos.js';
import { esc } from './util.js';
import { app, estado, sincronizar, refrescarVista, ir, guardarYa } from './estado.js';
import { onInput, onChange, onSubmit, onClick } from './eventos.js';

export const APP_VERSION = '0.13.0';

// ---------- Arranque ----------

async function iniciar() {
  iniciarFallos(APP_VERSION);
  window.addEventListener('error', (ev) => registrarFallo('js', ev.message));
  window.addEventListener('unhandledrejection', (ev) => registrarFallo('js', (ev.reason && ev.reason.message) || ev.reason));
  enviarFallos();
  if ('serviceWorker' in navigator) {
    const habiaVersion = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      // Buscar versión nueva también al volver a la app (Android la deja abierta en segundo plano).
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.tipo === 'salida') refrescarVista();
    });
    // Cuando entra una versión nueva: se recarga sola, salvo a mitad de un parte, que avisa.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!habiaVersion) return;   // primera instalación: no hace falta recargar
      if (estado.parte && (estado.vista === 'parte' || estado.vista === 'trabajo')) avisoVersionNueva();
      else location.reload();
    });
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.addEventListener('online', () => { if (estado.perfil && estado.perfil.token && estado.vista !== 'pin') sincronizar(); });
  app.addEventListener('click', onClick);
  app.addEventListener('input', onInput);
  app.addEventListener('change', onChange);
  app.addEventListener('submit', onSubmit);
  try {
    estado.config = await db.kvGet('config');
    estado.perfil = await db.kvGet('perfil');
    estado.otros = (await db.kvGet('otros')) || [];
    await db.kvSet('servidorUrl', SERVIDOR_URL);   // el service worker la lee para enviar en segundo plano
  } catch (e) {
    app.innerHTML = `<p class="error">No se puede usar el almacenamiento del móvil: ${esc(e.message)}</p>`;
    return;
  }
  // Con servidor hay que estar registrado: un perfil antiguo, sin registro, vuelve a la bienvenida.
  if (estado.perfil && (estado.perfil.token || !hayServidor())) return ir('pin');
  if (hayServidor()) return ir('bienvenida');
  if (!estado.config) return ir('setup-datos');
  return ir('setup-capataz');
}

/** Barra fija arriba para actualizar sin perder nada de lo que se está escribiendo. */
function avisoVersionNueva() {
  if (document.getElementById('version-nueva')) return;
  const d = document.createElement('div');
  d.id = 'version-nueva';
  d.className = 'version-nueva';
  d.innerHTML = '<span>Hay una versión nueva de la app.</span><button class="btn mini">Actualizar</button>';
  d.querySelector('button').addEventListener('click', async () => {
    await guardarYa();
    location.reload();
  });
  document.body.append(d);
}

iniciar();
