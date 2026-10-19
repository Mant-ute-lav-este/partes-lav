// Pantalla de inicio: lista de partes, aviso de los que faltan por enviar, menú y creación de
// partes nuevos (con la elección de máquina para los de maquinaria).

import * as db from './db.js';
import { esc, uuid, fechaLocal, isoLocal, fmtFecha, fmtFechaHora } from './util.js';
import { SUBTIPOS_MAQ, subtipoDe } from './validaciones.js';
import {
  PREFIJO_REF, claveContador, nuevaMaquinaVia, nuevoTajo, nuevoRealizado, ultimoParteDe, apartadosCopiables, repetirParte,
} from './modelo.js';
import { estado, ir, render, guardarYa, maquinasViaCfg, capatazComoPersona, medidasCfg } from './estado.js';
import { inputConfig } from './vista-acceso.js';
import { APP_VERSION } from './app.js';

// ---------- Inicio ----------

export function ultimoEnvio(p) {
  const x = (p.envios || [])[(p.envios || []).length - 1];
  return typeof x === 'string' ? x : (x && (x.recibido || x.fecha)) || '';
}

export function estadoTexto(p) {
  if (p.estado === 'borrador') return 'Borrador';
  if (p.estado === 'cerrado') return 'Pendiente de enviar';
  if (p.estado === 'en-cola') return p.errorEnvio ? 'No se ha podido enviar: ábrelo' : 'En cola: se enviará solo';
  return p.recibido ? `Recibido en la oficina ${fmtFechaHora(p.recibido)}` : `Enviado ${fmtFechaHora(ultimoEnvio(p))}`;
}

/** «3 trabajo(s)», «2 tajo(s)»… según el tipo de parte. */
export function textoCuenta(p) {
  if (p.tipo !== 'MAQUINARIA') return `${p.trabajos.length} trabajo(s)`;
  return subtipoDe(p) === 'via' ? `${(p.tajos || []).length} tajo(s)` : `${(p.realizados || []).length} trabajo(s)`;
}

export function itemParte(p) {
  const abrir = `
  <button class="item item-parte ${p.estado}" data-action="abrir" data-id="${p.id}">
    <span class="etiqueta ${p.tipo.toLowerCase()}">${p.tipo === 'MAQUINARIA' ? SUBTIPOS_MAQ[subtipoDe(p)].prefijo : p.tipo}</span>
    <span class="item-info"><strong>${fmtFecha(p.fecha)}${p.nocturna ? ' · noche' : ''}</strong> · ${esc(p.ref)}${p.rev > 1 ? ` rev. ${p.rev}` : ''}
      <br><small>${textoCuenta(p)} · ${estadoTexto(p)}</small></span>
    <span class="flecha">›</span>
  </button>`;
  // Papelera solo en borradores: lo cerrado o enviado no se borra desde la lista.
  return p.estado === 'borrador'
    ? `<div class="fila-parte">${abrir}<button class="papelera" data-action="borrar-borrador" data-id="${p.id}" aria-label="Borrar borrador ${esc(p.ref)}">🗑</button></div>`
    : abrir;
}

export function grupo(titulo, partes) {
  if (!partes.length) return '';
  return `<h2 class="titulo-grupo">${titulo}</h2>${partes.map(itemParte).join('')}`;
}

export function avisoSinEnviar(pendientes) {
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

export function vInicio() {
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
      <button class="btn-tipo maquinaria" data-action="nuevo" data-tipo="MAQUINARIA"><span class="tipo-grande">MAQUINARIA</span><span>Maquinaria de vía</span></button>
    </div>
    ${grupo('Pendientes de enviar', sinEnviar)}
    ${grupo('Borradores', ps.filter((p) => p.estado === 'borrador'))}
    ${grupo('Enviados', ps.filter((p) => p.estado === 'enviado').slice(0, 30))}
    ${ps.length ? '' : '<p class="vacio">Aún no hay partes. Pulsa INFRA, SUPER o MAQUINARIA para empezar.</p>'}
  </main>
  ${estado.menu ? vMenu() : ''}
  ${estado.eligeMaquina ? vElegirMaquina() : ''}
  ${estado.repetir ? vRepetir() : ''}`;
}

export function vMenu() {
  const c = estado.config || {};
  const srv = Boolean(estado.perfil && estado.perfil.token);
  return `
  <div class="capa" data-action="cerrar-menu"><div class="hoja" data-stop>
    <h2>Menú</h2>
    ${srv
    ? '<button class="btn secundario" data-action="actualizar-lista">Actualizar la lista de la oficina</button>'
    : `<button class="btn secundario" data-action="elegir-config">Cargar lista de la oficina</button>${inputConfig}
       <button class="btn secundario" data-action="cambiar-capataz">Cambiar de capataz</button>`}
    <a class="btn secundario" href="./guia/guia-capataces.pdf" target="_blank" rel="noopener">Guía rápida (PDF)</a>
    <button class="btn secundario" data-action="cambiar-pin">Cambiar PIN</button>
    <button class="btn secundario" data-action="bloquear">Bloquear la app</button>
    ${srv ? '<button class="btn secundario" data-action="cerrar-sesion">Cerrar sesión en este móvil</button>' : ''}
    <p class="nota">${srv ? `Cuenta: ${esc(estado.perfil.email)}${estado.perfil.cuenta === 'pendiente' ? ' (pendiente de aprobar)' : ''}<br>` : ''}
      Lista de la oficina: ${esc(c.nombre || 'sin nombre')}${c.fecha ? ` (${esc(c.fecha)})` : ''} ·
      ${(c.trabajadores || []).length} trabajadores<br>Versión de la app: ${APP_VERSION}</p>
    <button class="btn" data-action="cerrar-menu">Cerrar</button>
  </div></div>`;
}

/**
 * @param {string} tipo INFRA, SUPER o MAQUINARIA
 * @param {object} [maquina] solo MAQUINARIA: la máquina elegida ({descripcion, uic, trabajo, parte}),
 *   que decide qué parte se rellena (de vía, de locomotora o de dresina).
 */
export async function nuevoParte(tipo, maquina = null) {
  const sub = tipo === 'MAQUINARIA' ? (maquina && maquina.parte) || 'via' : null;
  const ahora = new Date();
  // De madrugada, la jornada de SUPER y la de MAQUINARIA empezaron ayer. En INFRA ya no hay
  // jornada nocturna ni fecha automática. MAQUINARIA no marca «nocturna»: lleva su horario.
  const madrugada = tipo !== 'INFRA' && ahora.getHours() < 7;
  const nocturna = tipo === 'SUPER' && madrugada;
  const dia = new Date(ahora);
  if (madrugada) dia.setDate(dia.getDate() - 1);
  const fecha = fechaLocal(dia);
  const lista = await db.listarPartes();
  const nombreTipo = sub && sub !== 'via' ? sub : tipo;
  if (lista.some((p) => p.tipo === tipo && (p.subtipo || 'via') === (sub || 'via') && p.fecha === fecha && !p.rectificaA) &&
      !confirm(`Ya tienes un parte ${nombreTipo} del ${fmtFecha(fecha)}. ¿Quieres empezar otro?`)) return;
  // INFRA y SUPER: si hay un parte anterior del mismo tipo con algo que copiar, se pregunta antes.
  if (!sub) {
    const previo = ultimoParteDe(lista, tipo);
    const apartados = previo ? apartadosCopiables(previo, estado.perfil.capataz, medidasCfg()) : [];
    if (apartados.length) {
      estado.repetir = { tipo, previoId: previo.id, ref: previo.ref, rev: previo.rev, fecha: previo.fecha, nocturna: previo.nocturna, apartados, nuevo: { fecha, nocturna } };
      render();
      return;
    }
  }
  await crearParte(tipo, maquina, sub, fecha, nocturna);
}

/**
 * Respuesta a «¿Empezar igual que el último parte?»: con `si`, copia los apartados marcados.
 * El número de parte no se gasta hasta aquí.
 */
export async function contestarRepetir(si) {
  const r = estado.repetir;
  if (!r) return;
  const claves = si ? [...document.querySelectorAll('[data-repetir]:checked')].map((x) => x.dataset.repetir) : [];
  estado.repetir = null;
  const previo = claves.length ? await db.getParte(r.previoId) : null;
  await crearParte(r.tipo, null, null, r.nuevo.fecha, r.nuevo.nocturna, previo ? { previo, claves } : null);
}

async function crearParte(tipo, maquina, sub, fecha, nocturna, copia = null) {
  // Locomotora y dresina llevan su propia numeración (LOC-, DRE-); el de vía sigue con MAQ-.
  const prefijo = sub ? SUBTIPOS_MAQ[sub].prefijo : PREFIJO_REF[tipo];
  const clave = claveContador(prefijo);
  const n = ((await db.kvGet(clave)) || 0) + 1;
  await db.kvSet(clave, n);
  const iso = isoLocal();
  estado.parte = {
    formato: 'parte-lav',
    version: 1,
    id: uuid(),
    ref: `${prefijo}-${String(n).padStart(4, '0')}`,
    rev: 1,
    rectificaA: null,
    tipo,
    fecha,
    nocturna,
    capataz: estado.perfil.capataz,
    personal: [capatazComoPersona()],
    trabajos: [],
    formato1: [],   // fotos del formato de protección de la vía (solo SUPER, opcional)
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
  if (sub === 'via') {
    const m = maquina || {};
    Object.assign(estado.parte, {
      subtipo: 'via',
      personal: [],   // cada persona lleva su puesto (encargado, maquinista, piloto, omi, operario)
      horaInicio: '',
      horaFin: '',
      maquinasVia: [{ ...nuevaMaquinaVia(), descripcion: m.descripcion || '', uic: m.uic || '', trabajo: m.trabajo || '' }],
      viaje: { horaSalida: '', lugarSalida: '', horaLlegada: '', lugarLlegada: '' },
      tajos: [nuevoTajo()],
    });
  } else if (sub) {
    Object.assign(estado.parte, {
      subtipo: sub,
      personal: [],   // con su puesto: maquinista, responsable / amparo, operario
      maquina: { descripcion: maquina.descripcion || '', uic: maquina.uic || '', otro: Boolean(maquina.otro) },
      acta: '',
      salida: { hora: '', lugar: '' },
      apartado: { hora: '', lugar: '' },
      realizados: [nuevoRealizado()],
      combustible: { salida: '', llegada: '' },
      km: { salida: '', llegada: '' },
      ...(sub === 'locomotora'
        ? { vagones: [], procedencia: '' }
        : { uicPlataforma: '', telefonemas: { entrada: { numero: '', hora: '' }, salida: { numero: '', hora: '' } } }),
    });
  }
  if (copia) {
    estado.parte = repetirParte(estado.parte, copia.previo, copia.claves, medidasCfg());
    estado.avisoCopia = `Copiado del ${copia.previo.ref} (${fmtFecha(copia.previo.fecha)}). Revisa quién ha venido hoy y los equipos.`;
  }
  await guardarYa();
  ir('parte');
}

/** «¿Empezar igual que el último parte?»: casillas con lo que se puede copiar, todas marcadas. */
export function vRepetir() {
  const r = estado.repetir;
  return `
  <div class="capa" data-action="cerrar-repetir"><div class="hoja" data-stop>
    <h2>¿Empezar igual que el último parte?</h2>
    <p class="nota">${esc(r.ref)}${r.rev > 1 ? ` rev. ${r.rev}` : ''} · ${fmtFecha(r.fecha)}${r.nocturna ? ' · noche' : ''}</p>
    ${r.apartados.map((a) => `
    <label class="check"><input type="checkbox" data-repetir="${a.clave}" checked>
      <span>${esc(a.titulo)}<br><small>${esc(a.detalle)}</small></span></label>`).join('')}
    <p class="nota">No se copian los trabajos, las horas extra, las fotos${r.tipo === 'SUPER' ? ', el formato 1' : ''} ni las observaciones.</p>
    <button class="btn primario grande" data-action="repetir-si">Sí, copiar lo marcado</button>
    <button class="btn secundario" data-action="repetir-no">No, empezar en blanco</button>
  </div></div>`;
}

/** Al pulsar MAQUINARIA: primero la máquina, que decide qué parte se rellena. */
export function vElegirMaquina() {
  const cfg = maquinasViaCfg();
  const grupos = [['via', 'Maquinaria de vía'], ['locomotora', 'Locomotoras'], ['dresina', 'Dresina']];
  return `
  <div class="capa" data-action="cerrar-eleccion"><div class="hoja" data-stop>
    <h2>¿Con qué máquina?</h2>
    <p class="nota">Según la máquina se abre su parte.</p>
    ${grupos.map(([g, titulo]) => {
    const ms = cfg.map((c, j) => ({ c, j })).filter(({ c }) => (c.parte || 'via') === g);
    return `<h3>${titulo}</h3>
      ${ms.map(({ c, j }) => `<button class="btn secundario" data-action="elegir-maquina" data-j="${j}">${esc(c.descripcion)}${c.uic ? ` <small>· UIC ${esc(c.uic)}</small>` : ''}</button>`).join('')}
      ${g === 'locomotora' ? '<button class="btn secundario" data-action="elegir-maquina" data-otra="locomotora">Otra locomotora (escribirla)</button>' : ''}`;
  }).join('')}
    <button class="btn" data-action="cerrar-eleccion">Cancelar</button>
  </div></div>`;
}
