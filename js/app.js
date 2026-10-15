// Partes LAV: app del capataz. Todo se guarda en el móvil y funciona sin cobertura.
// El capataz se registra con su Gmail; al pulsar Enviar, el parte va al servidor
// (servidor/Code.gs), que lo manda por correo a la oficina. Si no hay cobertura se queda
// en cola y sale solo al volver la señal. Sin servidor configurado (copias de prueba), la lista
// se carga desde un archivo y el parte se envía con Gmail.

import * as db from './db.js';
import { prepararEnvio, compartir } from './envio.js';
import { api, hayServidor, SERVIDOR_URL } from './servidor.js';
import { procesarSalida } from './salida.js';
import { iniciarFallos, registrarFallo, enviarFallos } from './fallos.js';
import {
  esc, uuid, isoLocal, fmtFecha, fmtFechaHora, setPath, toast, blobABase64, FORMATO1, MAX_FORMATO1,
} from './util.js';
import { nombrePuesto } from './validaciones.js';
import { nuevaMaquinaVia, nuevoTajo, nuevoRealizado, persona, EQUIPOS, textoMedidas } from './modelo.js';
import {
  app, estado, entrarApp, sincronizar, cargarConfigServidor, refrescarVista, registrarSync, ir, render,
  guardarYa, guardarPronto, maquinasDeVia, maquinasViaCfg, personalMaqCfg, catalogo, equiposCfg, medidasCfg,
} from './estado.js';
import { cabeceraParte, refParte, aplicarHora, aplicarPk, conEspera } from './campos.js';
import {
  ITER_PIN, pintarNombres, terminarAcceso, cerrarSesion, hashPin, cargarConfigArchivo, guardarConfig,
} from './vista-acceso.js';
import { ultimoEnvio, textoCuenta, nuevoParte } from './vista-inicio.js';
import { aplicarExtra, extrasATodos } from './vista-extras.js';
import { pintarResultados, copiarPersonal, anadirOtro, borrarParte, cerrarParte } from './vista-parte.js';
import {
  trabajoActual, nuevoTrabajo, copiarTrabajoAnterior, anadirFotos, borrarFoto, borrarTrabajo,
} from './vista-trabajo.js';

export const APP_VERSION = '0.11.3';

// ---------- Arranque y navegación ----------

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

// ---------- Envío ----------

export function vEnvio() {
  if (estado.perfil && estado.perfil.token) return vEnvioServidor();
  return vEnvioGmail();
}

function resumenEnvio(p) {
  const envios = (p.envios || []).map((x) => (typeof x === 'string' ? fmtFechaHora(x) : fmtFechaHora(x.recibido || x.fecha)));
  return `
      <p>Jornada del ${fmtFecha(p.fecha)}${p.nocturna ? ' (nocturna)' : ''} · ${textoCuenta(p)} · ${p.personal.length} persona(s)${(p.formato1 || []).length ? ` · ${esc(FORMATO1.toLowerCase())}: ${p.formato1.length} foto(s)` : ''}</p>
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

export async function prepararEnvioActual() {
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
  for (const f of [...nuevo.trabajos.flatMap((t) => t.fotos), ...(nuevo.formato1 || [])]) {
    const reg = await db.getFoto(f.id);
    const id = uuid();
    if (reg) await db.putFoto({ id, parteId: nuevo.id, blob: reg.blob });
    f.id = id;
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
  if (el.matches('select[data-maqvia]')) {
    const p = estado.parte;
    if (!p || p.estado !== 'borrador') return;
    const i = Number(el.dataset.maqvia);
    const horas = p.maquinasVia[i].horas;
    const c = maquinasDeVia()[Number(el.value)];
    p.maquinasVia[i] = el.value === 'otro' ? { ...nuevaMaquinaVia(), horas, otro: true }
      : c ? { descripcion: c.descripcion, uic: c.uic || '', trabajo: c.trabajo || '', horas, otro: false }
        : { ...nuevaMaquinaVia(), horas };
    guardarPronto();
    render();
    if (el.value === 'otro') { const inp = app.querySelector(`[data-bind="maquinasVia.${i}.descripcion"]`); if (inp) inp.focus(); }
    return;
  }
  if (el.matches('select[data-puesto]')) {
    const p = estado.parte;
    if (!p || p.estado !== 'borrador' || el.value === '') return;
    const puesto = el.dataset.puesto;
    const c = personalMaqCfg()[Number(el.value)];
    if (el.value !== 'otro' && c && p.personal.some((x) => x.puesto === puesto && x.nombre === c.nombre)) {
      toast(`${c.nombre} ya está en ${nombrePuesto(puesto)}`);
      render();
      return;
    }
    p.personal.push({ ...persona(el.value === 'otro' ? { otro: true } : c), puesto });
    guardarPronto();
    render();
    if (el.value === 'otro') {
      const inp = app.querySelector(`[data-bind="personal.${p.personal.length - 1}.nombre"]`);
      if (inp) inp.focus();
    }
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
  if (el.dataset.coste) {
    const t = trabajoActual();
    if (!t || estado.parte.estado !== 'borrador') return;
    // Una casilla o ninguna: al marcar una se desmarca la otra; al quitarla, queda en ninguno.
    t.tipoCoste = el.checked ? el.dataset.coste : '';
    guardarPronto();
    render();
    return;
  }
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
    case 'nuevo':
      if (el.dataset.tipo === 'MAQUINARIA') { estado.eligeMaquina = true; render(); } else nuevoParte(el.dataset.tipo);
      break;
    case 'elegir-maquina': {
      estado.eligeMaquina = false;
      const m = el.dataset.otra ? { descripcion: '', uic: '', parte: el.dataset.otra, otro: true }
        : maquinasViaCfg()[Number(el.dataset.j)];
      if (m) nuevoParte('MAQUINARIA', m);
      break;
    }
    case 'cerrar-eleccion': estado.eligeMaquina = false; render(); break;
    case 'nuevo-realizado': p.realizados.push(nuevoRealizado()); await guardarYa(); render(); break;
    case 'quitar-realizado':
      if (confirm(`¿Quitar el trabajo ${i + 1}?`)) { p.realizados.splice(i, 1); guardarPronto(); render(); }
      break;
    case 'nuevo-vagon': p.vagones.push({ tipo: '', uic: '', m3: '' }); await guardarYa(); render(); break;
    case 'quitar-vagon': p.vagones.splice(i, 1); guardarPronto(); render(); break;
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
    case 'nueva-maqvia': p.maquinasVia.push(nuevaMaquinaVia()); guardarPronto(); render(); break;
    case 'quitar-maqvia': p.maquinasVia.splice(i, 1); guardarPronto(); render(); break;
    case 'nuevo-tajo': {
      p.tajos.push(nuevoTajo());
      await guardarYa();
      render();
      const tajos = app.querySelectorAll('.tajo');
      if (tajos.length) tajos[tajos.length - 1].scrollIntoView({ block: 'start', behavior: 'smooth' });
      break;
    }
    case 'quitar-tajo':
      if (confirm(`¿Quitar el tajo ${i + 1}?`)) { p.tajos.splice(i, 1); guardarPronto(); render(); }
      break;
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
    case 'foto-formato':
      if ((p.formato1 || []).length >= MAX_FORMATO1) { toast(`Ya hay ${MAX_FORMATO1} fotos: borra alguna para añadir otra.`, 3500); break; }
      estado.fotoPendiente = { formato: true, origen: el.dataset.origen };
      document.getElementById(el.dataset.origen === 'camara' ? 'in-camara' : 'in-galeria').click();
      break;
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
