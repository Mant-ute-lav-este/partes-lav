// Pantallas de acceso: registro con Gmail, entrada con PIN, recuperar el PIN y, sin servidor
// (copias de prueba), cargar la lista desde un archivo.

import * as db from './db.js';
import { hayServidor } from './servidor.js';
import { esc, toast } from './util.js';
import { estado, ir, sincronizar, cargarConfigServidor } from './estado.js';
import { barraSimple, conEspera } from './campos.js';

export const ITER_PIN = 150000;

// ---------- Registro con Gmail ----------

export function vBienvenida() {
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

export function vRegEmail() {
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

export function vRegCodigo() {
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

export function vRegNombre() {
  return `
  ${barraSimple('Registro · 3 de 4', 'reg-codigo')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>¿Quién eres?</h2>
      <form data-form="reg-nombre">
        <label class="campo"><span>Tu nombre y apellidos</span>
          <input name="texto" placeholder="Por ejemplo: Juan García" autocomplete="name" autocapitalize="words" required value="${esc(estado.reg.texto || '')}" data-autofocus></label>
        <button class="btn primario grande">Buscarme</button>
      </form>
      <p class="nota">Escribe tu nombre y al menos un apellido, como los tiene la empresa. Si no te encuentra, habla con la oficina.</p>
    </section>
  </main>`;
}

export function vRegPin() {
  return `
  ${barraSimple('Registro · 4 de 4', 'reg-nombre')}
  <main class="contenido">
    <section class="tarjeta">
      <h2>${esc(estado.reg.nombre)}</h2>
      <p class="nota">Si no eres tú, pulsa «Atrás» y escríbelo de nuevo.</p>
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

export function vLogin() {
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

export function vRecEmail() {
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

export function vRecPin() {
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

export async function guardarPerfilServidor({ email, nombre, token, cuenta }, pin) {
  const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  estado.perfil = { email, capataz: nombre, token, cuenta, pin: { salt, hash: await hashPin(pin, salt, ITER_PIN), iter: ITER_PIN } };
  await db.kvSet('perfil', estado.perfil);
  await db.kvSet('intentosPin', null);
}

export async function terminarAcceso(r, email, pin) {
  await guardarPerfilServidor({ email, nombre: r.nombre, token: r.token, cuenta: r.estado }, pin);
  estado.reg = {};
  const cfg = await conEspera('Descargando la lista de la oficina…', () => cargarConfigServidor().then(() => true));
  if (!cfg && !estado.config) toast('No se ha podido descargar la lista. Se intentará al volver a abrir la app.', 5000);
  await ir('inicio');
  if (estado.perfil.cuenta !== 'activo') toast('Ya estás dentro. Falta que la oficina apruebe tu registro.', 5000);
  sincronizar({ lista: false });
}

export async function cerrarSesion() {
  estado.perfil = null;
  await db.kvSet('perfil', null);
  await db.kvSet('intentosPin', null);
  ir(hayServidor() ? 'bienvenida' : 'setup-capataz');
}

// ---------- Pantallas de configuración y PIN (sin registro / datos de ejemplo) ----------

export const inputConfig ='<input type="file" id="in-config" accept=".json,application/json,text/plain" hidden>';

export function vSetupDatos() {
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

export function vSetupCapataz() {
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

export function vSetupPin() {
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

export function vPin() {
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

export async function hashPin(pin, saltB64, iter) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, clave, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

export async function cargarConfigArchivo(file) {
  try {
    await guardarConfig(JSON.parse(await file.text()));
  } catch (e) {
    toast(`Ese archivo no vale: ${e.message}`, 5000);
  }
}

export async function guardarConfig(cfg) {
  if (!cfg || cfg.formato !== 'config-partes-lav') throw new Error('no es una lista de Partes LAV');
  if (!Array.isArray(cfg.trabajadores)) throw new Error('le falta la lista de trabajadores');
  estado.config = cfg;
  await db.kvSet('config', cfg);
  toast(`Lista cargada: ${cfg.trabajadores.length} trabajadores`);
  if (!estado.perfil) return ir('setup-capataz');
  return ir('inicio');
}
