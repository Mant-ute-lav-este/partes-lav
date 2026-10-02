// Partes LAV: app del capataz. Todo se guarda en el móvil y funciona sin cobertura.
// Al cerrar el parte se envía por correo (menú Compartir → Gmail).

import * as db from './db.js';
import { procesarFoto } from './fotos.js';
import { textoReferencia } from './pdf.js';
import { prepararEnvio, compartir } from './envio.js';
import {
  esc, uuid, fechaLocal, isoLocal, fmtFecha, fmtFechaHora, normaliza, debounce, setPath, toast,
} from './util.js';

const APP_VERSION = '0.2.1';
const ITER_PIN = 150000;
const FASES = [['antes', 'Antes'], ['durante', 'Durante'], ['despues', 'Después']];
const app = document.getElementById('app');

const estado = {
  vista: 'cargando',
  config: null,          // lista de la oficina
  perfil: null,          // { capataz, pin: { salt, hash, iter } }
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
};
const urls = new Map();   // id de foto → URL para las miniaturas

// ---------- Arranque y navegación ----------

async function iniciar() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  app.addEventListener('click', onClick);
  app.addEventListener('input', onInput);
  app.addEventListener('change', onChange);
  app.addEventListener('submit', onSubmit);
  try {
    estado.config = await db.kvGet('config');
    estado.perfil = await db.kvGet('perfil');
    estado.otros = (await db.kvGet('otros')) || [];
  } catch (e) {
    app.innerHTML = `<p class="error">No se puede usar el almacenamiento del móvil: ${esc(e.message)}</p>`;
    return;
  }
  if (!estado.config) return ir('setup-datos');
  if (!estado.perfil) return ir('setup-capataz');
  return ir('pin');
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
  render();
  window.scrollTo(0, 0);
  if (vista === 'envio') prepararEnvioActual();
}

function render() {
  const vistas = {
    'setup-datos': vSetupDatos, 'setup-capataz': vSetupCapataz, 'setup-pin': vSetupPin, pin: vPin,
    inicio: vInicio, parte: vParte, trabajo: vTrabajo, envio: vEnvio,
  };
  const y = window.scrollY;
  app.innerHTML = (vistas[estado.vista] || (() => '<p class="cargando">Cargando…</p>'))();
  window.scrollTo(0, y);
  document.body.classList.toggle('sin-scroll',
    Boolean(estado.menu || estado.fotoVista || estado.errores.length || estado.procesando));
  pintarResultados();
  cargarMiniaturas();
  const auto = app.querySelector('[data-autofocus]');
  if (auto) auto.focus();
}

// ---------- Pantallas de configuración y PIN ----------

const inputConfig = '<input type="file" id="in-config" accept=".json,application/json,text/plain" hidden>';

function vSetupDatos() {
  return `
  <header class="barra"><div class="barra-titulo">Partes LAV</div></header>
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

function estadoTexto(p) {
  if (p.estado === 'borrador') return 'Borrador';
  if (p.estado === 'cerrado') return 'Pendiente de enviar';
  return `Enviado ${fmtFechaHora(p.envios[p.envios.length - 1])}`;
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

function vInicio() {
  const ps = estado.lista.slice().sort((a, b) => (b.modificado || '').localeCompare(a.modificado || ''));
  return `
  <header class="barra">
    <div><div class="barra-titulo">Partes LAV</div><div class="barra-sub">${esc(estado.perfil.capataz)}</div></div>
    <button class="btn-icono" data-action="menu" aria-label="Menú">⋮</button>
  </header>
  <main class="contenido">
    <div class="tipos">
      <button class="btn-tipo infra" data-action="nuevo" data-tipo="INFRA"><span class="tipo-grande">INFRA</span><span>Infraestructura</span></button>
      <button class="btn-tipo super" data-action="nuevo" data-tipo="SUPER"><span class="tipo-grande">SUPER</span><span>Superestructura</span></button>
    </div>
    ${grupo('Pendientes de enviar', ps.filter((p) => p.estado === 'cerrado'))}
    ${grupo('Borradores', ps.filter((p) => p.estado === 'borrador'))}
    ${grupo('Enviados', ps.filter((p) => p.estado === 'enviado').slice(0, 30))}
    ${ps.length ? '' : '<p class="vacio">Aún no hay partes. Pulsa INFRA o SUPER para empezar.</p>'}
  </main>
  ${estado.menu ? vMenu() : ''}`;
}

function vMenu() {
  const c = estado.config || {};
  return `
  <div class="capa" data-action="cerrar-menu"><div class="hoja" data-stop>
    <h2>Menú</h2>
    <button class="btn secundario" data-action="elegir-config">Cargar lista de la oficina</button>
    ${inputConfig}
    <button class="btn secundario" data-action="cambiar-capataz">Cambiar de capataz</button>
    <button class="btn secundario" data-action="cambiar-pin">Cambiar PIN</button>
    <button class="btn secundario" data-action="bloquear">Bloquear la app</button>
    <p class="nota">Lista de la oficina: ${esc(c.nombre || 'sin nombre')}${c.fecha ? ` (${esc(c.fecha)})` : ''} ·
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
    vehiculos: [],
    antiincendios: '',
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
  const p = estado.parte;
  const um = p.usaMaquinaria === true ? 'si' : p.usaMaquinaria === false ? 'no' : '';
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

    <section class="tarjeta">
      <h2>Maquinaria y vehículos <span class="oblig">obligatorio</span></h2>
      <div class="campo"><span>¿Se ha usado maquinaria o vehículos?</span>
        <div class="segmentado">${radio('usaMaquinaria', 'si', 'Sí', um, 'data-tipo="bool" data-rerender')}${radio('usaMaquinaria', 'no', 'No', um, 'data-tipo="bool" data-rerender')}</div></div>
      ${p.usaMaquinaria ? `
      ${p.vehiculos.map((v, i) => `
      <div class="fila-vehiculo">
        <input list="dl-vehiculos" placeholder="Máquina o vehículo" data-bind="vehiculos.${i}.descripcion" data-vehiculo="${i}" value="${esc(v.descripcion)}" autocomplete="off">
        <input placeholder="Matrícula" data-bind="vehiculos.${i}.matricula" value="${esc(v.matricula)}" autocapitalize="characters" autocomplete="off">
        <button class="btn-quitar" data-action="quitar-vehiculo" data-i="${i}" aria-label="Quitar máquina o vehículo">✕</button>
      </div>`).join('')}
      <datalist id="dl-vehiculos">${vehiculosCfg().map((v) => `<option value="${esc(v.descripcion)}">${esc(v.matricula || '')}</option>`).join('')}</datalist>
      <button class="btn secundario" data-action="nuevo-vehiculo">+ Añadir otra máquina o vehículo</button>` : ''}
    </section>

    <section class="tarjeta">
      <h2>Trabajos <span class="contador">${p.trabajos.length}</span></h2>
      ${p.trabajos.map(resumenTrabajo).join('')}
      <button class="btn secundario" data-action="nuevo-trabajo">+ Añadir trabajo</button>
    </section>

    <section class="tarjeta">
      <h2>Medidas antiincendios <span class="oblig">obligatorio</span></h2>
      <textarea data-bind="antiincendios" rows="3" placeholder="Ej.: extintor en el vehículo, batefuegos, revisión de la zona al terminar">${esc(p.antiincendios)}</textarea>
    </section>

    <section class="tarjeta">
      <h2>Observaciones</h2>
      <textarea data-bind="observaciones" rows="3" placeholder="Opcional">${esc(p.observaciones)}</textarea>
    </section>

    <button class="btn peligro-texto" data-action="borrar-parte">Borrar este borrador</button>
  </main>
  <footer class="pie"><button class="btn primario grande" data-action="cerrar-parte">Cerrar parte</button></footer>
  ${estado.errores.length ? vErrores() : ''}`;
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
  const ubic = [t.linea && `Línea ${t.linea}`, t.via && `vía ${t.via}`,
    t.pkInicio && `PK ${t.pkInicio}${t.pkFin ? ` – ${t.pkFin}` : ''}`].filter(Boolean).join(' · ');
  const n = (f) => t.fotos.filter((x) => x.fase === f).length;
  const fin = t.finalizado === true ? 'Finalizado' : t.finalizado === false ? 'Sin finalizar' : '¿Finalizado?';
  return `
  <button class="item item-trabajo" data-action="editar-trabajo" data-i="${i}">
    <span class="num">${i + 1}</span>
    <span class="item-info"><strong>${esc(textoReferencia(t) || 'Falta la referencia')}</strong>
      <br><small>${esc(ubic || 'Falta la ubicación')}</small>
      <br><small>${fin} · fotos: ${n('antes')} antes, ${n('durante')} durante, ${n('despues')} después</small></span>
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

function vehiculosCfg() {
  return (estado.config && estado.config.vehiculos) || [];
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
    telefonema: { numero: '', hora: '' },
    entradaVia: '',
    salidaVia: '',
    linea: previo ? previo.linea : '',
    via: '',
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

/** Texto que va en el sello de las fotos. */
function etiquetaFoto(t) {
  const r = t.referencia || {};
  if (r.tipo === 'SIOS') return `SIOS ${r.codigo}`.trim();
  if (r.tipo === 'INCIDENCIA') return `INCIDENCIA ${r.codigo}`.trim();
  return 'SIN REFERENCIA';
}

function campo(etq, ruta, valor, extra = '') {
  return `<label class="campo"><span>${etq}</span><input data-bind="${ruta}" value="${esc(valor == null ? '' : valor)}" ${extra}></label>`;
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
  return `
  ${cabeceraParte('volver-parte', 'Parte', `Trabajo ${i + 1} · ${esc(p.ref)}`)}
  <main class="contenido con-pie">
    <section class="tarjeta">
      <h2>Referencia</h2>
      <div class="segmentado">
        ${radio(rr, 'SIOS', 'SIOS', r.tipo, 'data-rerender')}${radio(rr, 'INCIDENCIA', 'Incidencia', r.tipo, 'data-rerender')}${radio(rr, 'SIN_REF', 'Sin referencia', r.tipo, 'data-rerender')}
      </div>
      ${r.tipo === 'SIOS' || r.tipo === 'INCIDENCIA'
    ? campo(r.tipo === 'SIOS' ? 'Nº de SIOS' : 'Nº de incidencia', `${b}.referencia.codigo`, r.codigo, 'autocomplete="off"') : ''}
      ${r.tipo === 'SIN_REF' ? `<label class="campo"><span>Motivo (¿por qué no tiene referencia?)</span>
        <textarea data-bind="${b}.referencia.motivo" rows="2">${esc(r.motivo)}</textarea></label>` : ''}
      ${t.fotos.length ? '<p class="nota">Las fotos ya hechas conservan la referencia con la que se hicieron.</p>' : ''}
      ${campo('Nº acta PIDAME', `${b}.pidame`, t.pidame, 'autocomplete="off"')}
    </section>

    <section class="tarjeta">
      <h2>Vía y horario</h2>
      <label class="check"><input type="checkbox" data-bind="${b}.sinVia" data-rerender ${t.sinVia ? 'checked' : ''}>
        <span>No se ocupa la vía <small>(p. ej. trabajos en base)</small></span></label>
      ${t.sinVia ? '' : `
      <div class="dos">${campo('Telefonema nº', `${b}.telefonema.numero`, t.telefonema.numero, 'inputmode="numeric" autocomplete="off"')}
        ${campo('Hora telefonema', `${b}.telefonema.hora`, t.telefonema.hora, 'type="time"')}</div>
      <div class="dos">${campo('Entrada en vía', `${b}.entradaVia`, t.entradaVia, 'type="time"')}
        ${campo('Salida de vía', `${b}.salidaVia`, t.salidaVia, 'type="time"')}</div>`}
      <div class="dos">${campo('Línea', `${b}.linea`, t.linea, 'inputmode="numeric" placeholder="040" autocomplete="off"')}
        ${campo('Vía', `${b}.via`, t.via, 'placeholder="1, 2…" autocomplete="off"')}</div>
      <div class="dos">${campo('PK inicio', `${b}.pkInicio`, t.pkInicio, 'inputmode="decimal" placeholder="481+045" autocomplete="off"')}
        ${campo('PK fin', `${b}.pkFin`, t.pkFin, 'inputmode="decimal" placeholder="481+049" autocomplete="off"')}</div>
    </section>

    <section class="tarjeta">
      <h2>Trabajo realizado</h2>
      <label class="campo"><span>Motivo de actuación <small>(opcional)</small></span>
        <input list="dl-motivos" data-bind="${b}.motivoActuacion" value="${esc(t.motivoActuacion)}" autocomplete="off"></label>
      <datalist id="dl-motivos">${motivosCfg(p.tipo).map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
      ${campo('Metros lineales <small>(opcional)</small>', `${b}.metrosLineales`, t.metrosLineales, 'type="number" inputmode="decimal" min="0" step="any"')}
      <label class="campo"><span>Descripción</span><textarea data-bind="${b}.descripcion" rows="3">${esc(t.descripcion)}</textarea></label>
      <div class="campo"><span>¿Trabajo finalizado?</span>
        <div class="segmentado">${radio(`${b}.finalizado`, 'si', 'Sí', fin, 'data-tipo="bool"')}${radio(`${b}.finalizado`, 'no', 'No', fin, 'data-tipo="bool"')}</div></div>
    </section>

    <section class="tarjeta">
      <h2>Fotos</h2>
      <p class="nota">Obligatorio: al menos una de <strong>antes</strong> y una de <strong>después</strong>.
        Cada foto lleva fecha, hora y referencia, y se le quita la ubicación.</p>
      ${FASES.map(([f, txt]) => {
    const fs = t.fotos.filter((x) => x.fase === f);
    return `
      <div class="fase">
        <div class="fase-cab"><strong>${txt}</strong> <span class="contador">${fs.length}</span>${f === 'durante' ? '' : '<span class="oblig">mín. 1</span>'}</div>
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
  <footer class="pie"><button class="btn primario grande" data-action="volver-parte">Listo</button></footer>
  <input type="file" id="in-camara" accept="image/*" capture="environment" hidden>
  <input type="file" id="in-galeria" accept="image/*" multiple hidden>
  ${estado.fotoVista ? vFotoGrande() : ''}
  ${estado.procesando ? `<div class="capa centro"><div class="hoja pequena"><div class="girando"></div><p>${esc(estado.procesando)}</p></div></div>` : ''}`;
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

async function anadirFotos(files, { fase, origen }) {
  const p = estado.parte;
  const t = trabajoActual();
  if (!t) return;
  let ok = 0;
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
      toast('No se ha podido usar una de las fotos (formato no compatible).', 4000);
    }
  }
  estado.procesando = '';
  await guardarYa();
  render();
  if (ok) toast(ok === 1 ? 'Foto añadida' : `${ok} fotos añadidas`);
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

function validar(p) {
  const e = [];
  const add = (msg, trabajo = null) => e.push({ msg, trabajo });
  const vacio = (s) => !String(s == null ? '' : s).trim();
  if (!p.fecha) add('Falta la fecha de la jornada.');
  if (!p.personal.length) add('Añade al menos una persona en «Personal».');
  if (!p.trabajos.length) add('Añade al menos un trabajo.');
  p.trabajos.forEach((t, i) => {
    const n = `Trabajo ${i + 1}:`;
    const r = t.referencia || {};
    if (!r.tipo) add(`${n} elige la referencia (SIOS, incidencia o sin referencia).`, i);
    else if (r.tipo === 'SIN_REF' && vacio(r.motivo)) add(`${n} explica por qué no tiene referencia.`, i);
    else if (r.tipo !== 'SIN_REF' && vacio(r.codigo)) add(`${n} falta el número de ${r.tipo === 'SIOS' ? 'SIOS' : 'incidencia'}.`, i);
    if (!t.sinVia) {
      if (!t.entradaVia) add(`${n} falta la hora de entrada en vía.`, i);
      if (!t.salidaVia) add(`${n} falta la hora de salida de vía.`, i);
      if (vacio(t.via)) add(`${n} falta la vía.`, i);
      if (vacio(t.pkInicio)) add(`${n} falta el PK de inicio.`, i);
      if (vacio(t.pkFin)) add(`${n} falta el PK de fin.`, i);
    }
    if (vacio(t.linea)) add(`${n} falta la línea.`, i);
    if (t.finalizado == null) add(`${n} indica si está finalizado (Sí o No).`, i);
    if (vacio(t.descripcion)) add(`${n} falta la descripción.`, i);
    if (!t.fotos.some((f) => f.fase === 'antes')) add(`${n} falta al menos una foto de ANTES.`, i);
    if (!t.fotos.some((f) => f.fase === 'despues')) add(`${n} falta al menos una foto de DESPUÉS.`, i);
  });
  if (p.usaMaquinaria == null) add('Indica si se ha usado maquinaria o vehículos (Sí o No).');
  else if (p.usaMaquinaria && !p.vehiculos.some((v) => !vacio(v.descripcion))) {
    add('Has marcado que se ha usado maquinaria: indica cuál (o marca «No»).');
  }
  if (vacio(p.antiincendios)) add('Rellena las medidas antiincendios.');
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
  const p = estado.parte;
  const e = estado.envio || {};
  const dest = (estado.config && estado.config.destinatario) || '';
  const enviado = p.estado === 'enviado';
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido">
    <section class="tarjeta ${enviado ? 'ok' : 'pendiente'}">
      <h2>${enviado ? 'Enviado ✓' : 'Cerrado · falta enviarlo'}</h2>
      <p>Jornada del ${fmtFecha(p.fecha)}${p.nocturna ? ' (nocturna)' : ''} · ${p.trabajos.length} trabajo(s) · ${p.personal.length} persona(s)</p>
      <p><small>Cerrado en el móvil: ${fmtFechaHora(p.cierre)}${p.envios.length ? `<br>Enviado: ${p.envios.map(fmtFechaHora).join(', ')}` : ''}</small></p>
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

    <section class="tarjeta">
      <h2>¿Hay algo mal?</h2>
      <p class="nota">Puedes corregirlo: se crea una copia para editar y, al enviarla, la oficina guarda las dos versiones.</p>
      <button class="btn secundario" data-action="corregir">Corregir el parte</button>
    </section>
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
      p.envios.push(isoLocal());
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
  if (!el.matches('[data-bind]')) return;
  aplicarBind(el);
  if (el.dataset.bind === 'usaMaquinaria' && estado.parte.usaMaquinaria && !estado.parte.vehiculos.length) {
    estado.parte.vehiculos.push({ descripcion: '', matricula: '' });
  }
  if (el.dataset.vehiculo != null) {
    const v = estado.parte.vehiculos[Number(el.dataset.vehiculo)];
    const m = vehiculosCfg().find((x) => x.descripcion === v.descripcion);
    if (m && !v.matricula) { v.matricula = m.matricula || ''; render(); }
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
    const capataz = estado.cambiandoPin ? estado.perfil.capataz : estado.setupCapataz;
    estado.perfil = { capataz, pin: { salt, hash, iter: ITER_PIN } };
    await db.kvSet('perfil', estado.perfil);
    await db.kvSet('fallos', null);
    estado.cambiandoPin = false;
    toast('PIN guardado');
    ir('inicio');
  } else if (tipo === 'pin') {
    const fallos = (await db.kvGet('fallos')) || { n: 0, hasta: 0 };
    if (Date.now() < fallos.hasta) {
      return toast(`Demasiados intentos. Espera ${Math.ceil((fallos.hasta - Date.now()) / 1000)} segundos.`);
    }
    const { salt, hash, iter } = estado.perfil.pin;
    if ((await hashPin(f.pin.value.trim(), salt, iter)) === hash) {
      await db.kvSet('fallos', null);
      return ir('inicio');
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
      if (confirm('Vas a crear un PIN nuevo. Tus partes no se borran. ¿Seguir?')) {
        estado.setupCapataz = estado.perfil.capataz;
        ir('setup-pin');
      }
      break;
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
    case 'borrar-trabajo': borrarTrabajo(); break;
    case 'nuevo-vehiculo': p.vehiculos.push({ descripcion: '', matricula: '' }); guardarPronto(); render(); break;
    case 'quitar-vehiculo': p.vehiculos.splice(i, 1); guardarPronto(); render(); break;
    case 'foto': {
      const t = trabajoActual();
      const r = t.referencia;
      if (!r.tipo || (r.tipo !== 'SIN_REF' && !r.codigo.trim())) {
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
    case 'cerrar-errores': estado.errores = []; render(); break;
    case 'reintentar-envio': prepararEnvioActual(); break;
    case 'enviar': enviar(); break;
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
