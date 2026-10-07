// Partes LAV: app del capataz. Todo se guarda en el móvil y funciona sin cobertura.
// El capataz se registra con su Gmail; al pulsar Enviar, el parte va al servidor
// (servidor/Code.gs), que lo manda por correo a la oficina. Si no hay cobertura se queda
// en cola y sale solo al volver la señal. Sin servidor configurado (copias de prueba), la lista
// se carga desde un archivo y el parte se envía con Gmail.

import * as db from './db.js';
import { procesarFoto } from './fotos.js';
import { textoReferencia } from './pdf.js';
import { prepararEnvio, compartir } from './envio.js';
import { api, hayServidor, SERVIDOR_URL, alReintentar } from './servidor.js';
import { procesarSalida } from './salida.js';
import {
  esc, uuid, fechaLocal, isoLocal, fmtFecha, fmtFechaHora, normaliza, debounce, setPath, toast, blobABase64,
} from './util.js';

const APP_VERSION = '0.9.3';
const ITER_PIN = 150000;
const FASES = [['antes', 'Antes'], ['durante', 'Durante'], ['despues', 'Después']];
const app = document.getElementById('app');

const estado = {
  vista: 'cargando',
  config: null,          // lista de la oficina
  perfil: null,          // { capataz, pin: { salt, hash, iter } } + con registro: { email, token, cuenta }
  reg: {},               // datos del registro en curso: { email, codigo, nombres, nombre, filtro }
  otros: [],             // personas añadidas a mano, para no reescribirlas
  lista: [],             // partes (pantalla de inicio)
  parte: null,           // parte abierto
  trabajoIdx: null,
  busqueda: '',
  otroAbierto: false,
  errores: [],
  menu: false,
  fotoVista: null,
  fotoPendiente: null,
  procesando: '',
  envio: null,
  setupCapataz: '',
  cambiandoPin: false,
  preguntaOtro: false,   // «¿Has hecho otro trabajo?» al terminar el último trabajo
  preguntaExtras: false, // «¿Ha habido horas extra?» al cerrar el parte
};
const urls = new Map();   // id de foto → URL para las miniaturas

// ---------- Arranque y navegación ----------

async function iniciar() {
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

/** Tras desbloquear con el PIN: inicio y, si hay registro, sincroniza con el servidor. */
async function entrarApp() {
  await ir('inicio');
  if (estado.perfil && estado.perfil.token) sincronizar();
}

/** Actualiza la lista de la oficina y el estado de la cuenta, y envía lo que esté en cola. */
async function sincronizar({ avisar = false, lista = true } = {}) {
  if (!estado.perfil || !estado.perfil.token) return;
  if (lista) {
    try {
      await cargarConfigServidor();
    } catch (e) {
      if (avisar || !e.red) toast(e.message, 5000);
      if (e.red) return;
    }
  }
  const r = await procesarSalida();
  if (r.enviados) toast(r.enviados === 1 ? 'Parte recibido en la oficina ✓' : `${r.enviados} partes recibidos en la oficina ✓`, 4000);
  refrescarVista();
}

/** Descarga la lista de la oficina; la respuesta trae también el estado de la cuenta. */
async function cargarConfigServidor() {
  const r = await api('config', { token: estado.perfil.token });
  estado.config = r.config;
  await db.kvSet('config', r.config);
  const perfil = estado.perfil;
  if (r.estado && r.estado !== perfil.cuenta) {
    const aprobado = perfil.cuenta === 'pendiente' && r.estado === 'activo';
    perfil.cuenta = r.estado;
    await db.kvSet('perfil', perfil);
    if (aprobado) toast('La oficina ha aprobado tu registro ✓', 4000);
  }
}

/** Vuelve a pintar inicio o envío con los datos guardados (p. ej. tras un envío en segundo plano). */
async function refrescarVista() {
  if (estado.vista === 'inicio') {
    estado.lista = await db.listarPartes();
    render();
  } else if (estado.vista === 'envio' && estado.parte) {
    const p = await db.getParte(estado.parte.id);
    if (p) { estado.parte = p; render(); }
  }
}

function registrarSync() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => (reg.sync ? reg.sync.register('partes-salida') : null))
    .catch(() => {});
}

async function ir(vista) {
  if (estado.parte && (estado.vista === 'parte' || estado.vista === 'trabajo')) await guardarYa();
  if (vista === 'inicio') {
    estado.parte = null;
    estado.envio = null;
    liberarFotos();
    estado.lista = await db.listarPartes();
  }
  if (vista !== 'parte') {
    estado.busqueda = '';
    estado.otroAbierto = false;
  }
  estado.vista = vista;
  estado.errores = [];
  estado.menu = false;
  estado.fotoVista = null;
  estado.preguntaOtro = false;
  estado.preguntaExtras = false;
  render();
  window.scrollTo(0, 0);
  if (vista === 'envio') prepararEnvioActual();
}

function render() {
  const vistas = {
    bienvenida: vBienvenida, 'reg-email': vRegEmail, 'reg-codigo': vRegCodigo, 'reg-nombre': vRegNombre,
    'reg-pin': vRegPin, login: vLogin, 'rec-email': vRecEmail, 'rec-pin': vRecPin,
    'setup-datos': vSetupDatos, 'setup-capataz': vSetupCapataz, 'setup-pin': vSetupPin, pin: vPin,
    inicio: vInicio, parte: vParte, trabajo: vTrabajo, envio: vEnvio,
  };
  const y = window.scrollY;
  app.innerHTML = (vistas[estado.vista] || (() => '<p class="cargando">Cargando…</p>'))() +
    (estado.procesando ? `<div class="capa centro"><div class="hoja pequena"><div class="girando"></div><p>${esc(estado.procesando)}</p></div></div>` : '');
  window.scrollTo(0, y);
  document.body.classList.toggle('sin-scroll',
    Boolean(estado.menu || estado.fotoVista || estado.preguntaOtro || estado.preguntaExtras || estado.errores.length || estado.procesando));
  pintarResultados();
  pintarNombres();
  cargarMiniaturas();
  const auto = app.querySelector('[data-autofocus]');
  if (auto) auto.focus();
}

// ---------- Registro con Gmail ----------

function barraSimple(titulo, volver) {
  return `
  <header class="barra">
    ${volver ? `<button class="btn-volver" data-action="ir" data-vista="${volver}">‹ Atrás</button>` : ''}
    <div class="barra-titulo">${titulo}</div>
  </header>`;
}

function vBienvenida() {
  return `
  ${barraSimple('Partes LAV')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>Bienvenido</h2>
      <p>Para usar la app tienes que registrarte con tu correo de Gmail. Solo se hace una vez.</p>
      <button class="btn primario grande" data-action="ir" data-vista="reg-email">Registrarme</button>
      <button class="btn secundario" data-action="ir" data-vista="login">Ya tengo cuenta</button>
    </section>
  </main>`;
}

function vRegEmail() {
  return `
  ${barraSimple('Registro · 1 de 4', 'bienvenida')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>Tu correo de Gmail</h2>
      <p>Te mandaremos un código para comprobar que el correo es tuyo.</p>
      <form data-form="reg-email">
        <label class="campo"><span>Correo</span>
          <input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required value="${esc(estado.reg.email || '')}" data-autofocus></label>
        <button class="btn primario grande">Enviarme el código</button>
      </form>
    </section>
  </main>`;
}

function vRegCodigo() {
  return `
  ${barraSimple('Registro · 2 de 4', 'reg-email')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>Escribe el código</h2>
      <p>Te hemos enviado un código de 6 cifras a <strong>${esc(estado.reg.email)}</strong>.
        Si no lo ves, mira en «Spam» o en «Promociones».</p>
      <form data-form="reg-codigo">
        <label class="campo"><span>Código</span>
          <input name="codigo" class="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" required data-autofocus></label>
        <button class="btn primario grande">Comprobar</button>
      </form>
      <button class="btn enlace" data-action="reenviar-codigo">No me ha llegado: enviar otro</button>
    </section>
  </main>`;
}

function vRegNombre() {
  return `
  ${barraSimple('Registro · 3 de 4', 'reg-codigo')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>¿Quién eres?</h2>
      <label class="campo"><span>Busca tu nombre en la lista</span>
        <input type="search" id="buscar-nombre" placeholder="Escribe tu nombre o apellido" autocomplete="off" value="${esc(estado.reg.filtro || '')}"></label>
      <div id="lista-nombres" class="resultados"></div>
      <p class="nota">Si no sales en la lista, habla con la oficina para que te añadan.</p>
    </section>
  </main>`;
}

function pintarNombres() {
  const cont = document.getElementById('lista-nombres');
  if (!cont) return;
  const q = normaliza(estado.reg.filtro);
  const nombres = (estado.reg.nombres || []).filter((n) => !q || normaliza(n).includes(q));
  cont.innerHTML = nombres.length
    ? nombres.map((n) => `<button class="resultado" data-action="elegir-nombre" data-nombre="${esc(n)}"><strong>${esc(n)}</strong></button>`).join('')
    : '<p class="vacio">No hay nadie con ese nombre.</p>';
}

function vRegPin() {
  return `
  ${barraSimple('Registro · 4 de 4', 'reg-nombre')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>${esc(estado.reg.nombre)}</h2>
      <p>Crea tu PIN de 4 a 6 cifras. Es tu contraseña: te lo pedirá la app al abrirla y
        para entrar desde otro móvil.</p>
      <form data-form="reg-pin">
        <label class="campo"><span>PIN</span>
          <input name="pin1" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required data-autofocus></label>
        <label class="campo"><span>Repite el PIN</span>
          <input name="pin2" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></label>
        <button class="btn primario grande">Terminar el registro</button>
      </form>
    </section>
  </main>`;
}

function vLogin() {
  return `
  ${barraSimple('Entrar', 'bienvenida')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>Ya tengo cuenta</h2>
      <form data-form="login">
        <label class="campo"><span>Correo de Gmail</span>
          <input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required value="${esc(estado.reg.email || '')}" data-autofocus></label>
        <label class="campo"><span>PIN</span>
          <input name="pin" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" required></label>
        <button class="btn primario grande">Entrar</button>
      </form>
      <button class="btn enlace" data-action="olvido-pin">He olvidado el PIN</button>
    </section>
  </main>`;
}

// «He olvidado el PIN» con registro: código al correo y PIN nuevo, sin pasar por la oficina.

function vRecEmail() {
  return `
  ${barraSimple('PIN nuevo · 1 de 2', estado.perfil && estado.perfil.token ? 'pin' : 'login')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>Crear un PIN nuevo</h2>
      <p>Te mandaremos un código a tu correo para comprobar que eres tú.</p>
      <form data-form="rec-email">
        <label class="campo"><span>Correo de Gmail</span>
          <input name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required value="${esc(estado.reg.email || '')}" data-autofocus></label>
        <button class="btn primario grande">Enviarme el código</button>
      </form>
    </section>
  </main>`;
}

function vRecPin() {
  return `
  ${barraSimple('PIN nuevo · 2 de 2', 'rec-email')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>Código y PIN nuevo</h2>
      <p>Te hemos enviado un código de 6 cifras a <strong>${esc(estado.reg.email)}</strong>.
        Si no lo ves, mira en «Spam» o en «Promociones».</p>
      <form data-form="rec-pin">
        <label class="campo"><span>Código</span>
          <input name="codigo" class="pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" required data-autofocus></label>
        <label class="campo"><span>PIN nuevo (de 4 a 6 cifras)</span>
          <input name="pin1" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></label>
        <label class="campo"><span>Repite el PIN</span>
          <input name="pin2" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></label>
        <button class="btn primario grande">Guardar y entrar</button>
      </form>
      <button class="btn enlace" data-action="reenviar-codigo">No me ha llegado: enviar otro</button>
    </section>
  </main>`;
}

/**
 * Ejecuta una llamada al servidor con un aviso de espera encima; si falla, avisa y devuelve null.
 * No vuelve a pintar la pantalla: así no se borra lo escrito en el formulario si hay que repetirlo.
 */
async function conEspera(texto, fn) {
  const capa = document.createElement('div');
  capa.className = 'capa centro';
  capa.innerHTML = `<div class="hoja pequena"><div class="girando"></div><p>${esc(texto)}</p></div>`;
  document.body.append(capa);
  // Si Google tarda o falla, la app reintenta sola: que se vea que sigue trabajando.
  alReintentar((n, total) => {
    const p = capa.querySelector('p');
    if (p) p.innerHTML = `${esc(texto)}<br><small>El servidor tarda en responder. Intento ${n} de ${total}…</small>`;
  });
  document.body.classList.add('sin-scroll');
  try {
    return await fn();
  } catch (e) {
    toast(e.message, 5000);
    return null;
  } finally {
    capa.remove();
    alReintentar(null);
    document.body.classList.toggle('sin-scroll',
      Boolean(estado.menu || estado.fotoVista || estado.preguntaOtro || estado.preguntaExtras || estado.errores.length || estado.procesando));
  }
}

async function guardarPerfilServidor({ email, nombre, token, cuenta }, pin) {
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  estado.perfil = { email, capataz: nombre, token, cuenta, pin: { salt, hash: await hashPin(pin, salt, ITER_PIN), iter: ITER_PIN } };
  await db.kvSet('perfil', estado.perfil);
  await db.kvSet('fallos', null);
}

async function terminarAcceso(r, email, pin) {
  await guardarPerfilServidor({ email, nombre: r.nombre, token: r.token, cuenta: r.estado }, pin);
  estado.reg = {};
  const cfg = await conEspera('Descargando la lista de la oficina…', () => cargarConfigServidor().then(() => true));
  if (!cfg && !estado.config) toast('No se ha podido descargar la lista. Se intentará al volver a abrir la app.', 5000);
  await ir('inicio');
  if (estado.perfil.cuenta !== 'activo') toast('Ya estás dentro. Falta que la oficina apruebe tu registro.', 5000);
  sincronizar({ lista: false });
}

async function cerrarSesion() {
  estado.perfil = null;
  await db.kvSet('perfil', null);
  await db.kvSet('fallos', null);
  ir(hayServidor() ? 'bienvenida' : 'setup-capataz');
}

// ---------- Pantallas de configuración y PIN (sin registro / datos de ejemplo) ----------

const inputConfig ='<input type="file" id="in-config" accept=".json,application/json,text/plain" hidden>';

function vSetupDatos() {
  return `
  ${barraSimple('Partes LAV', hayServidor() ? 'bienvenida' : null)}
  <main class="contenido">
    <section class="tarjeta">
      <h2>Bienvenido</h2>
      <p>Para empezar, carga el archivo con la lista de trabajadores que te ha pasado la oficina.
      Te llegará por WhatsApp o por correo: guárdalo antes en el móvil.</p>
      <button class="btn primario grande" data-action="elegir-config">Cargar archivo de la oficina</button>
      <button class="btn secundario" data-action="config-ejemplo">Probar con datos de ejemplo</button>
      ${inputConfig}
    </section>
  </main>`;
}

function vSetupCapataz() {
  const caps = (estado.config && estado.config.capataces) || [];
  return `
  <header class="barra"><div class="barra-titulo">¿Quién eres?</div></header>
  <main class="contenido">
    <section class="tarjeta">
      <h2>Elige tu nombre</h2>
      ${caps.map((n) => `<button class="btn opcion" data-action="elegir-capataz" data-nombre="${esc(n)}">${esc(n)}</button>`).join('')}
      <form data-form="capataz-otro">
        <label class="campo"><span>${caps.length ? 'Si no estás en la lista, escribe tu nombre' : 'Escribe tu nombre'}</span>
          <input name="nombre" autocomplete="name" required></label>
        <button class="btn secundario">Continuar</button>
      </form>
    </section>
  </main>`;
}

function vSetupPin() {
  const nombre = estado.cambiandoPin ? estado.perfil.capataz : estado.setupCapataz;
  return `
  <header class="barra"><div class="barra-titulo">${estado.cambiandoPin ? 'Cambiar PIN' : 'Crea tu PIN'}</div></header>
  <main class="contenido">
    <section class="tarjeta">
      <h2>${esc(nombre)}</h2>
      <p>Elige un PIN de 4 a 6 cifras. La app te lo pedirá cada vez que la abras.</p>
      <form data-form="crear-pin">
        <label class="campo"><span>PIN</span>
          <input name="pin1" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required data-autofocus></label>
        <label class="campo"><span>Repite el PIN</span>
          <input name="pin2" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="new-password" required></label>
        <button class="btn primario grande">Guardar PIN</button>
      </form>
      ${estado.cambiandoPin ? '<button class="btn secundario" data-action="ir-inicio">Cancelar</button>' : ''}
    </section>
  </main>`;
}

function vPin() {
  return `
  <header class="barra"><div class="barra-titulo">Partes LAV</div></header>
  <main class="contenido">
    <section class="tarjeta centrado">
      <h2>${esc(estado.perfil.capataz)}</h2>
      <form data-form="pin">
        <label class="campo"><span>Escribe tu PIN</span>
          <input name="pin" class="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="current-password" required data-autofocus></label>
        <button class="btn primario grande">Entrar</button>
      </form>
      <button class="btn enlace" data-action="olvido-pin">He olvidado el PIN</button>
    </section>
  </main>`;
}

async function hashPin(pin, saltB64, iter) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, clave, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

async function cargarConfigArchivo(file) {
  try {
    await guardarConfig(JSON.parse(await file.text()));
  } catch (e) {
    toast(`Ese archivo no vale: ${e.message}`, 5000);
  }
}

async function guardarConfig(cfg) {
  if (!cfg || cfg.formato !== 'config-partes-lav') throw new Error('no es una lista de Partes LAV');
  if (!Array.isArray(cfg.trabajadores)) throw new Error('le falta la lista de trabajadores');
  estado.config = cfg;
  await db.kvSet('config', cfg);
  toast(`Lista cargada: ${cfg.trabajadores.length} trabajadores`);
  if (!estado.perfil) return ir('setup-capataz');
  return ir('inicio');
}

// ---------- Inicio ----------

function ultimoEnvio(p) {
  const x = (p.envios || [])[(p.envios || []).length - 1];
  return typeof x === 'string' ? x : (x && (x.recibido || x.fecha)) || '';
}

function estadoTexto(p) {
  if (p.estado === 'borrador') return 'Borrador';
  if (p.estado === 'cerrado') return 'Pendiente de enviar';
  if (p.estado === 'en-cola') return p.errorEnvio ? 'No se ha podido enviar: ábrelo' : 'En cola: se enviará solo';
  return p.recibido ? `Recibido en la oficina ${fmtFechaHora(p.recibido)}` : `Enviado ${fmtFechaHora(ultimoEnvio(p))}`;
}

function itemParte(p) {
  return `
  <button class="item item-parte ${p.estado}" data-action="abrir" data-id="${p.id}">
    <span class="etiqueta ${p.tipo.toLowerCase()}">${p.tipo}</span>
    <span class="item-info"><strong>${fmtFecha(p.fecha)}${p.nocturna ? ' · noche' : ''}</strong> · ${esc(p.ref)}${p.rev > 1 ? ` rev. ${p.rev}` : ''}
      <br><small>${p.trabajos.length} trabajo(s) · ${estadoTexto(p)}</small></span>
    <span class="flecha">›</span>
  </button>`;
}

function grupo(titulo, partes) {
  if (!partes.length) return '';
  return `<h2 class="titulo-grupo">${titulo}</h2>${partes.map(itemParte).join('')}`;
}

function avisoSinEnviar(pendientes) {
  if (!pendientes.length) return '';
  const n = pendientes.length;
  const conError = pendientes.some((p) => p.errorEnvio);
  // Un parte cerrado al que aún no se ha pulsado Enviar no está en la cola: hay que abrirlo.
  const sinCola = pendientes.find((p) => p.estado === 'cerrado');
  const boton = sinCola
    ? `<button class="btn secundario" data-action="abrir" data-id="${sinCola.id}">Abrir</button>`
    : '<button class="btn secundario" data-action="enviar-pendientes">Enviar ahora</button>';
  return `
    <div class="aviso aviso-envio">
      <span>${n === 1 ? 'Tienes 1 parte sin enviar' : `Tienes ${n} partes sin enviar`}${conError ? ': alguno ha dado error, ábrelo' : ''}</span>
      ${boton}
    </div>`;
}

function vInicio() {
  const ps = estado.lista.slice().sort((a, b) => (b.modificado || '').localeCompare(a.modificado || ''));
  const sinEnviar = ps.filter((p) => p.estado === 'cerrado' || p.estado === 'en-cola');
  return `
  <header class="barra">
    <div><div class="barra-titulo">Partes LAV</div><div class="barra-sub">${esc(estado.perfil.capataz)}</div></div>
    <button class="btn-icono" data-action="menu" aria-label="Menú">⋮</button>
  </header>
  <main class="contenido">
    ${estado.perfil.token && estado.perfil.cuenta === 'pendiente' ? `
    <div class="aviso">Tu registro está pendiente de que lo apruebe la oficina. Puedes ir haciendo partes:
      se enviarán solos en cuanto te aprueben.
      <button class="btn secundario" data-action="comprobar-cuenta">Comprobar ahora</button></div>` : ''}
    ${avisoSinEnviar(sinEnviar)}
    <div class="tipos">
      <button class="btn-tipo infra" data-action="nuevo" data-tipo="INFRA"><span class="tipo-grande">INFRA</span><span>Infraestructura</span></button>
      <button class="btn-tipo super" data-action="nuevo" data-tipo="SUPER"><span class="tipo-grande">SUPER</span><span>Superestructura</span></button>
    </div>
    ${grupo('Pendientes de enviar', sinEnviar)}
    ${grupo('Borradores', ps.filter((p) => p.estado === 'borrador'))}
    ${grupo('Enviados', ps.filter((p) => p.estado === 'enviado').slice(0, 30))}
    ${ps.length ? '' : '<p class="vacio">Aún no hay partes. Pulsa INFRA o SUPER para empezar.</p>'}
  </main>
  ${estado.menu ? vMenu() : ''}`;
}

function vMenu() {
  const c = estado.config || {};
  const srv = Boolean(estado.perfil && estado.perfil.token);
  return `
  <div class="capa" data-action="cerrar-menu"><div class="hoja" data-stop>
    <h2>Menú</h2>
    ${srv
    ? '<button class="btn secundario" data-action="actualizar-lista">Actualizar la lista de la oficina</button>'
    : `<button class="btn secundario" data-action="elegir-config">Cargar lista de la oficina</button>${inputConfig}
       <button class="btn secundario" data-action="cambiar-capataz">Cambiar de capataz</button>`}
    <button class="btn secundario" data-action="cambiar-pin">Cambiar PIN</button>
    <button class="btn secundario" data-action="bloquear">Bloquear la app</button>
    ${srv ? '<button class="btn secundario" data-action="cerrar-sesion">Cerrar sesión en este móvil</button>' : ''}
    <p class="nota">${srv ? `Cuenta: ${esc(estado.perfil.email)}${estado.perfil.cuenta === 'pendiente' ? ' (pendiente de aprobar)' : ''}<br>` : ''}
      Lista de la oficina: ${esc(c.nombre || 'sin nombre')}${c.fecha ? ` (${esc(c.fecha)})` : ''} ·
      ${(c.trabajadores || []).length} trabajadores<br>Versión de la app: ${APP_VERSION}</p>
    <button class="btn" data-action="cerrar-menu">Cerrar</button>
  </div></div>`;
}

async function nuevoParte(tipo) {
  const ahora = new Date();
  const nocturna = ahora.getHours() < 7;   // de madrugada: la jornada empezó ayer
  const dia = new Date(ahora);
  if (nocturna) dia.setDate(dia.getDate() - 1);
  const fecha = fechaLocal(dia);
  const lista = await db.listarPartes();
  if (lista.some((p) => p.tipo === tipo && p.fecha === fecha && !p.rectificaA) &&
      !confirm(`Ya tienes un parte ${tipo} del ${fmtFecha(fecha)}. ¿Quieres empezar otro?`)) return;
  const n = ((await db.kvGet(`contador-${tipo}`)) || 0) + 1;
  await db.kvSet(`contador-${tipo}`, n);
  const iso = isoLocal();
  estado.parte = {
    formato: 'parte-lav',
    version: 1,
    id: uuid(),
    ref: `${tipo === 'INFRA' ? 'INF' : 'SUP'}-${String(n).padStart(4, '0')}`,
    rev: 1,
    rectificaA: null,
    tipo,
    fecha,
    nocturna,
    capataz: estado.perfil.capataz,
    personal: [capatazComoPersona()],
    trabajos: [],
    usaMaquinaria: null,
    maquinas: [],
    usaVehiculos: null,
    vehiculos: [],
    usaExtras: null,
    extras: [],
    medidas: [],
    medidasOtrasSi: false,
    medidasOtras: '',
    antiincendios: '',   // texto para el PDF, se calcula con textoMedidas()
    observaciones: '',
    estado: 'borrador',
    creado: iso,
    modificado: iso,
    cierre: null,
    envios: [],
    app: { version: APP_VERSION },
  };
  await guardarYa();
  ir('parte');
}

// ---------- Parte ----------

function cabeceraParte(volver, textoVolver, titulo) {
  const p = estado.parte;
  return `
  <header class="barra ${p.tipo.toLowerCase()}">
    <button class="btn-volver" data-action="${volver}">‹ ${textoVolver}</button>
    <div class="barra-titulo">${titulo}</div>
    <span class="guardado" id="guardado"></span>
  </header>`;
}

function refParte(p) {
  return `${p.tipo} · ${esc(p.ref)}${p.rev > 1 ? ` rev. ${p.rev}` : ''}`;
}

function vParte() {
  const p = normalizarParte(estado.parte);
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido con-pie">
    ${p.rectificaA ? `<div class="aviso">Corrección del parte (revisión ${p.rectificaA.rev}). Al enviarla, la oficina guardará las dos versiones.</div>` : ''}
    <section class="tarjeta">
      <h2>Jornada</h2>
      <label class="campo"><span>Fecha de la jornada</span><input type="date" data-bind="fecha" value="${esc(p.fecha)}"></label>
      <label class="check"><input type="checkbox" data-bind="nocturna" ${p.nocturna ? 'checked' : ''}>
        <span>Jornada nocturna <small>(pon la fecha del día en que empezó)</small></span></label>
      <div class="campo"><span>Capataz</span><div class="valor-fijo">${esc(p.capataz)}</div></div>
    </section>

    <section class="tarjeta">
      <h2>Personal <span class="contador">${p.personal.length}</span></h2>
      <ul class="lista-personas">
        ${p.personal.map((x, i) => `
        <li><div><strong>${esc(x.nombre)}</strong>${x.otro ? ' <span class="mini">añadido</span>' : ''}
          <br><small>${esc([x.empresa, x.categoria, x.habilitacion].filter(Boolean).join(' · '))}</small></div>
          <button class="btn-quitar" data-action="quitar-persona" data-i="${i}" aria-label="Quitar a ${esc(x.nombre)}">✕</button></li>`).join('')}
      </ul>
      <button class="btn secundario" data-action="copiar-personal">Copiar el personal del último parte</button>
      <label class="campo"><span>Añadir de la lista</span>
        <input type="search" id="buscar-persona" placeholder="Escribe un nombre o una empresa" autocomplete="off" value="${esc(estado.busqueda)}"></label>
      <div id="resultados" class="resultados"></div>
      ${estado.otroAbierto ? vOtroForm() : '<button class="btn secundario" data-action="abrir-otro">+ Añadir a alguien que no está en la lista</button>'}
    </section>

    ${estado.parte.usaExtras && !estado.preguntaExtras ? seccionExtras() : ''}
    ${seccionEquipos('maquinas')}
    ${seccionEquipos('vehiculos')}

    <section class="tarjeta">
      <h2>Trabajos <span class="contador">${p.trabajos.length}</span></h2>
      ${p.trabajos.length ? '' : '<p class="nota">Añade cada trabajo de la jornada por separado, con sus fotos.</p>'}
      ${p.trabajos.map(resumenTrabajo).join('')}
      <button class="btn anadir" data-action="nuevo-trabajo">${p.trabajos.length ? '+ Añadir otro trabajo' : '+ Añadir trabajo'}</button>
    </section>

    <section class="tarjeta">
      <h2>Medidas antiincendios <span class="oblig">obligatorio</span></h2>
      <p class="nota">Marca todas las que se hayan tomado.</p>
      ${medidasCfg().map((m) => `<label class="check"><input type="checkbox" data-medida="${esc(m)}" ${p.medidas.includes(m) ? 'checked' : ''}><span>${esc(m)}</span></label>`).join('')}
      <label class="check"><input type="checkbox" data-bind="medidasOtrasSi" data-rerender ${p.medidasOtrasSi ? 'checked' : ''}><span>Otras</span></label>
      ${p.medidasOtrasSi ? `<textarea data-bind="medidasOtras" rows="2" placeholder="Escribe las otras medidas">${esc(p.medidasOtras)}</textarea>` : ''}
    </section>

    <section class="tarjeta">
      <h2>Observaciones</h2>
      <textarea data-bind="observaciones" rows="3" placeholder="Opcional">${esc(p.observaciones)}</textarea>
    </section>

    <button class="btn peligro-texto" data-action="borrar-parte">Borrar este borrador</button>
  </main>
  <footer class="pie"><div class="fila-botones">
    <button class="btn secundario grande" data-action="guardar-salir">Guardar y salir</button>
    <button class="btn primario grande" data-action="cerrar-parte">Cerrar parte</button>
  </div></footer>
  ${estado.errores.length ? vErrores() : ''}
  ${estado.preguntaExtras ? vPreguntaExtras() : ''}`;
}

function vOtroForm() {
  return `
  <div class="sub-tarjeta">
    <h3>Persona que no está en la lista</h3>
    <label class="campo"><span>Nombre y apellidos *</span><input id="otro-nombre" autocomplete="off" data-autofocus></label>
    <label class="campo"><span>Empresa</span><input id="otro-empresa" autocomplete="off"></label>
    <label class="campo"><span>Habilitación</span><input id="otro-habilitacion" autocomplete="off"></label>
    <label class="campo"><span>Categoría</span><input id="otro-categoria" autocomplete="off"></label>
    <div class="fila-botones">
      <button class="btn secundario" data-action="cancelar-otro">Cancelar</button>
      <button class="btn primario" data-action="anadir-otro">Añadir</button>
    </div>
  </div>`;
}

function resumenTrabajo(t, i) {
  const ubic = [t.linea && `Línea ${t.linea}`, t.via && `vía ${t.via}`, t.aparato,
    t.pkInicio && `PK ${t.pkInicio}${t.pkFin ? ` – ${t.pkFin}` : ''}`].filter(Boolean).join(' · ');
  const n = (f) => t.fotos.filter((x) => x.fase === f).length;
  const fin = t.finalizado === true ? 'Finalizado' : t.finalizado === false ? 'Sin finalizar' : '¿Finalizado?';
  const faltas = faltasTrabajo(t);
  return `
  <button class="item item-trabajo ${faltas.length ? 'incompleto' : 'completo'}" data-action="editar-trabajo" data-i="${i}">
    <span class="num">${faltas.length ? i + 1 : '✓'}</span>
    <span class="item-info"><strong>${esc(textoReferencia(t) || 'Sin referencia todavía')}</strong>
      ${ubic ? `<br><small>${esc(ubic)}</small>` : ''}
      <br><small>${fin} · fotos: ${n('antes')} antes, ${n('durante')} durante, ${n('despues')} después</small>
      <br>${faltas.length
    ? `<small class="falta">Falta: ${esc(faltas.map((f) => f.corto).join(', '))}</small>`
    : '<small class="listo">Completo</small>'}</span>
    <span class="flecha">›</span>
  </button>`;
}

function vErrores() {
  return `
  <div class="capa" data-action="cerrar-errores"><div class="hoja" data-stop>
    <h2>Falta por completar</h2>
    <ul class="errores">
      ${estado.errores.map((e) => `<li><span>${esc(e.msg)}</span>${e.trabajo != null
    ? `<button class="btn mini" data-action="ir-trabajo" data-i="${e.trabajo}">Ir</button>` : ''}</li>`).join('')}
    </ul>
    <button class="btn primario" data-action="cerrar-errores">Entendido</button>
  </div></div>`;
}

function catalogo() {
  const base = ((estado.config && estado.config.trabajadores) || []).map((x) => ({ ...x, otro: false }));
  const vistos = new Set(base.map((x) => normaliza(x.nombre)));
  return base.concat(estado.otros.filter((x) => !vistos.has(normaliza(x.nombre))).map((x) => ({ ...x, otro: true })));
}

function persona(x) {
  return {
    nombre: (x.nombre || '').trim(),
    empresa: (x.empresa || '').trim(),
    habilitacion: (x.habilitacion || '').trim(),
    categoria: (x.categoria || '').trim(),
    otro: Boolean(x.otro),
  };
}

function capatazComoPersona() {
  const n = normaliza(estado.perfil.capataz);
  const t = ((estado.config && estado.config.trabajadores) || []).find((x) => normaliza(x.nombre) === n);
  return persona(t || { nombre: estado.perfil.capataz, categoria: 'Capataz' });
}

// Maquinaria y vehículos: dos secciones con Sí/No obligatorio y desplegables con la lista de la
// oficina, más la opción «Otra» para escribirla a mano.
const EQUIPOS = {
  maquinas: {
    titulo: 'Maquinaria', pregunta: '¿Se ha usado maquinaria?', usa: 'usaMaquinaria',
    elegir: 'Elige la máquina…', otra: 'Otra (escribirla)', anadir: '+ Añadir otra máquina', conMatricula: false,
  },
  vehiculos: {
    titulo: 'Vehículos', pregunta: '¿Se han usado vehículos?', usa: 'usaVehiculos',
    elegir: 'Elige el vehículo…', otra: 'Otro (escribirlo)', anadir: '+ Añadir otro vehículo', conMatricula: true,
  },
};

function equiposCfg(lista) {
  const c = estado.config || {};
  // Lista de un servidor anterior a v0.6.0: lo que traía como «vehiculos» eran las máquinas.
  if (!c.maquinas) return lista === 'maquinas' ? (c.vehiculos || []) : [];
  return c[lista] || [];
}

const textoEquipo = (x) => [x.descripcion, x.matricula].filter(Boolean).join(' · ');

/** Posición en la lista de la oficina del equipo elegido (-1 si es «otro» o no está). */
function indiceEquipo(lista, x) {
  if (x.otro || !x.descripcion) return -1;
  return equiposCfg(lista).findIndex((c) => c.descripcion === x.descripcion && (c.matricula || '') === (x.matricula || ''));
}

function seccionEquipos(lista) {
  const p = estado.parte;
  const e = EQUIPOS[lista];
  const usa = p[e.usa] === true ? 'si' : p[e.usa] === false ? 'no' : '';
  const cfg = equiposCfg(lista);
  const filas = p[e.usa] ? p[lista].map((x, i) => {
    const k = indiceEquipo(lista, x);
    const otro = k < 0 && (x.otro || x.descripcion);
    return `
      <div class="fila-equipo">
        <div class="equipo-campos">
          <select data-lista="${lista}" data-i="${i}" aria-label="${e.titulo} ${i + 1}">
            <option value="">${e.elegir}</option>
            ${cfg.map((c, j) => `<option value="${j}" ${j === k ? 'selected' : ''}>${esc(textoEquipo(c))}</option>`).join('')}
            <option value="otro" ${otro ? 'selected' : ''}>${e.otra}</option>
          </select>
          ${otro ? `
          <input placeholder="${e.conMatricula ? 'Vehículo' : 'Máquina'}" data-bind="${lista}.${i}.descripcion" value="${esc(x.descripcion)}" autocomplete="off">
          ${e.conMatricula ? `<input placeholder="Matrícula" data-bind="${lista}.${i}.matricula" value="${esc(x.matricula)}" autocapitalize="characters" autocomplete="off">` : ''}` : ''}
        </div>
        <button class="btn-quitar" data-action="quitar-equipo" data-lista="${lista}" data-i="${i}" aria-label="Quitar">✕</button>
      </div>`;
  }).join('') : '';
  return `
    <section class="tarjeta">
      <h2>${e.titulo} <span class="oblig">obligatorio</span></h2>
      <div class="campo"><span>${e.pregunta}</span>
        <div class="segmentado">${radio(e.usa, 'si', 'Sí', usa, 'data-tipo="bool" data-rerender')}${radio(e.usa, 'no', 'No', usa, 'data-tipo="bool" data-rerender')}</div></div>
      ${p[e.usa] ? `${filas}<button class="btn secundario" data-action="nuevo-equipo" data-lista="${lista}">${e.anadir}</button>` : ''}
    </section>`;
}

// Horas extra: opcionales, por persona del parte, con tipo (normales, nocturnas o festivas)
// y motivo opcional. Se guardan por nombre para que no se descoloquen al quitar a alguien.
const TIPOS_EXTRA = [['normales', 'Normales'], ['nocturnas', 'Nocturnas'], ['festivas', 'Festivas']];

/** Horas extra de las personas que siguen en el parte y tienen horas puestas. */
function extrasDelParte(p) {
  return (p.personal || [])
    .map((x) => (p.extras || []).find((e) => e.nombre === x.nombre))
    .filter((e) => e && Number(e.horas) > 0);
}

const textoTotalExtras = (t) => (t ? `Total del equipo: <strong>${String(t).replace('.', ',')} h</strong>` : '');

/** La lista del personal para poner las horas, con el botón de «a todos» y el total. */
function listaExtras(p) {
  const filas = p.personal.map((x, i) => {
    const e = p.extras.find((y) => y.nombre === x.nombre) || {};
    return `
      <div class="fila-extra">
        <strong>${esc(x.nombre)}</strong>
        <div class="extra-campos">
          <input inputmode="decimal" placeholder="Horas" autocomplete="off" data-extra="horas" data-i="${i}"
            value="${e.horas == null ? '' : esc(String(e.horas).replace('.', ','))}" aria-label="Horas extra de ${esc(x.nombre)}">
          <div class="segmentado compacto">${TIPOS_EXTRA.map(([v, t]) => `<label><input type="radio" name="extra-tipo-${i}" value="${v}" data-extra="tipo" data-i="${i}" ${e.tipo === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>
        </div>
        <input placeholder="Motivo (opcional)" data-extra="motivo" data-i="${i}" value="${esc(e.motivo || '')}" autocomplete="off">
      </div>`;
  }).join('');
  const total = extrasDelParte(p).reduce((s, e) => s + Number(e.horas), 0);
  return `
      <p class="nota">Pon las horas de cada persona que las haya hecho y elige el tipo. Deja en blanco a quien no tenga.</p>
      ${filas}
      ${p.personal.length > 1 ? '<button class="btn secundario" data-action="extras-a-todos">Poner las mismas horas a todos los que están en blanco</button>' : ''}
      <p class="nota" id="total-extras">${textoTotalExtras(total)}</p>`;
}

/** En el parte, solo si se ha contestado que sí (para revisarlas o cambiar a «No»). */
function seccionExtras() {
  const p = estado.parte;
  const usa = p.usaExtras === true ? 'si' : p.usaExtras === false ? 'no' : '';
  return `
    <section class="tarjeta">
      <h2>Horas extra</h2>
      <div class="campo"><span>¿Ha habido horas extra?</span>
        <div class="segmentado">${radio('usaExtras', 'si', 'Sí', usa, 'data-tipo="bool" data-rerender')}${radio('usaExtras', 'no', 'No', usa, 'data-tipo="bool" data-rerender')}</div></div>
      ${p.usaExtras ? listaExtras(p) : ''}
    </section>`;
}

/** Al pulsar «Cerrar parte»: primero la pregunta y, si es que sí, la lista del personal. */
function vPreguntaExtras() {
  const p = estado.parte;
  return `
  <div class="capa"><div class="hoja" data-stop>
    <h2>¿Ha habido horas extra?</h2>
    ${p.usaExtras ? `
    ${listaExtras(p)}
    <div class="fila-botones">
      <button class="btn secundario" data-action="extras-volver">Volver al parte</button>
      <button class="btn primario" data-action="extras-cerrar">Cerrar parte</button>
    </div>` : `
    <button class="btn primario grande" data-action="extras-si">Sí, apuntarlas</button>
    <button class="btn secundario grande" data-action="extras-no">No, cerrar el parte</button>
    <button class="btn enlace" data-action="extras-volver">Volver al parte</button>`}
  </div></div>`;
}

function aplicarExtra(el) {
  const p = estado.parte;
  if (!p || p.estado !== 'borrador') return;
  const x = p.personal[Number(el.dataset.i)];
  if (!x) return;
  let e = p.extras.find((y) => y.nombre === x.nombre);
  if (!e) { e = { nombre: x.nombre, horas: null, tipo: '', motivo: '' }; p.extras.push(e); }
  if (el.dataset.extra === 'horas') {
    const n = parseFloat(el.value.replace(',', '.'));
    e.horas = Number.isFinite(n) && n > 0 ? n : null;
  }
  else if (el.dataset.extra === 'tipo') { if (el.checked) e.tipo = el.value; } else e.motivo = el.value;
  const tot = document.getElementById('total-extras');
  if (tot) tot.innerHTML = textoTotalExtras(extrasDelParte(p).reduce((s, y) => s + Number(y.horas), 0));
  guardarPronto();
}

/** Copia las horas y el tipo del primero que los tenga a quienes estén en blanco. */
function extrasATodos() {
  const p = estado.parte;
  const base = extrasDelParte(p).find((e) => e.tipo);
  if (!base) return toast('Pon primero las horas y el tipo de una persona');
  let n = 0;
  for (const x of p.personal) {
    let e = p.extras.find((y) => y.nombre === x.nombre);
    if (e && Number(e.horas) > 0) continue;
    if (!e) { e = { nombre: x.nombre, horas: null, tipo: '', motivo: '' }; p.extras.push(e); }
    e.horas = base.horas;
    e.tipo = base.tipo;
    n++;
  }
  guardarPronto();
  render();
  toast(n ? `Puestas ${String(base.horas).replace('.', ',')} h ${base.tipo} a ${n} persona(s)` : 'Ya tenían todos horas puestas');
}

/**
 * Borradores de antes de separar maquinaria y vehículos (v0.5.0 y anteriores): lo apuntado
 * queda como vehículos y se vuelve a preguntar por la maquinaria. Los partes ya cerrados no se
 * tocan: su PDF sale con la tabla única de antes.
 */
function normalizarParte(p) {
  if (!p || p.estado !== 'borrador') return p;
  if (!p.maquinas) {
    p.maquinas = [];
    p.usaVehiculos = p.usaMaquinaria;
    p.usaMaquinaria = null;
  }
  if (!p.extras) {
    p.extras = [];
    p.usaExtras = null;
  }
  // Antes de v0.7.0 las medidas antiincendios eran texto libre: pasa a «Otras».
  if (!p.medidas) {
    p.medidas = [];
    p.medidasOtras = p.antiincendios || '';
    p.medidasOtrasSi = Boolean(p.medidasOtras.trim());
  }
  return p;
}

// Medidas antiincendios: casillas con la lista de la oficina (varias a la vez) más «Otras».
// Mientras la oficina no ponga su lista en la hoja, se usa esta.
const MEDIDAS_PROVISIONALES = [
  'Extintor en el vehículo',
  'Batefuegos',
  'Mochila extintora de agua',
  'Cuba o depósito de agua',
  'Zona de trabajo despejada de vegetación',
  'Vigilancia tras trabajos con riesgo de chispas',
  'Revisión de la zona al terminar',
];

function medidasCfg() {
  const m = estado.config && estado.config.antiincendios;
  return m && m.length ? m : MEDIDAS_PROVISIONALES;
}

/** Texto de las medidas para el PDF y los datos: «Extintor en el vehículo; Batefuegos; Otras: …». */
function textoMedidas(p) {
  const otras = p.medidasOtrasSi && (p.medidasOtras || '').trim();
  return [...p.medidas, otras && `Otras: ${otras}`].filter(Boolean).join('; ');
}

function motivosCfg(tipo) {
  const m = (estado.config && estado.config.motivos) || {};
  return m[tipo === 'INFRA' ? 'infra' : 'super'] || [];
}

function pintarResultados() {
  const cont = document.getElementById('resultados');
  if (!cont || !estado.parte) return;
  const q = normaliza(estado.busqueda);
  if (!q) { cont.innerHTML = ''; return; }
  const ya = new Set(estado.parte.personal.map((x) => normaliza(x.nombre)));
  const res = catalogo()
    .filter((x) => !ya.has(normaliza(x.nombre)) && normaliza(`${x.nombre} ${x.empresa} ${x.categoria}`).includes(q))
    .slice(0, 30);
  cont.innerHTML = res.length
    ? res.map((x) => `
      <button class="resultado" data-action="anadir-persona" data-nombre="${esc(x.nombre)}">
        <strong>${esc(x.nombre)}</strong>
        <small>${esc([x.empresa, x.categoria].filter(Boolean).join(' · '))}${x.otro ? ' · añadido por ti' : ''}</small>
      </button>`).join('')
    : '<p class="vacio">No hay nadie con ese nombre. Usa «Añadir a alguien que no está en la lista».</p>';
}

async function copiarPersonal() {
  const p = estado.parte;
  const previos = (await db.listarPartes())
    .filter((x) => x.id !== p.id && x.personal && x.personal.length)
    .sort((a, b) => `${b.fecha}${b.modificado}`.localeCompare(`${a.fecha}${a.modificado}`));
  if (!previos.length) return toast('No hay partes anteriores de los que copiar');
  const ya = new Set(p.personal.map((x) => normaliza(x.nombre)));
  let n = 0;
  for (const x of previos[0].personal) {
    if (!ya.has(normaliza(x.nombre))) { p.personal.push(persona(x)); ya.add(normaliza(x.nombre)); n++; }
  }
  guardarPronto();
  render();
  toast(n ? `${n} persona(s) copiadas del parte del ${fmtFecha(previos[0].fecha)}` : 'Ya estaban todos');
}

async function anadirOtro() {
  const val = (id) => (document.getElementById(id) || {}).value || '';
  const x = persona({
    nombre: val('otro-nombre'), empresa: val('otro-empresa'),
    habilitacion: val('otro-habilitacion'), categoria: val('otro-categoria'), otro: true,
  });
  if (!x.nombre) return toast('Escribe al menos el nombre');
  if (estado.parte.personal.some((y) => normaliza(y.nombre) === normaliza(x.nombre))) return toast('Esa persona ya está en el parte');
  estado.parte.personal.push(x);
  estado.otros = [x, ...estado.otros.filter((y) => normaliza(y.nombre) !== normaliza(x.nombre))].slice(0, 60);
  await db.kvSet('otros', estado.otros);
  estado.otroAbierto = false;
  guardarPronto();
  render();
}

// ---------- Trabajo ----------

function trabajoActual() {
  return estado.parte && estado.parte.trabajos[estado.trabajoIdx];
}

function nuevoTrabajo() {
  const p = estado.parte;
  const previo = p.trabajos[p.trabajos.length - 1];
  p.trabajos.push({
    id: uuid(),
    referencia: { tipo: '', codigo: '', motivo: '' },
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
function campoMotivo(p, t, b) {
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

/** Mismo corte que el trabajo anterior: copia línea, vía, horas, telefonema y PIDAME (se pueden cambiar). */
function copiarTrabajoAnterior() {
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
function etiquetaFoto(t) {
  const r = t.referencia || {};
  if (r.tipo === 'SIOS') return `SIOS ${r.codigo}`.trim();
  if (r.tipo === 'INCIDENCIA') return `INCIDENCIA ${r.codigo}`.trim();
  return (r.motivo || '').trim().toUpperCase() || 'SIN REFERENCIA';
}

function campo(etq, ruta, valor, extra = '') {
  return `<label class="campo"><span>${etq}</span><input data-bind="${ruta}" value="${esc(valor == null ? '' : valor)}" ${extra}></label>`;
}

/**
 * Aparato (opcional): con la lista de la oficina sale un desplegable agrupado por estación y, al
 * elegir uno, se rellenan solos los PK de inicio y fin (que se pueden cambiar). Sin lista, o con
 * «Otro», se escribe a mano.
 */
function campoAparato(t, b) {
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

/** Líneas que se ofrecen en botones, en Infra y en Super (las de la cabecera del PDF no cuentan aquí). */
const LINEAS = ['040', '038'];

/**
 * Horas con el teclado numérico en vez del reloj: se escriben las cifras («2330») y los dos
 * puntos salen solos. Al salir de la casilla se completa: «8» → 08:00, «830» → 08:30.
 */
const horaValida = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));

function campoHora(etq, ruta, valor) {
  return `<label class="campo"><span>${etq}</span><input inputmode="numeric" maxlength="5" placeholder="hh:mm"
    autocomplete="off" data-hora="${ruta}" value="${esc(valor || '')}"></label>`;
}

function aplicarHora(el, final) {
  if (!estado.parte || estado.parte.estado !== 'borrador') return;
  let d = el.value.replace(/\D/g, '').slice(0, 4);
  if (final && d) {
    if (d.length <= 2) d = d.padStart(2, '0') + '00';
    else if (d.length === 3) d = `0${d}`;
  }
  el.value = d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
  el.classList.toggle('mal', final && Boolean(el.value) && !horaValida(el.value));
  setPath(estado.parte, el.dataset.hora, el.value);
  const g = document.getElementById('guardado');
  if (g) g.textContent = 'Guardando…';
  guardarPronto();
}

/**
 * PK en dos casillas numéricas (km + metros), porque el teclado numérico del móvil no tiene «+».
 * Se guarda junto como «481+045».
 */
function campoPk(etq, ruta, valor) {
  const [km = '', m = ''] = String(valor || '').split(/\s*[+.,/]\s*/);
  const attrs = `inputmode="numeric" pattern="[0-9]*" autocomplete="off" data-pk="${ruta}"`;
  return `<div class="campo"><span>${etq}</span><div class="pk">
    <input ${attrs} data-pk-parte="km" value="${esc(km)}" placeholder="km" aria-label="${etq}: kilómetro">
    <b>+</b>
    <input ${attrs} data-pk-parte="m" value="${esc(m)}" placeholder="m" maxlength="3" aria-label="${etq}: metros"></div></div>`;
}

/** Junta las dos casillas del PK; al salir de la casilla de metros los completa a 3 cifras. */
function aplicarPk(el, final) {
  if (!estado.parte || estado.parte.estado !== 'borrador') return;
  const caja = el.closest('.pk');
  const km = caja.querySelector('[data-pk-parte="km"]');
  const m = caja.querySelector('[data-pk-parte="m"]');
  km.value = km.value.replace(/\D/g, '');
  m.value = m.value.replace(/\D/g, '').slice(0, 3);
  if (final && m.value) m.value = m.value.padStart(3, '0');
  setPath(estado.parte, el.dataset.pk, km.value || m.value ? `${km.value}+${m.value.padStart(3, '0')}` : '');
  const g = document.getElementById('guardado');
  if (g) g.textContent = 'Guardando…';
  guardarPronto();
}

function radio(ruta, valor, texto, actual, extra = '') {
  return `<label><input type="radio" name="${ruta}" value="${valor}" data-bind="${ruta}" ${extra} ${actual === valor ? 'checked' : ''}><span>${texto}</span></label>`;
}

function vTrabajo() {
  const p = estado.parte;
  const i = estado.trabajoIdx;
  const t = trabajoActual();
  const b = `trabajos.${i}`;
  const r = t.referencia;
  const rr = `${b}.referencia.tipo`;
  const fin = t.finalizado === true ? 'si' : t.finalizado === false ? 'no' : '';
  const previo = i > 0 ? p.trabajos[i - 1] : null;
  const sinTocar = !t.via && !t.entradaVia && !t.salidaVia && !t.telefonema.numero && !t.pidame;
  const sinTerminar = t.finalizado === false;
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
      <div class="campo"><span>Vía</span>
        <div class="segmentado compacto">${['1', '2', '3', '4', '5'].map((v) => radio(`${b}.via`, v, v, t.via)).join('')}</div></div>
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
        <div class="segmentado">${radio(`${b}.finalizado`, 'si', 'Sí', fin, 'data-tipo="bool" data-rerender')}${radio(`${b}.finalizado`, 'no', 'No', fin, 'data-tipo="bool" data-rerender')}</div></div>
    </section>

    <section class="tarjeta">
      <h2>Fotos</h2>
      <p class="nota">${sinTerminar
    ? 'Trabajo sin terminar: al menos una de <strong>antes</strong> y una de <strong>durante</strong> o de <strong>después</strong>.'
    : 'Obligatorio: al menos una de <strong>antes</strong> y una de <strong>después</strong>.'}
        Cada foto lleva fecha, hora y referencia, y se le quita la ubicación.</p>
      ${FASES.map(([f, txt]) => {
    const fs = t.fotos.filter((x) => x.fase === f);
    let marca = '';
    if (f === 'antes') marca = '<span class="oblig">mín. 1</span>';
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
function vPreguntaOtro(t) {
  const faltas = faltasTrabajo(t);
  return `
  <div class="capa" data-action="cerrar-pregunta"><div class="hoja" data-stop>
    <h2>¿Has hecho otro trabajo en esta jornada?</h2>
    ${faltas.length ? `<p class="falta">A este trabajo aún le falta: ${esc(faltas.map((f) => f.corto).join(', '))}. Puedes completarlo luego.</p>` : ''}
    <button class="btn primario grande" data-action="nuevo-trabajo">Sí, añadir otro trabajo</button>
    <button class="btn secundario grande" data-action="volver-parte">No, volver al parte</button>
  </div></div>`;
}

function vFotoGrande() {
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
function textoErrorFoto(e, file) {
  const nombre = `«${String((file && file.name) || 'la foto').slice(0, 30)}»`;
  const heic = /heic|heif/i.test((file && file.type) || '') || /\.(heic|heif)$/i.test((file && file.name) || '');
  if (e && e.motivo === 'vacia') return `${nombre} está vacía o no se ha descargado entera.`;
  if (e && e.motivo === 'formato') {
    return heic
      ? `${nombre} es HEIC y este navegador no puede abrirla. Hazla con la cámara de la app o pásala a JPG.`
      : `${nombre} no se puede abrir en este navegador (formato no compatible). Prueba con otra foto o desde Chrome.`;
  }
  if (e && e.name === 'QuotaExceededError') return 'No hay espacio en el móvil para guardar la foto. Libera espacio.';
  if (e && e.motivo === 'memoria') return `${nombre} es demasiado grande para este móvil. Prueba con menos fotos a la vez.`;
  return `No se ha podido usar la foto ${nombre}.`;
}

async function anadirFotos(files, { fase, origen }) {
  const p = estado.parte;
  const t = trabajoActual();
  if (!t) return;
  let ok = 0;
  const fallos = [];
  for (const [k, file] of files.entries()) {
    estado.procesando = files.length > 1 ? `Preparando foto ${k + 1} de ${files.length}…` : 'Preparando foto…';
    render();
    try {
      const etiqueta = etiquetaFoto(t);
      const r = await procesarFoto(file, { origen, fase, etiqueta, ref: p.ref });
      const id = uuid();
      await db.putFoto({ id, parteId: p.id, blob: r.blob });
      t.fotos.push({
        id, fase, origen, etiqueta, fechaFoto: r.fechaFoto, fuenteFecha: r.fuenteFecha,
        ancho: r.ancho, alto: r.alto, anadida: isoLocal(),
      });
      ok++;
    } catch (e) {
      console.error(e);
      fallos.push(textoErrorFoto(e, file));
    }
  }
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

async function borrarFoto(id) {
  if (!confirm('¿Borrar esta foto?')) return;
  for (const t of estado.parte.trabajos) t.fotos = t.fotos.filter((f) => f.id !== id);
  await db.borrarFoto(id);
  if (urls.has(id)) { URL.revokeObjectURL(urls.get(id)); urls.delete(id); }
  estado.fotoVista = null;
  await guardarYa();
  render();
}

async function urlFoto(id) {
  if (!urls.has(id)) {
    const r = await db.getFoto(id);
    if (!r) throw new Error('Foto no encontrada');
    urls.set(id, URL.createObjectURL(r.blob));
  }
  return urls.get(id);
}

async function cargarMiniaturas() {
  for (const img of app.querySelectorAll('img[data-foto-id]')) {
    try { img.src = await urlFoto(img.dataset.fotoId); } catch { img.alt = 'Foto no disponible'; }
  }
}

function liberarFotos() {
  for (const u of urls.values()) URL.revokeObjectURL(u);
  urls.clear();
}

// ---------- Guardado, validación y cierre ----------

async function guardarYa() {
  if (!estado.parte) return;
  estado.parte.modificado = isoLocal();
  await db.putParte(estado.parte);
  const g = document.getElementById('guardado');
  if (g) g.textContent = 'Guardado ✓';
}
const guardarPronto = debounce(guardarYa, 500);

/**
 * Lo que le falta a un trabajo para poder cerrar el parte: { corto } para la lista de trabajos
 * y { largo } para el aviso al cerrar. Fotos: antes y después; si el trabajo no está terminado,
 * basta con una de durante o de después.
 */
const pkValido = (s) => /^\s*\d+\s*[+.,/]\s*\d+\s*$/.test(String(s || ''));

function faltasTrabajo(t) {
  const e = [];
  const add = (corto, largo) => e.push({ corto, largo });
  const vacio = (s) => !String(s == null ? '' : s).trim();
  const r = t.referencia || {};
  if (!r.tipo) add('referencia', 'elige la referencia (SIOS, incidencia o sin referencia).');
  else if (r.tipo === 'SIN_REF' && vacio(r.motivo)) add('referencia escrita', 'escribe la referencia (has elegido «Sin referencia»).');
  else if (r.tipo !== 'SIN_REF' && vacio(r.codigo)) add(`nº de ${r.tipo === 'SIOS' ? 'SIOS' : 'incidencia'}`, `falta el número de ${r.tipo === 'SIOS' ? 'SIOS' : 'incidencia'}.`);
  if (!t.sinVia) {
    if (!horaValida(t.entradaVia)) add('entrada en vía', 'falta la hora de entrada en vía.');
    if (!horaValida(t.salidaVia)) add('salida de vía', 'falta la hora de salida de vía.');
    if (vacio(t.via)) add('vía', 'falta la vía.');
    if (!pkValido(t.pkInicio)) add('PK inicio', 'falta el PK de inicio (km y metros).');
    if (!pkValido(t.pkFin)) add('PK fin', 'falta el PK de fin (km y metros).');
  } else {
    if (!horaValida(t.horaInicio)) add('hora de inicio', 'falta la hora de inicio.');
    if (!horaValida(t.horaFin)) add('hora de fin', 'falta la hora de fin.');
  }
  if (vacio(t.linea)) add('línea', 'falta la línea.');
  if (t.finalizado == null) add('¿finalizado?', 'indica si está finalizado (Sí o No).');
  if (t.motivoOtro && vacio(t.motivoActuacion)) add('motivo', 'has elegido «Otro» motivo de actuación: escríbelo.');
  else if (vacio(t.motivoActuacion)) add('motivo', 'elige el motivo de actuación.');
  const hay = (fase) => t.fotos.some((f) => f.fase === fase);
  if (!hay('antes')) add('foto de antes', 'falta al menos una foto de ANTES.');
  if (t.finalizado === false) {
    if (!hay('durante') && !hay('despues')) add('foto de durante o después', 'falta al menos una foto de DURANTE o de DESPUÉS.');
  } else if (!hay('despues')) {
    add('foto de después', 'falta al menos una foto de DESPUÉS.');
  }
  return e;
}

function validar(p) {
  const e = [];
  const add = (msg, trabajo = null) => e.push({ msg, trabajo });
  const vacio = (s) => !String(s == null ? '' : s).trim();
  if (!p.fecha) add('Falta la fecha de la jornada.');
  if (!p.personal.length) add('Añade al menos una persona en «Personal».');
  if (!p.trabajos.length) add('Añade al menos un trabajo.');
  p.trabajos.forEach((t, i) => {
    for (const f of faltasTrabajo(t)) add(`Trabajo ${i + 1}: ${f.largo}`, i);
  });
  if (p.usaExtras) {
    const hs = extrasDelParte(p);
    if (!hs.length) add('Has marcado horas extra: pon las horas de quien las haya hecho (o marca «No»).');
    hs.filter((e) => !e.tipo).forEach((e) => add(`Horas extra de ${e.nombre}: elige si son normales, nocturnas o festivas.`));
  }
  if (p.usaMaquinaria == null) add('Indica si se ha usado maquinaria (Sí o No).');
  else if (p.usaMaquinaria && !p.maquinas.some((v) => !vacio(v.descripcion))) {
    add('Has marcado que se ha usado maquinaria: elige cuál (o marca «No»).');
  }
  if (p.usaVehiculos == null) add('Indica si se han usado vehículos (Sí o No).');
  else if (p.usaVehiculos && !p.vehiculos.some((v) => !vacio(v.descripcion))) {
    add('Has marcado que se han usado vehículos: elige cuál (o marca «No»).');
  }
  if (p.medidasOtrasSi && vacio(p.medidasOtras)) add('Has marcado «Otras» medidas antiincendios: escribe cuáles.');
  else if (vacio(p.antiincendios)) add('Marca al menos una medida antiincendios.');
  return e;
}

async function cerrarParte() {
  await guardarYa();
  const errores = validar(estado.parte);
  if (errores.length) {
    estado.errores = errores;
    render();
    return;
  }
  // Las horas extra se preguntan al cerrar: Sí abre la lista del personal; No sigue cerrando.
  if (estado.parte.usaExtras == null) {
    estado.preguntaExtras = true;
    render();
    return;
  }
  if (!confirm('¿Cerrar el parte? Después ya no se puede cambiar: solo corregir con una revisión nueva.')) return;
  estado.parte.cierre = isoLocal();
  estado.parte.estado = 'cerrado';
  await guardarYa();
  ir('envio');
}

async function borrarParte() {
  const p = estado.parte;
  if (!confirm('¿Borrar este borrador y sus fotos? No se puede deshacer.')) return;
  for (const f of await db.fotosDeParte(p.id)) await db.borrarFoto(f.id);
  await db.borrarParte(p.id);
  estado.parte = null;
  ir('inicio');
}

async function borrarTrabajo() {
  const p = estado.parte;
  const t = trabajoActual();
  if (!confirm(`¿Eliminar el trabajo ${estado.trabajoIdx + 1} y sus fotos?`)) return;
  for (const f of t.fotos) await db.borrarFoto(f.id);
  p.trabajos.splice(estado.trabajoIdx, 1);
  estado.trabajoIdx = null;
  ir('parte');
}

// ---------- Envío ----------

function vEnvio() {
  if (estado.perfil && estado.perfil.token) return vEnvioServidor();
  return vEnvioGmail();
}

function resumenEnvio(p) {
  const envios = (p.envios || []).map((x) => (typeof x === 'string' ? fmtFechaHora(x) : fmtFechaHora(x.recibido || x.fecha)));
  return `
      <p>Jornada del ${fmtFecha(p.fecha)}${p.nocturna ? ' (nocturna)' : ''} · ${p.trabajos.length} trabajo(s) · ${p.personal.length} persona(s)</p>
      <p><small>Cerrado en el móvil: ${fmtFechaHora(p.cierre)}${envios.length ? `<br>Envíos: ${envios.join(', ')}` : ''}</small></p>`;
}

function seccionCorregir() {
  return `
    <section class="tarjeta">
      <h2>¿Hay algo mal?</h2>
      <p class="nota">Puedes corregirlo: se crea una copia para editar y, al enviarla, la oficina guarda las dos versiones.</p>
      <button class="btn secundario" data-action="corregir">Corregir el parte</button>
    </section>`;
}

function vEnvioServidor() {
  const p = estado.parte;
  const e = estado.envio || {};
  let tarjeta;
  if (p.estado === 'enviado') {
    tarjeta = `
    <section class="tarjeta ok">
      <h2>Recibido en la oficina ✓</h2>
      <p><strong>${fmtFechaHora(p.recibido || ultimoEnvio(p))}</strong></p>
      ${resumenEnvio(p)}
    </section>`;
  } else if (p.estado === 'en-cola') {
    tarjeta = `
    <section class="tarjeta pendiente">
      <h2>${p.errorEnvio ? 'No se ha podido enviar' : 'Enviando…'}</h2>
      <p>${p.errorEnvio ? esc(p.errorEnvio) : 'Si no hay cobertura, se enviará solo en cuanto vuelva, aunque cierres la app.'}</p>
      ${resumenEnvio(p)}
      <button class="btn primario" data-action="reintentar-salida">Intentarlo ahora</button>
    </section>`;
  } else {
    tarjeta = `
    <section class="tarjeta pendiente">
      <h2>Cerrado · falta enviarlo</h2>
      ${resumenEnvio(p)}
      ${e.error ? `<p class="error">${esc(e.error)}</p><button class="btn secundario" data-action="reintentar-envio">Reintentar</button>` : ''}
      <button class="btn primario grande" data-action="enviar" ${e.listo ? '' : 'disabled'}>${e.listo ? 'Enviar a la oficina' : (e.error ? 'No se ha podido preparar' : 'Preparando…')}</button>
    </section>`;
  }
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido">
    ${tarjeta}
    <section class="tarjeta">
      <button class="btn secundario" data-action="ver-pdf" ${e.listo ? '' : 'disabled'}>Ver el PDF</button>
      ${p.estado !== 'enviado' ? `<button class="btn enlace" data-action="enviar-gmail" ${e.listo ? '' : 'disabled'}>¿No funciona el envío? Mandarlo por Gmail</button>` : ''}
    </section>
    ${seccionCorregir()}
  </main>`;
}

async function enviarServidor() {
  const p = estado.parte;
  const e = estado.envio;
  if (!e || !e.listo) return;
  const archivos = [];
  for (const f of e.archivos) {
    if (f.type === 'application/pdf') archivos.push({ nombre: f.name, tipo: f.type, base64: await blobABase64(f) });
    else archivos.push({ nombre: f.name, tipo: 'text/plain', texto: await f.text() });
  }
  await db.putSalida({ id: uuid(), parteId: p.id, creado: isoLocal(), datos: { ref: p.ref, asunto: e.asunto, cuerpo: e.cuerpo, archivos } });
  p.estado = 'en-cola';
  delete p.errorEnvio;
  await guardarYa();
  render();
  registrarSync();
  await procesarYMostrar(p.id);
}

/** Procesa la cola y avisa de cómo ha ido con el parte abierto. */
async function procesarYMostrar(parteId) {
  await procesarSalida();
  const p = await db.getParte(parteId);
  if (p && estado.parte && estado.parte.id === parteId) {
    estado.parte = p;
    render();
    if (p.estado === 'enviado') toast('Recibido en la oficina ✓', 4000);
    else if (p.errorEnvio) toast(`No se ha podido enviar: ${p.errorEnvio}`, 6000);
    else toast('Sin cobertura: se enviará solo en cuanto vuelva.', 5000);
  }
}

/** Envío alternativo con Gmail. Si estaba en la cola automática, lo quita para no mandarlo dos veces. */
async function enviarPorGmail() {
  const p = estado.parte;
  const cola = (await db.listarSalida()).filter((x) => x.parteId === p.id);
  if (cola.length && !confirm('Se quitará de la cola de envío automático y lo mandarás tú con Gmail. ¿Seguir?')) return;
  for (const x of cola) await db.borrarSalida(x.id);
  if (cola.length) { p.estado = 'cerrado'; delete p.errorEnvio; await guardarYa(); }
  await enviar();
}

function vEnvioGmail() {
  const p = estado.parte;
  const e = estado.envio || {};
  const dest = (estado.config && estado.config.destinatario) || '';
  const enviado = p.estado === 'enviado';
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido">
    <section class="tarjeta ${enviado ? 'ok' : 'pendiente'}">
      <h2>${enviado ? 'Enviado ✓' : 'Cerrado · falta enviarlo'}</h2>
      ${resumenEnvio(p)}
    </section>

    <section class="tarjeta">
      <h2>${enviado ? 'Volver a enviarlo' : 'Cómo enviarlo'}</h2>
      <ol class="pasos">
        <li>Pulsa <strong>Enviar por correo</strong>.</li>
        <li>Elige <strong>Gmail</strong>.</li>
        <li>En «Para» escribe ${dest ? `<strong>${esc(dest)}</strong> (ya está copiada: mantén pulsado y pega)` : 'la dirección de correo de la oficina (en pruebas, tu propio correo de Rover)'}.</li>
        <li>Pulsa enviar ➤. Si no hay cobertura, Gmail lo mandará solo cuando vuelva.</li>
      </ol>
      ${e.error ? `<p class="error">${esc(e.error)}</p><button class="btn secundario" data-action="reintentar-envio">Reintentar</button>` : ''}
      <button class="btn primario grande" data-action="enviar" ${e.listo ? '' : 'disabled'}>${e.listo ? 'Enviar por correo' : (e.error ? 'No se ha podido preparar' : 'Preparando…')}</button>
      <button class="btn secundario" data-action="ver-pdf" ${e.listo ? '' : 'disabled'}>Ver el PDF</button>
    </section>
    ${seccionCorregir()}
  </main>`;
}

async function prepararEnvioActual() {
  const p = estado.parte;
  estado.envio = { listo: false };
  render();
  try {
    const r = await prepararEnvio(p, estado.config, async (id) => {
      const f = await db.getFoto(id);
      return f && f.blob;
    }, APP_VERSION);
    if (estado.parte !== p) return;
    estado.envio = { listo: true, ...r };
  } catch (e) {
    console.error(e);
    if (estado.parte !== p) return;
    estado.envio = { listo: false, error: e.message };
  }
  if (estado.vista === 'envio') render();
}

async function enviar() {
  const p = estado.parte;
  const e = estado.envio;
  if (!e || !e.listo) return;
  const dest = estado.config && estado.config.destinatario;
  if (dest && navigator.clipboard) { try { await navigator.clipboard.writeText(dest); } catch { /* sin portapapeles */ } }
  try {
    const modo = await compartir(e);
    if (modo === 'compartido') {
      p.envios = (p.envios || []).concat([isoLocal()]);
      p.estado = 'enviado';
      await guardarYa();
      render();
      toast('Listo. Comprueba que Gmail lo ha enviado.', 4000);
    } else {
      toast('Este dispositivo no puede compartir: se han descargado los archivos.', 4000);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') toast('Envío cancelado');
    else toast(`No se ha podido compartir: ${err.message}`, 5000);
  }
}

async function corregir() {
  const p = estado.parte;
  if (!confirm('Se creará una copia para corregir. El parte ya cerrado no se borra. ¿Seguir?')) return;
  const nuevo = structuredClone(p);
  Object.assign(nuevo, {
    id: uuid(), rev: p.rev + 1, rectificaA: { id: p.id, rev: p.rev, cierre: p.cierre },
    estado: 'borrador', cierre: null, envios: [], creado: isoLocal(),
  });
  delete nuevo.recibido;
  delete nuevo.errorEnvio;
  for (const t of nuevo.trabajos) {
    for (const f of t.fotos) {
      const reg = await db.getFoto(f.id);
      const id = uuid();
      if (reg) await db.putFoto({ id, parteId: nuevo.id, blob: reg.blob });
      f.id = id;
    }
  }
  estado.parte = nuevo;
  await guardarYa();
  ir('parte');
}

// ---------- Eventos ----------

function aplicarBind(el) {
  if (!estado.parte || estado.parte.estado !== 'borrador') return;
  let v;
  if (el.type === 'checkbox') v = el.checked;
  else if (el.type === 'radio') {
    if (!el.checked) return;
    v = el.dataset.tipo === 'bool' ? el.value === 'si' : el.value;
  } else if (el.type === 'number') v = el.value === '' ? null : Number(el.value);
  else v = el.value;
  setPath(estado.parte, el.dataset.bind, v);
  if (estado.parte.medidas) estado.parte.antiincendios = textoMedidas(estado.parte);
  const g = document.getElementById('guardado');
  if (g) g.textContent = 'Guardando…';
  guardarPronto();
}

function onInput(e) {
  const el = e.target;
  if (el.id === 'buscar-persona') {
    estado.busqueda = el.value;
    pintarResultados();
    return;
  }
  if (el.id === 'buscar-nombre') {
    estado.reg.filtro = el.value;
    pintarNombres();
    return;
  }
  if (el.dataset.pk) { aplicarPk(el, false); return; }
  if (el.dataset.hora) { aplicarHora(el, false); return; }
  if (el.dataset.extra) { aplicarExtra(el); return; }
  if (el.matches('[data-bind]') && el.type !== 'radio' && el.type !== 'checkbox') aplicarBind(el);
}

async function onChange(e) {
  const el = e.target;
  if (el.id === 'in-config') {
    const f = el.files[0];
    el.value = '';
    if (f) cargarConfigArchivo(f);
    return;
  }
  if (el.id === 'in-camara' || el.id === 'in-galeria') {
    const files = [...el.files];
    el.value = '';
    if (files.length && estado.fotoPendiente) await anadirFotos(files, estado.fotoPendiente);
    return;
  }
  if (el.dataset.aparato) {
    const t = trabajoActual();
    if (!t || estado.parte.estado !== 'borrador') return;
    if (el.value === '__otro') {
      t.aparatoOtro = true;
      t.aparato = '';
    } else {
      t.aparatoOtro = false;
      t.aparato = el.value;
      const ap = ((estado.config || {}).aparatos || []).find((x) => x.nombre === el.value);
      if (ap) { t.pkInicio = ap.pkInicio; t.pkFin = ap.pkFin; }
    }
    guardarPronto();
    render();
    if (t.aparatoOtro) { const inp = app.querySelector(`[data-bind="${el.dataset.aparato}.aparato"]`); if (inp) inp.focus(); }
    return;
  }
  if (el.dataset.motivo) {
    const t = trabajoActual();
    if (!t || estado.parte.estado !== 'borrador') return;
    t.motivoOtro = el.value === '__otro';
    t.motivoActuacion = t.motivoOtro ? '' : el.value;
    guardarPronto();
    render();
    if (t.motivoOtro) { const inp = app.querySelector(`[data-bind="${el.dataset.motivo}.motivoActuacion"]`); if (inp) inp.focus(); }
    return;
  }
  if (el.matches('select[data-lista]')) {
    if (!estado.parte || estado.parte.estado !== 'borrador') return;
    const lista = el.dataset.lista;
    const c = equiposCfg(lista)[Number(el.value)];
    estado.parte[lista][Number(el.dataset.i)] = el.value === 'otro' ? { descripcion: '', matricula: '', otro: true }
      : c ? { descripcion: c.descripcion, matricula: c.matricula || '', otro: false }
        : { descripcion: '', matricula: '', otro: false };
    guardarPronto();
    render();
    if (el.value === 'otro') {
      const inp = app.querySelector(`[data-bind="${lista}.${el.dataset.i}.descripcion"]`);
      if (inp) inp.focus();
    }
    return;
  }
  if (el.dataset.pk) { aplicarPk(el, true); return; }
  if (el.dataset.hora) { aplicarHora(el, true); return; }
  if (el.dataset.extra) { aplicarExtra(el); return; }
  if (el.dataset.medida != null) {
    const p = estado.parte;
    if (!p || p.estado !== 'borrador') return;
    const m = el.dataset.medida;
    p.medidas = el.checked ? [...new Set([...p.medidas, m])] : p.medidas.filter((x) => x !== m);
    // Mismo orden que la lista, para que el PDF salga siempre igual.
    p.medidas.sort((a, b) => medidasCfg().indexOf(a) - medidasCfg().indexOf(b));
    p.antiincendios = textoMedidas(p);
    guardarPronto();
    return;
  }
  if (!el.matches('[data-bind]')) return;
  aplicarBind(el);
  // Al contestar «Sí», aparece directamente la primera fila para elegir.
  for (const [lista, e] of Object.entries(EQUIPOS)) {
    if (el.dataset.bind === e.usa && estado.parte[e.usa] && !estado.parte[lista].length) {
      estado.parte[lista].push({ descripcion: '', matricula: '', otro: false });
    }
  }
  if (el.hasAttribute('data-rerender')) render();
}

async function onSubmit(e) {
  e.preventDefault();
  const f = e.target;
  const tipo = f.dataset.form;
  if (tipo === 'capataz-otro') {
    const nombre = f.nombre.value.trim();
    if (!nombre) return;
    estado.setupCapataz = nombre;
    ir('setup-pin');
  } else if (tipo === 'crear-pin') {
    const pin1 = f.pin1.value.trim();
    const pin2 = f.pin2.value.trim();
    if (!/^\d{4,6}$/.test(pin1)) return toast('El PIN tiene que tener de 4 a 6 cifras');
    if (pin1 !== pin2) return toast('Los dos PIN no coinciden');
    const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    const hash = await hashPin(pin1, salt, ITER_PIN);
    const nuevoPin = { salt, hash, iter: ITER_PIN };
    if (estado.cambiandoPin) {
      if (estado.perfil.token) {
        // Con registro, el PIN también es la contraseña del servidor: se cambia en los dos sitios.
        const ok = await conEspera('Guardando el PIN…', () => api('pin', { token: estado.perfil.token, pin: pin1 }));
        if (!ok) return toast('No se ha podido cambiar el PIN: hace falta cobertura.', 5000);
      }
      estado.perfil = { ...estado.perfil, pin: nuevoPin };
    } else {
      estado.perfil = { capataz: estado.setupCapataz, pin: nuevoPin };
    }
    await db.kvSet('perfil', estado.perfil);
    await db.kvSet('fallos', null);
    estado.cambiandoPin = false;
    toast('PIN guardado');
    ir('inicio');
  } else if (tipo === 'reg-email') {
    const email = f.email.value.trim().toLowerCase();
    const ok = await conEspera('Enviando el código…', () => api('codigo', { email }));
    if (ok) { estado.reg = { email }; ir('reg-codigo'); }
  } else if (tipo === 'reg-codigo') {
    const codigo = f.codigo.value.trim();
    const r = await conEspera('Comprobando…', () => api('verificar', { email: estado.reg.email, codigo }));
    if (r) { Object.assign(estado.reg, { codigo, nombres: r.nombres, filtro: '' }); ir('reg-nombre'); }
  } else if (tipo === 'reg-pin') {
    const pin1 = f.pin1.value.trim();
    const pin2 = f.pin2.value.trim();
    if (!/^\d{4,6}$/.test(pin1)) return toast('El PIN tiene que tener de 4 a 6 cifras');
    if (pin1 !== pin2) return toast('Los dos PIN no coinciden');
    const { email, codigo, nombre } = estado.reg;
    const r = await conEspera('Registrando…', () => api('registro', { email, codigo, nombre, pin: pin1 }));
    if (r) await terminarAcceso(r, email, pin1);
  } else if (tipo === 'login') {
    const email = f.email.value.trim().toLowerCase();
    const pin = f.pin.value.trim();
    const r = await conEspera('Entrando…', () => api('login', { email, pin }));
    if (r) await terminarAcceso(r, email, pin);
  } else if (tipo === 'rec-email') {
    const email = f.email.value.trim().toLowerCase();
    const ok = await conEspera('Enviando el código…', () => api('codigo', { email, para: 'pin' }));
    if (ok) { estado.reg = { email, para: 'pin' }; ir('rec-pin'); }
  } else if (tipo === 'rec-pin') {
    const codigo = f.codigo.value.trim();
    const pin1 = f.pin1.value.trim();
    const pin2 = f.pin2.value.trim();
    if (!/^\d{4,6}$/.test(pin1)) return toast('El PIN tiene que tener de 4 a 6 cifras');
    if (pin1 !== pin2) return toast('Los dos PIN no coinciden');
    const { email } = estado.reg;
    const r = await conEspera('Guardando el PIN…', () => api('nuevoPin', { email, codigo, pin: pin1 }));
    if (r) await terminarAcceso(r, email, pin1);
  } else if (tipo === 'pin') {
    const fallos = (await db.kvGet('fallos')) || { n: 0, hasta: 0 };
    if (Date.now() < fallos.hasta) {
      return toast(`Demasiados intentos. Espera ${Math.ceil((fallos.hasta - Date.now()) / 1000)} segundos.`);
    }
    const { salt, hash, iter } = estado.perfil.pin;
    if ((await hashPin(f.pin.value.trim(), salt, iter)) === hash) {
      await db.kvSet('fallos', null);
      return entrarApp();
    }
    fallos.n += 1;
    if (fallos.n >= 5) fallos.hasta = Date.now() + 60000 * (fallos.n - 4);
    await db.kvSet('fallos', fallos);
    f.pin.value = '';
    toast('PIN incorrecto');
  }
  return undefined;
}

async function onClick(e) {
  const el = e.target.closest('[data-action],[data-stop]');
  if (!el || !app.contains(el) || el.hasAttribute('data-stop')) return;
  const p = estado.parte;
  const i = el.dataset.i == null ? null : Number(el.dataset.i);
  switch (el.dataset.action) {
    case 'elegir-config': document.getElementById('in-config').click(); break;
    case 'config-ejemplo':
      try {
        await guardarConfig(await (await fetch('ejemplo/config-ejemplo.json')).json());
      } catch (err) { toast(`No se han podido cargar los datos de ejemplo: ${err.message}`, 5000); }
      break;
    case 'elegir-capataz': estado.setupCapataz = el.dataset.nombre; ir('setup-pin'); break;
    case 'olvido-pin':
      if (hayServidor()) {
        // Desde «Ya tengo cuenta», con el correo que haya escrito; desde el PIN, con el de su cuenta.
        const escrito = app.querySelector('input[name="email"]');
        estado.reg = { email: (escrito && escrito.value.trim().toLowerCase()) || (estado.perfil && estado.perfil.email) || '' };
        ir('rec-email');
      } else if (confirm('Vas a crear un PIN nuevo. Tus partes no se borran. ¿Seguir?')) {
        estado.setupCapataz = estado.perfil.capataz;
        ir('setup-pin');
      }
      break;
    case 'ir': ir(el.dataset.vista); break;
    case 'reenviar-codigo': {
      const { email, para } = estado.reg;
      const ok = await conEspera('Enviando otro código…', () => api('codigo', { email, para }));
      if (ok) toast('Te hemos enviado otro código', 3500);
      break;
    }
    case 'elegir-nombre': estado.reg.nombre = el.dataset.nombre; ir('reg-pin'); break;
    case 'comprobar-cuenta': await conEspera('Comprobando…', () => sincronizar({ avisar: true })); break;
    case 'enviar-pendientes':
      await conEspera('Enviando…', async () => {
        const r = await procesarSalida();
        if (r.enviados) toast(r.enviados === 1 ? 'Parte recibido en la oficina ✓' : `${r.enviados} partes recibidos en la oficina ✓`, 4000);
        else if (r.pendientes) {
          const fallo = (await db.listarSalida()).find((i) => i.error);
          toast(fallo ? fallo.error : 'Todavía no se ha podido enviar. Se enviará solo cuando haya cobertura.', 5000);
        }
        refrescarVista();
      });
      break;
    case 'actualizar-lista': {
      estado.menu = false;
      render();
      const ok = await conEspera('Descargando la lista…', () => cargarConfigServidor().then(() => true));
      if (ok) toast(`Lista actualizada: ${estado.config.trabajadores.length} trabajadores`);
      break;
    }
    case 'cerrar-sesion':
      if (confirm('Se cerrará la sesión en este móvil. Los partes no se borran. ¿Seguir?')) cerrarSesion();
      break;
    case 'reintentar-salida': registrarSync(); await procesarYMostrar(p.id); break;
    case 'enviar-gmail': enviarPorGmail(); break;
    case 'menu': estado.menu = true; render(); break;
    case 'cerrar-menu': estado.menu = false; render(); break;
    case 'cambiar-pin': estado.cambiandoPin = true; ir('setup-pin'); break;
    case 'cambiar-capataz':
      if (confirm('Vas a elegir otro capataz y crear su PIN. Los partes ya hechos no se borran. ¿Seguir?')) {
        estado.cambiandoPin = false;
        ir('setup-capataz');
      }
      break;
    case 'bloquear': ir('pin'); break;
    case 'ir-inicio': ir('inicio'); break;
    case 'nuevo': nuevoParte(el.dataset.tipo); break;
    case 'abrir': {
      estado.parte = await db.getParte(el.dataset.id);
      if (estado.parte) ir(estado.parte.estado === 'borrador' ? 'parte' : 'envio');
      break;
    }
    case 'quitar-persona': p.personal.splice(i, 1); guardarPronto(); render(); break;
    case 'extras-a-todos': extrasATodos(); break;
    case 'extras-no': p.usaExtras = false; estado.preguntaExtras = false; await guardarYa(); cerrarParte(); break;
    case 'extras-si': p.usaExtras = true; await guardarYa(); render(); break;
    case 'extras-cerrar': estado.preguntaExtras = false; render(); cerrarParte(); break;
    case 'extras-volver': estado.preguntaExtras = false; render(); break;
    case 'anadir-persona': {
      const x = catalogo().find((y) => y.nombre === el.dataset.nombre);
      if (x) { p.personal.push(persona(x)); guardarPronto(); render(); toast(`${x.nombre} añadido`); }
      break;
    }
    case 'copiar-personal': copiarPersonal(); break;
    case 'abrir-otro': estado.otroAbierto = true; render(); break;
    case 'cancelar-otro': estado.otroAbierto = false; render(); break;
    case 'anadir-otro': anadirOtro(); break;
    case 'nuevo-trabajo': nuevoTrabajo(); break;
    case 'editar-trabajo':
    case 'ir-trabajo': estado.trabajoIdx = i; ir('trabajo'); break;
    case 'volver-parte': ir('parte'); break;
    case 'trabajo-listo':
      // Solo se pregunta al terminar el último; si edita uno anterior, vuelve directo al parte.
      if (estado.trabajoIdx === p.trabajos.length - 1) { estado.preguntaOtro = true; render(); } else ir('parte');
      break;
    case 'cerrar-pregunta': estado.preguntaOtro = false; render(); break;
    case 'copiar-trabajo-anterior': copiarTrabajoAnterior(); break;
    case 'borrar-trabajo': borrarTrabajo(); break;
    case 'nuevo-equipo': p[el.dataset.lista].push({ descripcion: '', matricula: '', otro: false }); guardarPronto(); render(); break;
    case 'quitar-equipo': p[el.dataset.lista].splice(i, 1); guardarPronto(); render(); break;
    case 'foto': {
      const t = trabajoActual();
      const r = t.referencia;
      if (!r.tipo || (r.tipo === 'SIN_REF' ? !String(r.motivo || '').trim() : !r.codigo.trim())) {
        toast('Pon primero la referencia: sale en el sello de la foto.', 3500);
        break;
      }
      estado.fotoPendiente = { fase: el.dataset.fase, origen: el.dataset.origen };
      document.getElementById(el.dataset.origen === 'camara' ? 'in-camara' : 'in-galeria').click();
      break;
    }
    case 'ver-foto': estado.fotoVista = el.dataset.id; render(); break;
    case 'cerrar-foto': estado.fotoVista = null; render(); break;
    case 'borrar-foto': borrarFoto(el.dataset.id); break;
    case 'borrar-parte': borrarParte(); break;
    case 'cerrar-parte': cerrarParte(); break;
    case 'guardar-salir':
      await guardarYa();
      await ir('inicio');
      toast('Parte guardado. Puedes seguir con él desde «Borradores».', 4000);
      break;
    case 'cerrar-errores': estado.errores = []; render(); break;
    case 'reintentar-envio': prepararEnvioActual(); break;
    case 'enviar': if (estado.perfil.token) enviarServidor(); else enviar(); break;
    case 'ver-pdf': {
      const url = URL.createObjectURL(estado.envio.pdf);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      break;
    }
    case 'corregir': corregir(); break;
    default: break;
  }
}

iniciar();
