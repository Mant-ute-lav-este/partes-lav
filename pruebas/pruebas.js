// Pruebas automáticas de la app y del servidor. Se ejecutan en Edge sin ventana con
// privado/herramientas/pruebas.ps1 (y antes de cada publicación, desde publicar.ps1).
// También se pueden abrir a mano: http://localhost:8765/pruebas/pruebas.html

import * as util from '../js/util.js';
import * as db from '../js/db.js';
import { textoReferencia, generarPDF } from '../js/pdf.js';
import { carpetaDestino, nombreBase, prepararEnvio } from '../js/envio.js';
import { esHeic, procesarFoto } from '../js/fotos.js';
import { procesarSalida } from '../js/salida.js';
import { iniciarFallos, registrarFallo } from '../js/fallos.js';
import { SERVIDOR_URL } from '../js/servidor.js';
import * as ej from './ejemplos.js';
import { cargarServidor } from './google-simulado.js';

const resultados = [];
const pruebas = [];
const prueba = (nombre, fn) => pruebas.push({ nombre, fn });

function igual(real, esperado, que = '') {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${que ? que + ': ' : ''}esperaba ${b} y salió ${a}`);
}
function cierto(v, que) { if (!v) throw new Error(que || 'no se cumple'); }
async function falla(fn, que) {
  try { await fn(); } catch { return; }
  throw new Error(`${que}: debería haber dado error`);
}

/** Foto JPEG de verdad, hecha con un canvas. */
async function jpeg(ancho = 64, alto = 48) {
  const cv = document.createElement('canvas');
  cv.width = ancho;
  cv.height = alto;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#3a7';
  cx.fillRect(0, 0, ancho, alto);
  return new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8));
}

// ---------- util ----------

prueba('util: fechas', () => {
  const d = new Date(2026, 0, 5, 7, 8, 9);
  igual(util.fechaLocal(d), '2026-01-05');
  cierto(/^2026-01-05T07:08:09[+-]\d\d:\d\d$/.test(util.isoLocal(d)), 'isoLocal con zona: ' + util.isoLocal(d));
  igual(util.fmtFecha('2026-10-02T07:12:33+02:00'), '02/10/2026');
  igual(util.fmtFechaHora('2026-10-02T07:12:33+02:00'), '02/10/2026 07:12');
  igual(util.fmtFecha(''), '');
});

prueba('util: textos', () => {
  igual(util.normaliza('  Ángel NÚÑEZ '), 'angel nunez');
  igual(util.slug('José Mª Pérez'), 'Jose_M_Perez');
  igual(util.slug(''), 'SinNombre');
  igual(util.esc('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
});

prueba('util: rutas', () => {
  const o = {};
  util.setPath(o, 'trabajos.0.referencia.tipo', 'SIOS');
  igual(o, { trabajos: [{ referencia: { tipo: 'SIOS' } }] });
  igual(util.getPath(o, 'trabajos.0.referencia.tipo'), 'SIOS');
  igual(util.getPath(o, 'nada.de.nada'), undefined);
});

// ---------- referencia, carpeta y nombres ----------

prueba('referencia del trabajo', () => {
  igual(textoReferencia({ referencia: { tipo: 'SIOS', codigo: 'S-1' } }), 'SIOS S-1');
  igual(textoReferencia({ referencia: { tipo: 'INCIDENCIA', codigo: 'I-2' } }), 'Incidencia I-2');
  igual(textoReferencia({ referencia: { tipo: 'SIN_REF', motivo: ' Limpieza ' } }), 'Limpieza');
  igual(textoReferencia({ referencia: { tipo: 'SIN_REF', motivo: '' } }), 'Sin referencia');
  igual(textoReferencia({}), '');
});

prueba('carpeta de Teams y nombre de archivos', () => {
  igual(carpetaDestino(ej.parteInfra()), '2026-10-14/Infra/INF-9001_Ana_Prueba');
  igual(carpetaDestino(ej.parteSuper()), '2026-10-14/Super/SUP-9001_Ana_Prueba');
  igual(carpetaDestino(ej.parteMaqVia()), '2026-10-14/Maquinaria/MAQ-9001_Ana_Prueba');
  igual(carpetaDestino(ej.parteLoco('dresina')), '2026-10-14/Maquinaria/DRE-9001_Ana_Prueba');
  const r = { ...ej.parteInfra(), rev: 2 };
  igual(nombreBase(r), '2026-10-14_INFRA_INF-9001_v2_Ana_Prueba');
});

// ---------- PDF y envío de los 5 tipos de parte ----------

const tipos = [
  ['INFRA', ej.parteInfra], ['SUPER', ej.parteSuper], ['MAQUINARIA de vía', ej.parteMaqVia],
  ['locomotora', () => ej.parteLoco('locomotora')], ['dresina', () => ej.parteLoco('dresina')],
];

for (const [nombre, hacer] of tipos) {
  prueba(`PDF y envío: ${nombre}`, async () => {
    const p = hacer();
    const foto = await jpeg();
    const leerFoto = async () => foto;
    const pdf = await generarPDF(p, ej.config, 'prueba', leerFoto);
    cierto(pdf instanceof Blob && pdf.size > 1000, 'el PDF está vacío');
    const cabecera = await pdf.slice(0, 5).text();
    igual(cabecera, '%PDF-', 'cabecera del PDF');
    const r = await prepararEnvio(p, ej.config, leerFoto, 'prueba');
    igual(r.archivos.length, 3, 'número de adjuntos');
    cierto(r.asunto.startsWith('PARTE LAV · '), 'el asunto debe empezar por «PARTE LAV» (lo usa Power Automate)');
    const datos = JSON.parse(await r.archivos[1].text());
    igual(datos.carpeta, carpetaDestino(p), 'carpeta en Datos');
    const fotos = JSON.parse(await r.archivos[2].text());
    igual(fotos.formato, 'fotos-parte-lav');
    const esperadas = p.trabajos.reduce((n, t) => n + t.fotos.length, 0) + (p.formato1 || []).length;
    igual(fotos.fotos.length, esperadas, 'fotos en el adjunto');
    cierto(fotos.fotos.every((f) => f.base64 && /\.jpg$/.test(f.archivo)), 'fotos sin datos o sin nombre .jpg');
    if (p.formato1 && p.formato1.length) cierto(fotos.fotos.some((f) => f.archivo === 'Formato1_1.jpg'), 'falta Formato1_1.jpg');
  });
}

prueba('envío: avisa si falta una foto', async () => {
  await falla(() => prepararEnvio(ej.parteInfra(), ej.config, async () => null, 'prueba'), 'foto que falta');
});

prueba('envío: aviso de fotos de galería sin fecha original', async () => {
  const foto = await jpeg();
  const r = await prepararEnvio(ej.parteInfra(), ej.config, async () => foto, 'prueba');
  cierto(r.cuerpo.includes('AVISO: fotos de galería sin fecha original'), 'falta el aviso en el correo');
});

// ---------- fotos ----------

prueba('fotos: detecta HEIC por tipo, nombre y firma', () => {
  cierto(esHeic({ type: 'image/heic', name: 'a' }), 'por tipo');
  cierto(esHeic({ type: '', name: '1000089762.HEIC' }), 'por nombre');
  const buf = new Uint8Array([0, 0, 0, 24, ...'ftypheic'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0]).buffer;
  cierto(esHeic({ type: '', name: 'x' }, buf), 'por firma');
  cierto(!esHeic({ type: 'image/jpeg', name: 'a.jpg' }, new ArrayBuffer(16)), 'un JPEG no es HEIC');
});

prueba('fotos: procesa una foto de cámara (sello y tamaño)', async () => {
  const f = new File([await jpeg(800, 600)], 'prueba.jpg', { type: 'image/jpeg' });
  const r = await procesarFoto(f, { origen: 'camara', fase: 'antes', etiqueta: 'T1 · SIOS S-1', ref: 'INF-9001' });
  cierto(r.blob instanceof Blob && r.blob.size > 0, 'sin imagen');
  cierto(r.ancho > 0 && r.alto > 0, 'sin medidas');
  cierto(r.fechaFoto, 'sin fecha');
});

prueba('fotos: un archivo que no es imagen da error', async () => {
  const f = new File(['esto no es una foto'], 'nota.jpg', { type: 'image/jpeg' });
  await falla(() => procesarFoto(f, { origen: 'galeria', fase: 'antes', etiqueta: 'x', ref: 'x' }), 'archivo roto');
});

// ---------- cola de salida (servidor simulado con fetch falso) ----------

async function conFetch(falso, fn) {
  const real = window.fetch;
  window.fetch = async (url, op) => (String(url).startsWith(SERVIDOR_URL) ? falso(url, op) : real(url, op));
  try { return await fn(); } finally { window.fetch = real; }
}
const respuesta = (o) => new Response(JSON.stringify(o), { headers: { 'Content-Type': 'application/json' } });

async function conPerfil(fn) {
  const perfil = await db.kvGet('perfil');
  const cola = await db.listarSalida();
  for (const it of cola) await db.borrarSalida(it.id);
  await db.kvSet('perfil', { capataz: 'Ana Prueba', email: 'ana@ejemplo.test', token: 'token-prueba', cuenta: 'activo' });
  try { return await fn(); } finally {
    for (const it of await db.listarSalida()) await db.borrarSalida(it.id);
    for (const it of cola) await db.putSalida(it);
    if (perfil) await db.kvSet('perfil', perfil); else await db.kvSet('perfil', undefined);
  }
}

prueba('salida: un parte en cola se envía y queda «enviado»', () => conPerfil(async () => {
  const p = ej.parteInfra();
  await db.putParte(p);
  await db.putSalida({ id: crypto.randomUUID(), parteId: p.id, creado: '2026-10-14T10:00:00+02:00', datos: { asunto: 'x', archivos: [] } });
  const pedidas = [];
  const r = await conFetch(async (url, op) => { pedidas.push(JSON.parse(op.body)); return respuesta({ ok: true, recibido: '2026-10-14T10:01:00+02:00' }); },
    () => procesarSalida());
  igual(r, { enviados: 1, pendientes: 0 });
  igual(pedidas[0].accion, 'enviar');
  igual(pedidas[0].token, 'token-prueba');
  const g = await db.getParte(p.id);
  igual(g.estado, 'enviado');
  igual(g.recibido, '2026-10-14T10:01:00+02:00');
  await db.borrarParte(p.id);
}));

prueba('salida: si el servidor rechaza, se queda en cola con el error', () => conPerfil(async () => {
  const p = ej.parteInfra();
  await db.putParte(p);
  await db.putSalida({ id: crypto.randomUUID(), parteId: p.id, creado: '2026-10-14T10:00:00+02:00', datos: {} });
  const r = await conFetch(async () => respuesta({ ok: false, error: 'Tu registro aún no está aprobado por la oficina.' }), () => procesarSalida());
  igual(r, { enviados: 0, pendientes: 1 });
  const g = await db.getParte(p.id);
  igual(g.errorEnvio, 'Tu registro aún no está aprobado por la oficina.');
  await db.borrarParte(p.id);
}));

prueba('salida: sin conexión no pierde nada', () => conPerfil(async () => {
  const p = ej.parteInfra();
  await db.putParte(p);
  await db.putSalida({ id: crypto.randomUUID(), parteId: p.id, creado: '2026-10-14T10:00:00+02:00', datos: {} });
  const r = await conFetch(async () => { throw new TypeError('Failed to fetch'); }, () => procesarSalida());
  igual(r.pendientes, 1);
  const g = await db.getParte(p.id);
  igual(g.estado, 'cerrado', 'el parte no debe cambiar de estado');
  await db.borrarParte(p.id);
}));

// ---------- registro de fallos ----------

prueba('fallos: se guardan sin datos personales y sin repetir', async () => {
  const antes = await db.kvGet('fallos');
  const perfil = await db.kvGet('perfil');
  await db.kvSet('perfil', undefined);   // sin sesión: se queda en el móvil, no se manda
  await db.kvSet('fallos', []);
  try {
    iniciarFallos('prueba');
    const texto = 'No se pudo leer 1000089762.heic de ana.prueba@gmail.com tel 612345678 https://x.test/a?b=1';
    await registrarFallo('foto', texto);
    await registrarFallo('foto', texto);
    const g = await db.kvGet('fallos');
    igual(g.length, 1, 'repetido');
    igual(g[0].mensaje, 'No se pudo leer [nº].heic de [correo] tel [nº] [url]');
    igual(g[0].version, 'prueba');
    for (let i = 0; i < 30; i++) await registrarFallo('js', 'error ' + 'x'.repeat(i));
    igual((await db.kvGet('fallos')).length, 20, 'máximo 20 guardados');
    await registrarFallo('js', 'y'.repeat(500));
    igual((await db.kvGet('fallos')).at(-1).mensaje.length, 200, 'recortado a 200');
  } finally {
    await db.kvSet('fallos', antes || []);
    await db.kvSet('perfil', perfil);
  }
});

// ---------- servidor (Code.gs con Google simulado) ----------

let nuevoServidor;
async function servidorListo() {
  if (!nuevoServidor) nuevoServidor = await cargarServidor();
  const E = nuevoServidor();
  E.s.configurar();
  E.hojas.Ajustes.appendRow(['destinatario', 'oficina@ejemplo.test']);
  E.hojas.Usuarios.appendRow(['ana@ejemplo.test', 'Ana Prueba', 'activo', 's', 'h', '0', '0', '2026-01-01', '']);
  E.hojas.Usuarios.appendRow(['rec@ejemplo.test', 'Rechazado Prueba', 'rechazado', 's', 'h', '0', '0', '2026-01-01', '']);
  E.token = E.s.crearSesion_('ana@ejemplo.test');
  E.parte = (extra = {}) => ({
    accion: 'enviar', token: E.token, envioId: crypto.randomUUID(), peticion: crypto.randomUUID(),
    asunto: 'INFRA · INF-9001', ref: 'INF-9001', cuerpo: 'x', archivos: [{ nombre: 'Datos.txt', texto: '{}' }], ...extra,
  });
  return E;
}

prueba('servidor: envía un parte sin tener bloqueado al resto', async () => {
  const E = await servidorListo();
  let bloqueadoAlEnviar = null;
  E.g.alEnviarCorreo = () => { bloqueadoAlEnviar = E.bloqueado(); };
  const r = E.post(E.parte());
  igual(r.ok, true, r.error);
  igual(bloqueadoAlEnviar, false, 'bloqueo durante el correo');
  igual(E.bloqueado(), false, 'bloqueo al terminar');
  igual(E.hojas.Envios._d.length, 2, 'fila en Envios');
  cierto(E.correos[0].subject.startsWith('PARTE LAV'), 'asunto del correo');
});

prueba('servidor: copia de los partes (Ajustes «copia») y cuenta por destinatario', async () => {
  const E = await servidorListo();
  E.post(E.parte());
  igual(E.correos[0].cc, undefined, 'sin copia configurada no debe llevar CC');
  igual(JSON.parse(E.props.CORREOS).n, 1);
  E.hojas.Ajustes.appendRow(['copia', ' Otro@Ejemplo.test ; mal-escrito , tercero@ejemplo.test']);
  E.post(E.parte());
  igual(E.correos[1].cc, 'otro@ejemplo.test,tercero@ejemplo.test', 'CC');
  igual(E.correos[1].to, 'oficina@ejemplo.test');
  igual(JSON.parse(E.props.CORREOS).n, 4, 'un parte con 2 copias cuenta 3 destinatarios');
});

prueba('servidor: un reintento no manda el correo dos veces', async () => {
  const E = await servidorListo();
  const p = E.parte();
  E.post(p);
  const r = E.post({ ...p, peticion: crypto.randomUUID() });
  igual(r.repetido, true);
  igual(E.correos.length, 1);
});

prueba('servidor: envío en curso → «ocupado», sin guardar esa respuesta', async () => {
  const E = await servidorListo();
  const p = E.parte();
  E.cache['e:' + p.envioId] = '1';
  const r1 = E.post(p);
  igual(r1.reintentar, true);
  delete E.cache['e:' + p.envioId];
  const r2 = E.post(p);   // mismo identificador de petición: no debe devolver el «ocupado» guardado
  igual(r2.ok, true, r2.error);
});

prueba('servidor: si falla el correo se puede reintentar', async () => {
  const E = await servidorListo();
  const p = E.parte();
  E.g.alEnviarCorreo = () => { throw new Error('cuota agotada'); };
  igual(E.post(p).ok, false);
  E.g.alEnviarCorreo = null;
  igual(E.post({ ...p, peticion: crypto.randomUUID() }).ok, true);
  igual(E.hojas.Envios._d.length, 2);
});

prueba('servidor: rechaza sesión no válida, parte sin archivos y cuenta no activa', async () => {
  const E = await servidorListo();
  cierto(/Sesión no válida/.test(E.post(E.parte({ token: 'nada' })).error), 'sesión');
  cierto(/archivos/.test(E.post(E.parte({ archivos: [] })).error), 'sin archivos');
  E.hojas.Usuarios.appendRow(['pen@ejemplo.test', 'Pendiente Prueba', 'pendiente', 's', 'h', '0', '0', '2026-01-01', '']);
  const tp = E.s.crearSesion_('pen@ejemplo.test');
  cierto(/no está aprobado/.test(E.post(E.parte({ token: tp })).error), 'pendiente');
  igual(E.correos.length, 0);
});

prueba('servidor: registro de fallos sin nombre ni correo', async () => {
  const E = await servidorListo();
  const r = E.post({ accion: 'fallo', token: E.token, peticion: crypto.randomUUID(), fallos: [{ tipo: 'foto', mensaje: 'm', fecha: 'f', version: 'v' }] });
  igual(r.guardados, 1);
  const fila = E.hojas.Errores._d[1];
  igual(fila.slice(3), ['v', 'foto', 'm']);
  cierto(!JSON.stringify(E.hojas.Errores._d).match(/Ana|@ejemplo/), 'hay datos personales en Errores');
});

prueba('servidor: aviso único a los 70 correos y resumen diario', async () => {
  const E = await servidorListo();
  for (let i = 0; i < 75; i++) E.s.enviarCorreo_({ to: 'x@ejemplo.test', subject: 'c', body: '' });
  igual(E.correos.filter((c) => /^Aviso:/.test(c.subject)).length, 1);
  E.s.resumenDiario();
  const r = E.correos.at(-1);
  cierto(!/PARTE LAV/.test(r.subject), 'el resumen no puede llevar «PARTE LAV» (lo cogería Power Automate)');
  cierto(/Correos enviados hoy/.test(r.body) && /Fallos de campo hoy/.test(r.body), 'faltan líneas en el resumen');
});

prueba('servidor: limpieza de sesiones', async () => {
  const E = await servidorListo();
  E.hojas.Sesiones.appendRow(['hVIEJA', 'ana@ejemplo.test', '2025-01-01T10:00:00+01:00', '2025-02-01T10:00:00+01:00']);
  E.hojas.Sesiones.appendRow(['hUSADA', 'ana@ejemplo.test', '2025-01-01T10:00:00+01:00', util.isoLocal()]);
  E.hojas.Sesiones.appendRow(['hRECH', 'rec@ejemplo.test', util.isoLocal(), '']);
  E.hojas.Sesiones.appendRow(['hBORR', 'nadie@ejemplo.test', util.isoLocal(), '']);
  igual(E.s.limpiarSesiones_(), 3);
  igual(E.s.limpiarSesiones_(), 0, 'segunda pasada');
  const quedan = E.s.tabla_('Sesiones').filas.filter((s) => s.TokenHash).map((s) => s.TokenHash);
  cierto(quedan.includes('hUSADA') && quedan.length === 2, 'quedan: ' + quedan);
  igual(E.post({ accion: 'estado', token: E.token }).ok, true, 'la sesión reciente sigue valiendo');
});

// ---------- la app arranca ----------

prueba('la app carga sin errores', () => new Promise((res, rej) => {
  const f = document.createElement('iframe');
  f.style.cssText = 'width:400px;height:700px;border:1px solid #ccc';
  const errores = [];
  f.onload = () => {
    f.contentWindow.addEventListener('error', (e) => errores.push(e.message));
    f.contentWindow.addEventListener('unhandledrejection', (e) => errores.push(String(e.reason)));
    const inicio = Date.now();
    const mirar = async () => {
      const app = f.contentDocument.getElementById('app');
      if (errores.length) return rej(new Error('errores: ' + errores.join(' | ')));
      if (app && app.innerHTML.length > 100) {
        // Que el service worker de la app no se quede sirviendo copias viejas en este navegador.
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        f.remove();
        return res();
      }
      if (Date.now() - inicio > 10000) return rej(new Error('la pantalla sigue vacía tras 10 s'));
      setTimeout(mirar, 200);
    };
    mirar();
  };
  f.src = '../index.html';
  document.body.append(f);
}));

// ---------- ejecutar ----------

async function ejecutar() {
  const salida = document.getElementById('resultado');
  for (const { nombre, fn } of pruebas) {
    const t0 = performance.now();
    try {
      await fn();
      resultados.push({ nombre, ok: true, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      resultados.push({ nombre, ok: false, error: String((e && e.message) || e) });
    }
    salida.textContent = resultados.map((r) => `${r.ok ? 'OK   ' : 'FALLO'} ${r.nombre}${r.ok ? '' : '\n      ' + r.error}`).join('\n');
  }
  const fallos = resultados.filter((r) => !r.ok).length;
  const resumen = { total: resultados.length, fallos, resultados };
  salida.textContent += `\n\n${fallos ? `HAY ${fallos} FALLO(S)` : 'TODO CORRECTO'} · ${resultados.length} pruebas`;
  document.title = fallos ? 'FALLOS' : 'OK';
  // Para pruebas.ps1: el servidor local lo guarda en privado/herramientas/salida/.
  await fetch('/__guardar?nombre=resultado-pruebas.json', { method: 'POST', body: JSON.stringify(resumen) }).catch(() => {});
}

window.addEventListener('load', ejecutar);
