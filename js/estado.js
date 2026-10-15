// Núcleo de la app: el estado compartido por todas las pantallas, la navegación (ir/render),
// el guardado del parte abierto, la sincronización con el servidor y la lista de la oficina.
// Las vistas y este módulo se importan entre sí: aquí nada las usa al cargar, solo dentro de funciones.

import * as db from './db.js';
import { api } from './servidor.js';
import { procesarSalida } from './salida.js';
import { enviarFallos } from './fallos.js';
import { esc, isoLocal, normaliza, debounce, toast } from './util.js';
import { MAQUINAS_VIA_PROVISIONALES, MEDIDAS_PROVISIONALES, persona } from './modelo.js';
import {
  vBienvenida, vRegEmail, vRegCodigo, vRegNombre, vRegPin, vLogin, vRecEmail, vRecPin,
  vSetupDatos, vSetupCapataz, vSetupPin, vPin, pintarNombres,
} from './vista-acceso.js';
import { vInicio } from './vista-inicio.js';
// Pendiente de partir: estas vistas siguen en app.js.
import {
  vParte, vTrabajo, vEnvio, pintarResultados, cargarMiniaturas, liberarFotos, prepararEnvioActual,
} from './app.js';

export const app = document.getElementById('app');

export const estado = {
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
export const urls = new Map();   // id de foto → URL para las miniaturas

/** Tras desbloquear con el PIN: inicio y, si hay registro, sincroniza con el servidor. */
export async function entrarApp() {
  await ir('inicio');
  if (estado.perfil && estado.perfil.token) sincronizar();
}

/** Actualiza la lista de la oficina y el estado de la cuenta, y envía lo que esté en cola. */
export async function sincronizar({ avisar = false, lista = true } = {}) {
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
  enviarFallos();
  if (r.enviados) toast(r.enviados === 1 ? 'Parte recibido en la oficina ✓' : `${r.enviados} partes recibidos en la oficina ✓`, 4000);
  refrescarVista();
}

/** Descarga la lista de la oficina; la respuesta trae también el estado de la cuenta. */
export async function cargarConfigServidor() {
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
export async function refrescarVista() {
  if (estado.vista === 'inicio') {
    estado.lista = await db.listarPartes();
    render();
  } else if (estado.vista === 'envio' && estado.parte) {
    const p = await db.getParte(estado.parte.id);
    if (p) { estado.parte = p; render(); }
  }
}

export function registrarSync() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => (reg.sync ? reg.sync.register('partes-salida') : null))
    .catch(() => {});
}

export async function ir(vista) {
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
  estado.eligeMaquina = false;
  render();
  window.scrollTo(0, 0);
  if (vista === 'envio') prepararEnvioActual();
}

export function render() {
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
    Boolean(estado.menu || estado.eligeMaquina || estado.fotoVista || estado.preguntaOtro || estado.preguntaExtras || estado.errores.length || estado.procesando));
  pintarResultados();
  pintarNombres();
  cargarMiniaturas();
  const auto = app.querySelector('[data-autofocus]');
  if (auto) auto.focus();
}

export async function guardarYa() {
  if (!estado.parte) return;
  estado.parte.modificado = isoLocal();
  await db.putParte(estado.parte);
  const g = document.getElementById('guardado');
  if (g) g.textContent = 'Guardado ✓';
}
export const guardarPronto = debounce(guardarYa, 500);

export const maquinasDeVia = () => maquinasViaCfg().filter((c) => (c.parte || 'via') === 'via');

export function maquinasViaCfg() {
  const l = (estado.config && estado.config.maquinasVia) || [];
  return l.length ? l : MAQUINAS_VIA_PROVISIONALES;
}

/** Personal para los desplegables: el de maquinaria de la hoja o, mientras no haya, la lista general. */
export function personalMaqCfg() {
  const c = estado.config || {};
  return (c.personalMaquinaria && c.personalMaquinaria.length ? c.personalMaquinaria : c.trabajadores) || [];
}

export function catalogo() {
  const base = ((estado.config && estado.config.trabajadores) || []).map((x) => ({ ...x, otro: false }));
  const vistos = new Set(base.map((x) => normaliza(x.nombre)));
  return base.concat(estado.otros.filter((x) => !vistos.has(normaliza(x.nombre))).map((x) => ({ ...x, otro: true })));
}

export function capatazComoPersona() {
  const n = normaliza(estado.perfil.capataz);
  const t = ((estado.config && estado.config.trabajadores) || []).find((x) => normaliza(x.nombre) === n);
  return persona(t || { nombre: estado.perfil.capataz, categoria: 'Capataz' });
}

export function equiposCfg(lista) {
  const c = estado.config || {};
  // Lista de un servidor anterior a v0.6.0: lo que traía como «vehiculos» eran las máquinas.
  if (!c.maquinas) return lista === 'maquinas' ? (c.vehiculos || []) : [];
  return c[lista] || [];
}

/** Posición en la lista de la oficina del equipo elegido (-1 si es «otro» o no está). */
export function indiceEquipo(lista, x) {
  if (x.otro || !x.descripcion) return -1;
  return equiposCfg(lista).findIndex((c) => c.descripcion === x.descripcion && (c.matricula || '') === (x.matricula || ''));
}

export function medidasCfg() {
  const m = estado.config && estado.config.antiincendios;
  return m && m.length ? m : MEDIDAS_PROVISIONALES;
}

export function motivosCfg(tipo) {
  const m = (estado.config && estado.config.motivos) || {};
  return m[tipo === 'INFRA' ? 'infra' : 'super'] || [];
}
