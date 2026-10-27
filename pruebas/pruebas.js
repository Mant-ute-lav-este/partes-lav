// Pruebas automáticas de la app y del servidor. Se ejecutan en Edge sin ventana con
// privado/herramientas/pruebas.ps1 (y antes de cada publicación, desde publicar.ps1).
// También se pueden abrir a mano: http://localhost:8765/pruebas/pruebas.html

import * as util from '../js/util.js';
import * as db from '../js/db.js';
import { textoReferencia, generarPDF } from '../js/pdf.js';
import { carpetaDestino, nombreBase, prepararEnvio } from '../js/envio.js';
import { esHeic, procesarFoto } from '../js/fotos.js';
import { procesarSalida } from '../js/salida.js';
import { limpiarFotosAntiguas, textoEspacio } from '../js/espacio.js';
import { iniciarFallos, registrarFallo } from '../js/fallos.js';
import { leerAspecto, guardarAspecto, aplicarAspecto } from '../js/aspecto.js';
import { SERVIDOR_URL } from '../js/servidor.js';
import * as val from '../js/validaciones.js';
import * as modelo from '../js/modelo.js';
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

// ---------- validaciones (lo que falta para cerrar un parte) ----------
// Se comprueban los textos exactos: son los que lee el capataz.

const msgs = (errores) => errores.map((e) => e.msg);
const cortos = (faltas) => faltas.map((f) => f.corto);
/** Ejemplo con las horas extra como las guarda la app (número, no texto). */
const conExtras = (p) => { p.extras = [{ nombre: 'Luis Ejemplo', horas: 1.5, tipo: 'normales', motivo: '' }]; return p; };
const infra = () => conExtras(ej.parteInfra());
const maqVia = () => conExtras(ej.parteMaqVia());
const loco = (subtipo = 'locomotora') => conExtras(ej.parteLoco(subtipo));

prueba('validaciones: horas, PK, números y semana', () => {
  cierto(val.horaValida('08:30') && val.horaValida('23:59') && val.horaValida('00:00'), 'horas buenas');
  cierto(!val.horaValida('24:00') && !val.horaValida('8:30') && !val.horaValida('') && !val.horaValida(null), 'horas malas');
  cierto(val.pkValido('481+045') && val.pkValido('481.045') && val.pkValido(' 481 + 45 '), 'PK buenos');
  cierto(!val.pkValido('481') && !val.pkValido('') && !val.pkValido('+045') && !val.pkValido(null), 'PK malos');
  cierto(val.numeroValido('30') && val.numeroValido('1,5') && val.numeroValido('2.25') && val.numeroValido(0), 'números buenos');
  cierto(!val.numeroValido('') && !val.numeroValido('a') && !val.numeroValido('-1') && !val.numeroValido('1,'), 'números malos');
  cierto(val.numeroOk('1,5') && !val.numeroOk('0') && !val.numeroOk('') && !val.numeroOk(null), 'números mayores que 0');
  igual(val.aNumero('1,5'), 1.5);
  igual([val.textoBool(true), val.textoBool(false), val.textoBool(null)], ['si', 'no', '']);
  igual(val.semanaIso('2026-10-14'), '42');
  igual(val.semanaIso('2026-01-01'), '1');
  igual(val.semanaIso('2025-12-29'), '1', 'lunes de la semana 1 del año siguiente');
  igual(val.semanaIso('2027-01-01'), '53');
  igual(val.semanaIso(''), '');
});

prueba('varias vías: lista, validaciones, PDF y correo', async () => {
  igual(val.listaVias('1, 2'), ['1', '2']);
  igual(val.listaVias('2'), ['2']);
  igual([val.listaVias(''), val.listaVias(null), val.listaVias(undefined)], [[], [], []]);
  igual(val.unirVias(['2', '1']), '1, 2', 'se ordenan');
  igual(val.unirVias(['3', '1', '3', '10', '2']), '1, 2, 3, 10', 'sin repetir y en orden numérico');
  igual(val.unirVias([]), '', 'ninguna marcada');
  // Una o varias vías valen igual para validar; sin vías sigue faltando.
  const s = ej.parteSuper();
  s.trabajos[0].via = '1, 2';
  igual(val.faltasTrabajo(s.trabajos[0]), [], 'trabajo con 2 vías');
  s.trabajos[0].via = '';
  igual(cortos(val.faltasTrabajo(s.trabajos[0])), ['vía'], 'sin vía falta');
  const t = ej.parteMaqVia().tajos[0]; t.via = '1, 2';
  igual(val.faltasTajo(t), [], 'tajo con 2 vías');
  t.via = '';
  igual(cortos(val.faltasTajo(t)), ['vía']);
  const r = ej.parteLoco().realizados[0]; r.via = '1, 2';
  igual(val.faltasRealizado(r), [], 'trabajo realizado con 2 vías');
  // PDF y correo con varias vías (SUPER, tajo de vía y locomotora)
  const leerFoto = async () => jpeg();
  const sup = ej.parteSuper(); sup.trabajos[0].via = '1, 3, 5';
  const maq = ej.parteMaqVia(); maq.tajos[0].via = '1, 2, 3, 4, 5';
  const loc = ej.parteLoco(); loc.realizados[0].via = '1, 2';
  for (const [p, vias] of [[sup, '1, 3, 5'], [maq, '1, 2, 3, 4, 5'], [loc, '1, 2']]) {
    const pdf = await generarPDF(p, ej.config, 'prueba', leerFoto);
    igual(await pdf.slice(0, 5).text(), '%PDF-', `PDF de ${p.ref}`);
    const e = await prepararEnvio(p, ej.config, leerFoto, 'prueba');
    cierto((await e.archivos[1].text()).includes(`"via": "${vias}"`), `datos de ${p.ref} con las vías «${vias}»`);
    if (p !== sup) cierto(e.cuerpo.includes(`vía ${vias} PK`), `correo de ${p.ref} con las vías`);
  }
  // Los partes de antes (una sola vía) siguen igual.
  igual(val.listaVias(ej.parteInfra().trabajos[0].via), ['1']);
});

prueba('peso del correo: aviso y cuántas fotos quitar', () => {
  const MB = 1048576;
  igual(val.pesoCorreoMB([]), 0);
  igual(Math.round(val.pesoCorreoMB([MB, MB, 3 * MB]) * 10) / 10, 12, 'x2,4 sobre 5 MB');
  igual(val.fotosAQuitar(Array(8).fill(MB)), 0, '8 fotos de 1 MB = 19,2 MB: cabe');
  igual(val.fotosAQuitar(Array(10).fill(MB)), 2, '10 fotos de 1 MB = 24 MB: sobran 4 MB = 2 fotos');
  igual(val.fotosAQuitar(Array(35).fill(MB)), 27, '35 fotos de 1 MB = 84 MB');
  igual(val.fotosAQuitar([]), 0);
});

// Aparatos de prueba (inventados), con PK en los dos sentidos como en la lista real.
const APARATOS = [
  { nombre: 'S2 PRU 2', pkInicio: '100+250', pkFin: '100+430' },
  { nombre: 'S1 PRU 1', pkInicio: '100+820', pkFin: '100+640' },
  { nombre: 'AD V2 200+050', pkInicio: '200+010', pkFin: '200+090' },
  { nombre: 'Sobre el Barranco de Prueba E1 · 210+050', pkInicio: '210+010', pkFin: '210+090' },
];

prueba('varios aparatos: lista, PK, PDF y datos', async () => {
  igual(val.listaAparatos('S2 PRU 2, S1 PRU 1'), ['S2 PRU 2', 'S1 PRU 1']);
  igual(val.listaAparatos('S2 PRU 2'), ['S2 PRU 2'], 'los partes de antes, con uno');
  igual([val.listaAparatos(''), val.listaAparatos(null)], [[], []]);
  igual(val.unirAparatos([' S2 PRU 2 ', '', 'aguja 3']), 'S2 PRU 2, aguja 3', 'sin huecos');
  // Uno: sus PK tal cual (aunque vayan al revés). Varios: del más bajo al más alto.
  igual(val.pkDeAparatos(['S1 PRU 1'], APARATOS), { pkInicio: '100+820', pkFin: '100+640' });
  igual(val.pkDeAparatos(['S2 PRU 2', 'S1 PRU 1'], APARATOS), { pkInicio: '100+250', pkFin: '100+820' });
  igual(val.pkDeAparatos(['S1 PRU 1', 'AD V2 200+050'], APARATOS), { pkInicio: '100+640', pkFin: '200+090' });
  igual(val.pkDeAparatos(['aguja 3', 'S2 PRU 2'], APARATOS), { pkInicio: '100+250', pkFin: '100+430' }, 'los escritos a mano no cuentan');
  igual(val.pkDeAparatos(['aguja 3'], APARATOS), null);
  // PDF y Datos_ con dos aparatos.
  const p = ej.parteInfra();
  p.trabajos[0].aparato = 'S2 PRU 2, S1 PRU 1';
  const pdf = await generarPDF(p, ej.config, 'prueba', async () => jpeg());
  igual(await pdf.slice(0, 5).text(), '%PDF-');
  const e = await prepararEnvio(p, ej.config, async () => jpeg(), 'prueba');
  cierto((await e.archivos[1].text()).includes('"aparato": "S2 PRU 2, S1 PRU 1"'), 'datos con los dos aparatos');
});

prueba('validaciones: puestos, subtipos y horas extra', () => {
  igual(val.subtipoDe({}), 'via', 'parte de maquinaria antiguo, sin subtipo');
  igual(val.subtipoDe({ subtipo: 'dresina' }), 'dresina');
  igual(val.puestosDe({ subtipo: 'dresina' }).map((x) => x[0]), ['maquinista', 'amparo', 'piloto', 'omi', 'operario']);
  igual(val.puestosDe({}).map((x) => x[0]), ['encargado', 'maquinista', 'piloto', 'omi', 'operario']);
  const via = {}, loco = { subtipo: 'locomotora' }, dre = { subtipo: 'dresina' };
  igual([val.nombrePuesto(via, 'omi'), val.nombrePuesto(dre, 'amparo'), val.nombrePuesto(loco, 'responsable'), val.nombrePuesto(via, 'nada')],
    ['OMI', 'ET / al amparo de', 'Responsable de trabajos', 'Personal']);
  igual([val.nombrePuesto(via, 'maquinista'), val.nombrePuesto(loco, 'maquinista'), val.nombrePuesto(dre, 'maquinista')],
    ['Maquinista tipo A', 'Maquinista', 'Maquinista'], '«tipo A» solo en vía');
  // Puestos obligatorios según la EVB (entrega de vía bloqueada).
  igual([val.llevaEvb(via), val.llevaEvb(dre), val.llevaEvb(loco)], [true, true, false]);
  igual(val.puestosObligatorios({ evb: true }), ['encargado', 'omi']);
  igual(val.puestosObligatorios({ evb: false }), ['maquinista']);
  igual(val.puestosObligatorios({}), [], 'sin contestar la EVB');
  igual(val.puestosObligatorios({ subtipo: 'dresina', evb: true }), ['amparo', 'omi']);
  igual(val.puestosObligatorios({ subtipo: 'dresina', evb: false }), ['maquinista']);
  igual(val.puestosObligatorios({ subtipo: 'locomotora', evb: true }), ['maquinista'], 'la locomotora no cambia');
  igual(val.SUBTIPOS_MAQ.locomotora.prefijo, 'LOC');
  // Solo cuentan las personas que siguen en el parte y tienen horas.
  const p = { personal: [{ nombre: 'A' }, { nombre: 'B' }, { nombre: 'C' }],
    extras: [{ nombre: 'C', horas: 2 }, { nombre: 'B', horas: null }, { nombre: 'Z', horas: 3 }, { nombre: 'A', horas: 1 }] };
  igual(val.extrasDelParte(p).map((e) => e.nombre), ['A', 'C']);
  igual(val.extrasDelParte({}), []);
});

prueba('validaciones: trabajo de INFRA/SUPER', () => {
  const t = () => ej.parteInfra().trabajos[0];
  const con = (cambios) => Object.assign(t(), cambios);
  igual(val.faltasTrabajo(t()), [], 'trabajo completo');
  igual(val.faltasTrabajo(ej.parteInfra().trabajos[1]), [], 'sin vía y sin terminar, completo');
  igual(cortos(val.faltasTrabajo(con({ referencia: { tipo: '', codigo: '', motivo: '' } }))), ['referencia']);
  igual(val.faltasTrabajo(con({ referencia: { tipo: 'SIOS', codigo: ' ', motivo: '' } })),
    [{ corto: 'nº de SIOS', largo: 'falta el número de SIOS.' }]);
  igual(val.faltasTrabajo(con({ referencia: { tipo: 'INCIDENCIA', codigo: '', motivo: '' } })),
    [{ corto: 'nº de incidencia', largo: 'falta el número de incidencia.' }]);
  igual(val.faltasTrabajo(con({ referencia: { tipo: 'SIN_REF', codigo: '', motivo: '' } })),
    [{ corto: 'referencia escrita', largo: 'escribe la referencia (has elegido «Sin referencia»).' }]);
  igual(cortos(val.faltasTrabajo(con({ entradaVia: '8:3', salidaVia: '', via: '', pkInicio: '481', pkFin: '' }))),
    ['entrada en vía', 'salida de vía', 'vía', 'PK inicio', 'PK fin']);
  igual(val.faltasTrabajo(con({ sinVia: true, via: '', pkInicio: '', horaInicio: '', horaFin: '10:00' })),
    [{ corto: 'hora de inicio', largo: 'falta la hora de inicio.' }], 'sin ocupar la vía solo pide las horas');
  igual(cortos(val.faltasTrabajo(con({ linea: '', finalizado: null }))), ['línea', '¿finalizado?']);
  igual(val.faltasTrabajo(con({ motivoOtro: true, motivoActuacion: '' })),
    [{ corto: 'motivo', largo: 'has elegido «Otro» motivo de actuación: escríbelo.' }]);
  igual(val.faltasTrabajo(con({ motivoActuacion: ' ' })), [{ corto: 'motivo', largo: 'elige el motivo de actuación.' }]);
  igual(val.faltasTrabajo(con({ fotos: [] })), [
    { corto: 'foto de antes', largo: 'falta al menos una foto de ANTES.' },
    { corto: 'foto de después', largo: 'falta al menos una foto de DESPUÉS.' }]);
  const soloAntes = t().fotos.filter((f) => f.fase === 'antes');
  igual(val.faltasTrabajo(con({ finalizado: false, fotos: soloAntes })),
    [{ corto: 'foto de durante o después', largo: 'falta al menos una foto de DURANTE o de DESPUÉS.' }]);
});

prueba('validaciones: trabajo no realizado y sin fotos', () => {
  const t = () => ej.parteInfra().trabajos[0];
  const con = (cambios) => Object.assign(t(), cambios);
  const noReal = { finalizado: false, noRealizado: true, motivoNoRealizado: 'Lluvia / meteorología' };
  // No realizado: sin horas, vía, PK ni fotos, pero con motivo.
  igual(val.faltasTrabajo(con({ ...noReal, entradaVia: '', salidaVia: '', via: '', pkInicio: '', pkFin: '', fotos: [] })), [],
    'no realizado completo sin horas, PK ni fotos');
  igual(val.faltasTrabajo(con({ ...noReal, motivoNoRealizado: ' ' })),
    [{ corto: 'por qué no se ha realizado', largo: 'indica por qué no se ha realizado.' }]);
  igual(val.faltasTrabajo(con({ ...noReal, motivoNoRealizado: '', noRealizadoOtro: true })),
    [{ corto: 'por qué no se ha realizado', largo: 'has elegido «Otro» motivo de no realizado: escríbelo.' }]);
  igual(cortos(val.faltasTrabajo(con({ ...noReal, referencia: { tipo: '', codigo: '', motivo: '' }, linea: '', motivoActuacion: '' }))),
    ['referencia', 'línea', 'motivo'], 'sigue pidiendo referencia, línea y motivo de actuación');
  // Sin fotos: hace falta el motivo; el resto se sigue pidiendo.
  igual(val.faltasTrabajo(con({ fotos: [], sinFotos: true, motivoSinFotos: 'Sin luz suficiente' })), [], 'sin fotos con motivo');
  igual(val.faltasTrabajo(con({ fotos: [], sinFotos: true, motivoSinFotos: '' })),
    [{ corto: 'por qué no hay fotos', largo: 'indica por qué no se han podido hacer fotos.' }]);
  igual(val.faltasTrabajo(con({ fotos: [], sinFotos: true, motivoSinFotos: '', sinFotosOtro: true })),
    [{ corto: 'por qué no hay fotos', largo: 'has elegido «Otro» motivo para no hacer fotos: escríbelo.' }]);
  igual(cortos(val.faltasTrabajo(con({ fotos: [], sinFotos: true, motivoSinFotos: 'Sin luz suficiente', entradaVia: '' }))),
    ['entrada en vía'], 'sin fotos sigue pidiendo las horas');
  // Partes de antes de la 0.13.0 (sin los campos nuevos): igual que siempre.
  igual(cortos(val.faltasTrabajo(con({ fotos: [] }))), ['foto de antes', 'foto de después']);
  const p = infra();
  p.trabajos[0] = con({ ...noReal, fotos: [] });
  p.trabajos[1].sinFotos = true;
  p.trabajos[1].fotos = [];
  igual(msgs(val.validar(p)), ['Trabajo 2: indica por qué no se han podido hacer fotos.']);
});

prueba('validaciones: parte INFRA', () => {
  igual(val.validar(infra()), [], 'parte completo');
  const solo = (cambiar, esperado) => { const p = infra(); cambiar(p); igual(msgs(val.validar(p)), esperado); };
  solo((p) => { p.fecha = ''; }, ['Falta la fecha de la jornada.']);
  solo((p) => { p.personal = []; p.usaExtras = false; }, ['Añade al menos una persona en «Personal».']);
  solo((p) => { p.trabajos = []; }, ['Añade al menos un trabajo.']);
  solo((p) => { p.usaExtras = true; p.extras = []; }, ['Has marcado horas extra: pon las horas de quien las haya hecho (o marca «No»).']);
  solo((p) => { p.extras = [{ nombre: 'Pepe Nadie', horas: 2, tipo: 'normales' }]; },
    ['Has marcado horas extra: pon las horas de quien las haya hecho (o marca «No»).']);
  solo((p) => { p.extras[0].tipo = ''; }, ['Horas extra de Luis Ejemplo: elige si son normales, nocturnas o festivas.']);
  solo((p) => { p.usaExtras = false; p.extras = []; }, []);
  solo((p) => { p.usaMaquinaria = null; }, ['Indica si se ha usado maquinaria (Sí o No).']);
  solo((p) => { p.usaMaquinaria = true; p.maquinas = [{ descripcion: ' ', otro: true }]; },
    ['Has marcado que se ha usado maquinaria: elige cuál (o marca «No»).']);
  solo((p) => { p.usaVehiculos = null; }, ['Indica si se han usado vehículos (Sí o No).']);
  solo((p) => { p.vehiculos = []; }, ['Has marcado que se han usado vehículos: elige cuál (o marca «No»).']);
  solo((p) => { p.medidasOtrasSi = true; p.medidasOtras = ''; }, ['Has marcado «Otras» medidas antiincendios: escribe cuáles.']);
  solo((p) => { p.medidas = []; p.antiincendios = ''; }, ['Marca al menos una medida antiincendios.']);
  // Cada falta de un trabajo sale con su número y el enlace «Ir» a ese trabajo.
  const p = infra();
  p.trabajos[1].finalizado = null;
  p.trabajos[1].fotos = p.trabajos[1].fotos.filter((f) => f.fase === 'antes');
  igual(val.validar(p), [
    { msg: 'Trabajo 2: indica si está finalizado (Sí o No).', trabajo: 1 },
    { msg: 'Trabajo 2: falta al menos una foto de DESPUÉS.', trabajo: 1 }]);
});

prueba('validaciones: parte SUPER', () => {
  const sup = () => conExtras(ej.parteSuper());
  igual(val.validar(sup()), [], 'parte completo (con maquinaria y formato 1)');
  const p = sup();
  p.trabajos[0].referencia.codigo = '';
  p.maquinas = [];
  igual(msgs(val.validar(p)), ['Trabajo 1: falta el número de incidencia.',
    'Has marcado que se ha usado maquinaria: elige cuál (o marca «No»).']);
});

prueba('validaciones: tajo de maquinaria de vía', () => {
  const t = () => ej.parteMaqVia().tajos[0];
  const con = (cambiar) => { const x = t(); cambiar(x); return val.faltasTajo(x); };
  igual(val.faltasTajo(t()), [], 'tajo completo');
  igual(cortos(con((x) => { x.llegada = ''; x.inicio = '7'; x.fin = ''; x.salida = '24:00'; })),
    ['llegada a tajo', 'inicio de trabajo', 'fin de trabajo', 'salida de tajo']);
  igual(con((x) => { x.via = ''; }), [{ corto: 'vía', largo: 'elige al menos una vía.' }]);
  igual(con((x) => { x.pkFin = ''; }), [{ corto: 'PK final', largo: 'falta el PK final (km y metros).' }]);
  igual(con((x) => { x.nivelado.si = null; }), [{ corto: 'nivelado', largo: 'Nivelado: contesta Sí o No.' }]);
  igual(con((x) => { x.nivelado.modo = ''; }),
    [{ corto: 'método de nivelado', largo: 'Nivelado: elige Calculado, Manual o Visor.' }]);
  igual(con((x) => { x.nivelado.max = ''; x.nivelado.pk = ''; }), [
    { corto: 'Lev. máx.', largo: 'Nivelado calculado: falta el Lev. máx. (mm).' },
    { corto: 'PK del Lev. máx.', largo: 'Nivelado calculado: falta el PK del Lev. máx.' }]);
  igual(con((x) => { x.nivelado = { si: true, modo: 'manual', max: '', pk: '' }; }), [], 'manual no pide máximo');
  igual(cortos(con((x) => { x.alineado = { si: true, modo: 'calculado', max: '0', pk: '' }; })), ['Rip. máx.', 'PK del Rip. máx.']);
  igual(con((x) => { x.alineado = { si: true, modo: '', max: '', pk: '' }; }),
    [{ corto: 'método de alineado', largo: 'Alineado: elige Calculado, Auto o Visor.' }]);
  igual(con((x) => { x.estabilizado.programada = null; }),
    [{ corto: '¿programada?', largo: 'Estabilizado: indica si es programada (Sí o No).' }]);
  igual(con((x) => { x.registro.cuando = ''; }),
    [{ corto: 'registro antes/después', largo: 'Registro: elige Antes, Después o Ambos.' }]);
  igual(con((x) => { x.perfilado = { si: true, cepillado: null }; }),
    [{ corto: 'cepillado', largo: 'Perfilado: indica si hay cepillado (Sí o No).' }]);
  igual(cortos(con((x) => { x.estabilizado.si = null; x.registro.si = null; x.perfilado.si = null; x.alineado.si = null; })),
    ['alineado', 'estabilizado', 'registro', 'perfilado']);
});

prueba('validaciones: parte de maquinaria de vía', () => {
  igual(val.validarMaq(maqVia()), [], 'parte completo');
  const solo = (cambiar, esperado) => { const p = maqVia(); cambiar(p); igual(msgs(val.validarMaq(p)), esperado); };
  solo((p) => { p.fecha = ''; }, ['Falta la fecha de la jornada.']);
  solo((p) => { p.horaFin = ''; }, ['Falta el horario de la jornada (inicio y fin).']);
  solo((p) => { p.maquinasVia = [{ descripcion: '', uic: '', trabajo: '', horas: '', otro: false }]; }, ['Elige al menos una máquina.']);
  solo((p) => { p.maquinasVia = [{ descripcion: '', uic: '', trabajo: '', horas: '', otro: true }]; },
    ['Elige al menos una máquina.', 'Máquina 1: escribe cuál es.']);
  solo((p) => { p.maquinasVia[0].horas = '0'; }, ['Pon las horas de Bateadora prueba.']);
  solo((p) => { p.viaje.horaSalida = ''; }, ['Viaje: falta la hora de salida.']);
  solo((p) => { p.viaje.lugarSalida = ' '; }, ['Viaje: falta el lugar de salida.']);
  solo((p) => { p.viaje.horaLlegada = '6'; }, ['Viaje: falta la hora de llegada.']);
  solo((p) => { p.viaje.lugarLlegada = ''; }, ['Viaje: falta el lugar de llegada.']);
  solo((p) => { p.tajos = []; }, ['Añade al menos un tajo.']);
  solo((p) => { p.tajos[0].via = ''; p.tajos[0].nivelado.si = null; }, ['Tajo 1: elige al menos una vía.', 'Tajo 1: Nivelado: contesta Sí o No.']);
  solo((p) => { p.personal.push({ nombre: '', puesto: 'piloto', otro: true }); }, ['Piloto: escribe el nombre o quítalo.']);
  solo((p) => { p.personal.push({ nombre: '', puesto: 'maquinista', otro: true }); }, ['Maquinista tipo A: escribe el nombre o quítalo.']);
  // EVB: sin contestar (borradores antiguos), sin EVB hace falta el maquinista tipo A; con EVB, encargado y OMI.
  solo((p) => { delete p.evb; }, ['Indica si va en entrega de vía bloqueada (EVB).']);
  solo((p) => { p.evb = null; p.personal[1].puesto = 'piloto'; }, ['Indica si va en entrega de vía bloqueada (EVB).']);
  solo((p) => { p.personal[1].puesto = 'piloto'; },
    ['Sin EVB hace falta el maquinista tipo A (en «Personal»).']);
  solo((p) => { p.evb = true; }, ['Con EVB hace falta el OMI (en «Personal»).']);
  solo((p) => { p.evb = true; p.personal = [{ nombre: 'Luis Ejemplo', puesto: 'omi' }]; },
    ['Con EVB hace falta el encargado de trabajo (en «Personal»).']);
  solo((p) => { p.evb = true; p.personal = [{ nombre: 'Ana Prueba', puesto: 'encargado' }, { nombre: 'Luis Ejemplo', puesto: 'omi' }]; },
    [], 'con EVB el maquinista y el piloto son opcionales');
  solo((p) => { p.personal.push({ nombre: 'Eva Prueba', puesto: 'piloto' }); }, [], 'el piloto es opcional');
  solo((p) => { p.extras = []; }, ['Has marcado horas extra: pon las horas de quien las haya hecho (o marca «No»).']);
  solo((p) => { p.extras[0].tipo = ''; }, ['Horas extra de Luis Ejemplo: elige si son normales, nocturnas o festivas.']);
});

prueba('validaciones: trabajo realizado (locomotora y dresina)', () => {
  const r = () => ej.parteLoco().realizados[0];
  igual(val.faltasRealizado(r()), [], 'trabajo completo');
  igual(cortos(val.faltasRealizado({ via: '', pkInicio: '', pkFin: '', horaInicio: '', horaFin: '', trabajo: ' ', m3: '' })),
    ['vía', 'PK inicio', 'PK fin', 'hora inicio', 'hora fin', 'trabajo']);
  igual(val.faltasRealizado({ ...r(), pkFin: '300' }), [{ corto: 'PK fin', largo: 'falta el PK de fin (km y metros).' }]);
  igual(val.faltasRealizado({ ...r(), m3: '' }), [], 'los m³ son opcionales');
});

prueba('validaciones: parte de locomotora', () => {
  igual(val.validarLD(loco()), [], 'parte completo');
  const solo = (cambiar, esperado) => { const p = loco(); cambiar(p); igual(msgs(val.validarLD(p)), esperado); };
  solo((p) => { p.fecha = ''; }, ['Falta la fecha.']);
  solo((p) => { p.maquina.descripcion = ''; }, ['Escribe qué locomotora es.']);
  solo((p) => { p.acta = ' '; }, ['Falta el nº de acta.']);
  solo((p) => { p.personal[0].puesto = 'responsable'; }, ['Elige al maquinista (en «Personal»).']);
  solo((p) => { p.evb = true; p.personal[0].puesto = 'responsable'; }, ['Elige al maquinista (en «Personal»).'],
    'la locomotora no pregunta la EVB: el maquinista siempre es obligatorio');
  solo((p) => { p.personal.push({ nombre: '', puesto: 'maquinista', otro: true }); }, ['Maquinista: escribe el nombre o quítalo.']);
  solo((p) => { p.salida.hora = ''; }, ['Falta la hora de salida.']);
  solo((p) => { p.salida.lugar = ''; }, ['Falta el lugar de salida.']);
  solo((p) => { p.apartado.hora = '5'; }, ['Falta la hora de apartado.']);
  solo((p) => { p.apartado.lugar = ''; }, ['Falta el lugar de apartado.']);
  solo((p) => { p.vagones = [{ tipo: '', uic: '12', m3: '' }]; },
    ['Vagón 1: elige tolva o plataforma.', 'Vagón 1: pon los 4 últimos dígitos del UIC.']);
  solo((p) => { p.vagones[0].m3 = ''; }, ['Vagón 1: pon los m³ descargados.']);
  solo((p) => { p.vagones = [{ tipo: 'plataforma', uic: '0042', m3: '' }]; }, []);
  solo((p) => { p.vagones = [{ tipo: 'tolva', uic: '1234', m3: '50' }]; }, [], 'más de 35 m³ solo avisa en pantalla');
  solo((p) => { p.realizados = []; }, ['Añade al menos un trabajo realizado.']);
  solo((p) => { p.realizados[0].horaFin = '25:00'; p.realizados[0].trabajo = ''; },
    ['Trabajo 1: falta la hora de fin.', 'Trabajo 1: escribe el trabajo realizado.']);
  solo((p) => { p.combustible.llegada = ''; }, ['Falta el combustible de salida y de llegada.']);
  solo((p) => { p.km.salida = 'mil'; }, ['Faltan los kilómetros de salida y de llegada.']);
  solo((p) => { p.personal.push({ nombre: '', puesto: 'operario', otro: true }); }, ['Operario/s: escribe el nombre o quítalo.']);
  solo((p) => { p.extras[0].tipo = ''; }, ['Horas extra de Luis Ejemplo: elige si son normales, nocturnas o festivas.']);
});

prueba('validaciones: parte de dresina', () => {
  igual(val.validarLD(loco('dresina')), [], 'parte completo (sin vagones)');
  const solo = (cambiar, esperado) => { const p = loco('dresina'); cambiar(p); igual(msgs(val.validarLD(p)), esperado); };
  solo((p) => { p.personal[0].puesto = 'operario'; }, ['Sin EVB hace falta el maquinista (en «Personal»).']);
  solo((p) => { p.personal.push({ nombre: '', puesto: 'amparo', otro: true }); }, ['ET / al amparo de: escribe el nombre o quítalo.']);
  solo((p) => { p.personal.push({ nombre: '', puesto: 'maquinista', otro: true }); }, ['Maquinista: escribe el nombre o quítalo.'],
    'en la dresina es «Maquinista», sin «tipo A»');
  solo((p) => { p.personal.push({ nombre: '', puesto: 'omi', otro: true }); }, ['OMI: escribe el nombre o quítalo.']);
  // EVB: con EVB hacen falta «ET / al amparo de» (el encargado) y el OMI; el maquinista y el piloto, opcionales.
  solo((p) => { delete p.evb; }, ['Indica si va en entrega de vía bloqueada (EVB).']);
  solo((p) => { p.evb = true; },
    ['Con EVB hace falta el ET / al amparo de (en «Personal»).', 'Con EVB hace falta el OMI (en «Personal»).']);
  solo((p) => { p.evb = true; p.personal = [{ nombre: 'Ana Prueba', puesto: 'amparo' }, { nombre: 'Luis Ejemplo', puesto: 'omi' }]; }, []);
  solo((p) => { p.personal.push({ nombre: 'Eva Prueba', puesto: 'piloto' }); }, [], 'el piloto es opcional');
  solo((p) => { p.realizados[0].via = ''; }, ['Trabajo 1: elige al menos una vía.']);
  solo((p) => { p.acta = ''; p.combustible.salida = ''; }, ['Falta el nº de acta.', 'Falta el combustible de salida y de llegada.']);
  solo((p) => { p.maquina.descripcion = ''; }, ['Escribe qué dresina es.']);
});

// ---------- modelo (partes nuevos y borradores antiguos) ----------

prueba('modelo: apartados nuevos', () => {
  const t = modelo.nuevoTajo();
  cierto(t.id && t.id !== modelo.nuevoTajo().id, 'cada tajo con su id');
  igual(cortos(val.faltasTajo(t)).length, 12, 'un tajo nuevo está todo por rellenar');
  igual({ ...modelo.nuevoRealizado(), id: '' }, { id: '', via: '', pkInicio: '', pkFin: '', horaInicio: '', horaFin: '', trabajo: '', m3: '' });
  igual(modelo.nuevaMaquinaVia(), { descripcion: '', uic: '', trabajo: '', horas: '', otro: false });
  igual(modelo.persona({ nombre: ' Ana ', categoria: 'Oficial ', otro: 1 }),
    { nombre: 'Ana', empresa: '', habilitacion: '', categoria: 'Oficial', otro: true });
  igual(modelo.textoEquipo({ descripcion: 'Furgoneta', matricula: '0000-XXX' }), 'Furgoneta · 0000-XXX');
  igual(modelo.textoMedidas({ medidas: ['Batefuegos'], medidasOtrasSi: true, medidasOtras: ' Cuba ' }), 'Batefuegos; Otras: Cuba');
  igual(modelo.textoMedidas({ medidas: [], medidasOtrasSi: false, medidasOtras: 'Cuba' }), '');
});

prueba('modelo: borradores de versiones antiguas', () => {
  const viejo = { estado: 'borrador', usaMaquinaria: true, vehiculos: [{ descripcion: 'Furgoneta' }], antiincendios: 'Extintor' };
  modelo.normalizarParte(viejo);
  igual(viejo, {
    estado: 'borrador', usaMaquinaria: null, vehiculos: [{ descripcion: 'Furgoneta' }], antiincendios: 'Extintor',
    maquinas: [], usaVehiculos: true, extras: [], usaExtras: null, formato1: [],
    medidas: [], medidasOtras: 'Extintor', medidasOtrasSi: true,
  });
  const cerrado = { estado: 'cerrado', usaMaquinaria: true };
  modelo.normalizarParte(cerrado);
  igual(cerrado, { estado: 'cerrado', usaMaquinaria: true }, 'un parte cerrado no se toca');
  const actual = { ...ej.parteInfra(), estado: 'borrador' };
  const antes = JSON.stringify(actual);
  igual(JSON.stringify(modelo.normalizarParte(actual)), antes, 'un borrador actual no cambia');
});

prueba('modelo: último parte del mismo tipo', () => {
  const a = { ...ej.parteSuper(), ref: 'SUP-1', fecha: '2026-10-13' };
  const b = { ...ej.parteSuper(), ref: 'SUP-2', fecha: '2026-10-14', modificado: '2026-10-14T09:00:00+02:00' };
  const c = { ...ej.parteSuper(), ref: 'SUP-3', fecha: '2026-10-14', modificado: '2026-10-14T11:00:00+02:00' };
  const otro = { ...ej.parteInfra(), fecha: '2026-10-20' };
  igual(modelo.ultimoParteDe([a, c, otro, b], 'SUPER').ref, 'SUP-3', 'el de fecha más reciente y el último tocado');
  igual(modelo.ultimoParteDe([a, b], 'INFRA'), null, 'sin partes de ese tipo');
});

prueba('modelo: contador del móvil de cada prefijo', () => {
  igual(['INF', 'SUP', 'MAQ', 'LOC', 'DRE'].map(modelo.claveContador),
    ['contador-INFRA', 'contador-SUPER', 'contador-MAQUINARIA', 'contador-LOC', 'contador-DRE']);
});

prueba('modelo: qué se puede copiar del parte anterior', () => {
  const lista = modelo.MEDIDAS_PROVISIONALES;
  const previo = ej.parteSuper();
  previo.personal.push({ nombre: 'Eva Inventada' }, { nombre: 'Pau Ficticio' }, { nombre: 'Rosa Supuesta' });
  previo.medidasOtrasSi = true;
  previo.medidasOtras = 'Cuba';
  igual(modelo.apartadosCopiables(previo, 'Ana Prueba', lista), [
    { clave: 'personal', titulo: 'Personal', detalle: '4 persona(s): Luis Ejemplo, Eva Inventada, Pau Ficticio y 1 más' },
    { clave: 'maquinas', titulo: 'Maquinaria', detalle: 'Sí · Bateadora pequeña' },
    { clave: 'vehiculos', titulo: 'Vehículos', detalle: 'Sí · Furgoneta prueba · 0000-XXX' },
    { clave: 'medidas', titulo: 'Medidas antiincendios', detalle: '1 medida(s) · Otras: Cuba' },
  ]);
  // Solo el capataz, maquinaria sin contestar, vehículos «No» y medidas que ya no están en la lista.
  const flojo = { ...ej.parteInfra(), personal: [{ nombre: 'ANA PRUEBA' }], usaMaquinaria: null, usaVehiculos: false, medidas: ['Medida antigua'] };
  igual(modelo.apartadosCopiables(flojo, 'Ana Prueba', lista), [{ clave: 'vehiculos', titulo: 'Vehículos', detalle: 'No' }]);
  // Un parte de antes de v0.6.0 (sin maquinas) ni de v0.7.0 (sin medidas): nada de equipos ni medidas.
  igual(modelo.apartadosCopiables({ tipo: 'INFRA', personal: [], usaMaquinaria: true, vehiculos: [] }, 'Ana Prueba', lista), []);
});

prueba('modelo: repetir el parte anterior', () => {
  const lista = modelo.MEDIDAS_PROVISIONALES;
  const previo = ej.parteSuper();
  previo.medidas = ['Batefuegos', 'Medida antigua'];
  previo.medidasOtrasSi = true;
  previo.medidasOtras = 'Cuba';
  const antes = JSON.stringify(previo);
  const nuevo = {
    ...ej.parteSuper(), ref: 'SUP-9002', estado: 'borrador', fecha: '2026-10-15', nocturna: false,
    personal: [modelo.persona({ nombre: 'Ana Prueba', categoria: 'Capataz' })], trabajos: [], formato1: [],
    usaMaquinaria: null, maquinas: [], usaVehiculos: null, vehiculos: [], usaExtras: null, extras: [],
    medidas: [], medidasOtrasSi: false, medidasOtras: '', antiincendios: '', observaciones: '',
  };
  const nuevoAntes = JSON.stringify(nuevo);
  const p = modelo.repetirParte(nuevo, previo, ['personal', 'maquinas', 'vehiculos', 'medidas'], lista);
  igual(JSON.stringify(previo), antes, 'el anterior no cambia');
  igual(JSON.stringify(nuevo), nuevoAntes, 'el nuevo de partida no cambia');
  igual(p.personal.map((x) => x.nombre), ['Ana Prueba', 'Luis Ejemplo'], 'sin repetir al capataz');
  igual([p.usaMaquinaria, p.maquinas], [true, [{ descripcion: 'Bateadora pequeña', otro: false }]]);
  igual([p.usaVehiculos, p.vehiculos], [true, [{ descripcion: 'Furgoneta prueba', matricula: '0000-XXX', otro: false }]]);
  cierto(p.maquinas[0] !== previo.maquinas[0], 'las máquinas son una copia, no las mismas');
  igual([p.medidas, p.medidasOtrasSi, p.medidasOtras, p.antiincendios], [['Batefuegos'], true, 'Cuba', 'Batefuegos; Otras: Cuba']);
  // Lo que no se copia: sigue como en el parte nuevo.
  igual([p.ref, p.fecha, p.nocturna, p.trabajos, p.formato1, p.usaExtras, p.extras, p.observaciones],
    ['SUP-9002', '2026-10-15', false, [], [], null, [], ''], 'fecha, trabajos, extras, formato 1 y observaciones');
  // Solo lo marcado.
  const q = modelo.repetirParte(nuevo, previo, ['vehiculos'], lista);
  igual([q.personal.length, q.usaMaquinaria, q.usaVehiculos, q.medidas], [1, null, true, []]);
  // «No» se copia como «No», sin lista.
  const r = modelo.repetirParte(nuevo, { ...previo, usaMaquinaria: false, maquinas: [{ descripcion: 'x' }] }, ['maquinas'], lista);
  igual([r.usaMaquinaria, r.maquinas], [false, []]);
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

prueba('PDF y envío: trabajo no realizado y trabajo sin fotos', async () => {
  const p = ej.parteInfra();
  Object.assign(p.trabajos[0], { finalizado: false, noRealizado: true, motivoNoRealizado: 'Lluvia / meteorología', fotos: [] });
  Object.assign(p.trabajos[1], { sinFotos: true, motivoSinFotos: 'Prohibido fotografiar en la zona', fotos: [] });
  const leerFoto = async () => jpeg();
  const pdf = await generarPDF(p, ej.config, 'prueba', leerFoto);
  igual(await pdf.slice(0, 5).text(), '%PDF-', 'cabecera del PDF');
  const r = await prepararEnvio(p, ej.config, leerFoto, 'prueba');
  cierto(r.cuerpo.includes('[NO REALIZADO: Lluvia / meteorología]'), 'el correo dice que no se ha realizado');
  cierto(r.cuerpo.includes('AVISO: trabajos sin fotos: trabajo 2 (Prohibido fotografiar en la zona).'), 'aviso de sin fotos en el correo');
  const datos = JSON.parse(await r.archivos[1].text());
  igual(JSON.parse(await r.archivos[2].text()).fotos.length, 0, 'sin fotos en el adjunto');
  cierto(JSON.stringify(datos).includes('"noRealizado":true'), 'los datos llevan el campo nuevo');
});

prueba('jornada sin trabajos: solo pide el motivo y sale clara en el PDF y el correo', async () => {
  const vacia = (extra = {}) => ({ ...ej.parteInfra(), trabajos: [], formato1: [], medidas: [], antiincendios: '', usaMaquinaria: null, usaVehiculos: null, ...extra });
  // Sin marcarla, un parte sin trabajos sigue sin poder cerrarse.
  cierto(val.validar(vacia()).some((x) => x.msg === 'Añade al menos un trabajo.'), 'sin casilla pide trabajos');
  // Con la casilla, solo falta el motivo (no trabajos, maquinaria, vehículos ni medidas).
  igual(val.validar(vacia({ sinTrabajos: true })).map((x) => x.msg), ['Indica por qué no se ha podido trabajar.']);
  igual(val.validar(vacia({ sinTrabajos: true, sinTrabajosOtro: true })).map((x) => x.msg),
    ['Has elegido «Otro» motivo: escribe por qué no se ha podido trabajar.']);
  igual(val.validar(vacia({ sinTrabajos: true, motivoSinTrabajos: 'Lluvia / meteorología' })), [], 'con motivo, se puede cerrar');
  igual(val.validar(vacia({ sinTrabajos: true, motivoSinTrabajos: 'x', personal: [] })).map((x) => x.msg),
    ['Añade al menos una persona en «Personal».'], 'el personal sigue siendo obligatorio');
  igual(val.validar(vacia({ sinTrabajos: true, motivoSinTrabajos: 'x', fecha: '' })).length, 1, 'la fecha también');
  for (const tipo of ['INFRA', 'SUPER']) {
    const p = vacia({ tipo, sinTrabajos: true, motivoSinTrabajos: 'Avería de maquinaria o vehículos', observaciones: 'Bateadora averiada' });
    const leerFoto = async () => jpeg();
    igual(await (await generarPDF(p, ej.config, 'prueba', leerFoto)).slice(0, 5).text(), '%PDF-', `PDF ${tipo}`);
    const r = await prepararEnvio(p, ej.config, leerFoto, 'prueba');
    cierto(r.asunto.endsWith('· SIN TRABAJOS'), r.asunto);
    cierto(r.asunto.startsWith('PARTE LAV'), 'Power Automate lo sigue filtrando por el asunto');
    cierto(r.cuerpo.includes('JORNADA SIN TRABAJOS: Avería de maquinaria o vehículos.'), r.cuerpo);
    igual(JSON.parse(await r.archivos[2].text()).fotos.length, 0, 'sin fotos');
    cierto((await r.archivos[1].text()).includes('"sinTrabajos": true'), 'los datos llevan la marca');
  }
});

prueba('jornada sin trabajos en maquinaria (avería): vía, locomotora y dresina', async () => {
  const motivo = 'Avería de maquinaria o vehículos';
  const casos = [['vía', ej.parteMaqVia(), val.validarMaq], ['locomotora', ej.parteLoco(), val.validarLD], ['dresina', ej.parteLoco('dresina'), val.validarLD]];
  for (const [nombre, base, validarX] of casos) {
    const sin = (extra = {}) => ({ ...base, sinTrabajos: true, tajos: [], realizados: [], vagones: [], horaInicio: '', horaFin: '', acta: '', evb: null, ...extra });
    cierto(validarX({ ...sin(), sinTrabajos: false }).length > 0, `${nombre}: sin la casilla, un parte vacío no se puede cerrar`);
    igual(validarX(sin()).map((x) => x.msg), ['Indica por qué no se ha podido trabajar.'], `${nombre}: solo falta el motivo`);
    igual(validarX(sin({ motivoSinTrabajos: motivo })), [], `${nombre}: con motivo se puede cerrar`);
    igual(validarX(sin({ motivoSinTrabajos: motivo, fecha: '' })).length, 1, `${nombre}: la fecha sigue siendo obligatoria`);
    const p = sin({ motivoSinTrabajos: motivo, observaciones: 'Se rompió la bomba de gasoil' });
    const leerFoto = async () => jpeg();
    igual(await (await generarPDF(p, ej.config, 'prueba', leerFoto)).slice(0, 5).text(), '%PDF-', `${nombre}: PDF`);
    const r = await prepararEnvio(p, ej.config, leerFoto, 'prueba');
    cierto(r.asunto.endsWith('· SIN TRABAJOS') && r.asunto.startsWith('PARTE LAV'), `${nombre}: ${r.asunto}`);
    cierto(r.cuerpo.includes(`JORNADA SIN TRABAJOS: ${motivo}.`) && r.cuerpo.includes('Máquina:'), `${nombre}: ${r.cuerpo}`);
    const datos = JSON.parse(await r.archivos[1].text());
    cierto(datos.sinTrabajos === true && !(datos.tajos || []).length && !(datos.realizados || []).length, `${nombre}: los datos no llevan trabajos`);
  }
  // Un parte con trabajos apuntados antes de marcar la casilla no los manda.
  const viejo = { ...ej.parteInfra(), sinTrabajos: true, motivoSinTrabajos: 'Lluvia / meteorología' };
  const r = await prepararEnvio(viejo, ej.config, async () => jpeg(), 'prueba');
  igual(JSON.parse(await r.archivos[2].text()).fotos.length, 0, 'sin fotos de trabajos que ya no cuentan');
  igual(JSON.parse(await r.archivos[1].text()).trabajos, [], 'sin trabajos');
});

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

prueba('fotos antiguas: qué partes caducan y qué se quita al rectificar', () => {
  const ahora = new Date('2026-11-30T12:00:00+01:00');
  const enviado = (fecha, extra = {}) => ({ ...ej.parteInfra(), estado: 'enviado', envios: [{ fecha, recibido: fecha }], ...extra });
  cierto(modelo.fotosCaducadas(enviado('2026-10-30T10:00:00+01:00'), ahora), 'enviado hace 31 días');
  cierto(!modelo.fotosCaducadas(enviado('2026-11-01T10:00:00+01:00'), ahora), 'enviado hace 29 días');
  cierto(modelo.fotosCaducadas({ ...enviado(''), envios: ['2026-10-01T10:00:00+02:00'] }, ahora), 'envío por Gmail (fecha en texto)');
  for (const estadoP of ['borrador', 'cerrado', 'en-cola']) {
    cierto(!modelo.fotosCaducadas(enviado('2026-01-01T10:00:00+01:00', { estado: estadoP }), ahora), `${estadoP}: nunca`);
  }
  cierto(!modelo.fotosCaducadas(enviado('2026-01-01T10:00:00+01:00', { fotosBorradas: '2026-02-01T10:00:00+01:00' }), ahora), 'ya borradas');
  cierto(!modelo.fotosCaducadas(enviado('fecha rara'), ahora), 'fecha que no se entiende: no se borra');
  cierto(!modelo.fotosCaducadas({ ...enviado(''), envios: [] }, ahora), 'sin envíos: no se borra');
  // Rectificar: se quitan las fotos que ya no están; las que siguen, se quedan.
  const p = ej.parteSuper();
  p.formato1 = [{ id: 'fm1' }, { id: 'fm2' }];
  const todas = [...p.trabajos.flatMap((t) => t.fotos), ...p.formato1].length;
  igual(modelo.quitarFotosQueFaltan(p, new Set(['fm2'])), todas - 1);
  igual(p.trabajos.flatMap((t) => t.fotos).length, 0);
  igual(p.formato1, [{ id: 'fm2' }]);
  cierto(val.validar(p).length > 0, 'el parte rectificado sin fotos pide fotos nuevas');
});

prueba('emergencia: «Enviar por Gmail» solo tras más de 12 h en la cola', () => {
  const ahora = new Date('2026-11-30T12:00:00+01:00');
  const enCola = (fecha, extra = {}) => ({ ...ej.parteInfra(), estado: 'en-cola', enCola: fecha, ...extra });
  cierto(modelo.colaAtascada(enCola('2026-11-29T23:59:00+01:00'), ahora), '12 h y 1 min');
  cierto(!modelo.colaAtascada(enCola('2026-11-30T00:01:00+01:00'), ahora), '11 h y 59 min');
  cierto(!modelo.colaAtascada(enCola('2026-11-01T10:00:00+01:00', { estado: 'enviado' }), ahora), 'ya enviado: no');
  cierto(!modelo.colaAtascada(enCola('2026-11-01T10:00:00+01:00', { estado: 'cerrado' }), ahora), 'cerrado: no');
  cierto(!modelo.colaAtascada(enCola(undefined), ahora), 'en cola desde antes de la 0.19 (sin fecha): no');
  cierto(!modelo.colaAtascada(enCola('fecha rara'), ahora), 'fecha que no se entiende: no');
});

prueba('fotos antiguas: solo se borran las de partes enviados hace más de 30 días', async () => {
  const ahora = new Date('2026-11-30T12:00:00+01:00');
  const viejo = '2026-10-01T10:00:00+02:00';
  const casos = {
    enviadoViejo: { estado: 'enviado', envios: [{ fecha: viejo, recibido: viejo }] },
    enviadoReciente: { estado: 'enviado', envios: [{ fecha: '2026-11-20T10:00:00+01:00' }] },
    borrador: { estado: 'borrador', envios: [], creado: viejo },
    cerrado: { estado: 'cerrado', envios: [], cierre: viejo },
    enCola: { estado: 'en-cola', envios: [] },
    reenvioEnCola: { estado: 'enviado', envios: [{ fecha: viejo }] },   // enviado, pero vuelve a estar en la cola
  };
  const ids = {};
  for (const [k, extra] of Object.entries(casos)) {
    const p = { ...ej.parteInfra(), ...extra };
    ids[k] = p.id;
    await db.putParte(p);
    for (let n = 0; n < 3; n++) await db.putFoto({ id: crypto.randomUUID(), parteId: p.id, blob: await jpeg() });
  }
  const cola = [ids.enCola, ids.reenvioEnCola].map((parteId) => ({ id: crypto.randomUUID(), parteId, creado: viejo, datos: {} }));
  for (const x of cola) await db.putSalida(x);
  try {
    igual(await limpiarFotosAntiguas(ahora), { partes: 1, fotos: 3 });
    for (const [k, id] of Object.entries(ids)) {
      igual((await db.fotosDeParte(id)).length, k === 'enviadoViejo' ? 0 : 3, `fotos de ${k}`);
    }
    const g = await db.getParte(ids.enviadoViejo);
    cierto(g.fotosBorradas && g.trabajos.length === 2 && g.personal.length === 2, 'el parte se queda, con sus datos, y marcado');
    igual(await limpiarFotosAntiguas(ahora), { partes: 0, fotos: 0 }, 'la segunda vez no hace nada');
    // Sin fotos, el PDF sale igual (sin anexo).
    igual(await (await generarPDF(g, ej.config, 'prueba')).slice(0, 5).text(), '%PDF-');
  } finally {
    for (const x of cola) await db.borrarSalida(x.id);
    for (const id of Object.values(ids)) {
      for (const f of await db.fotosDeParte(id)) await db.borrarFoto(f.id);
      await db.borrarParte(id);
    }
  }
});

prueba('espacio usado en el Menú', () => {
  const MB = 1048576;
  igual(textoEspacio({ usage: 85 * MB, quota: 5000 * MB }), { poco: false, texto: 'Espacio usado: 85 MB' });
  const r = textoEspacio({ usage: 900 * MB, quota: 1100 * MB });
  cierto(r.poco && r.texto.includes('Queda poco sitio (200 MB)'), r.texto);
});

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

// sw.js no puede importar js/salida.js (script clásico): repite su lógica. Esta prueba carga el
// sw.js real y le hace lo mismo que a la app; si alguien cambia una cola y no la otra, falla.
prueba('cola: el service worker (sw.js) hace lo mismo que js/salida.js', () => conPerfil(async () => {
  const codigo = await fetch('../sw.js', { cache: 'no-store' }).then((r) => r.text());
  const sw = new Function('self', `${codigo}\nreturn { procesarSalida };`)({ addEventListener() {}, clients: {}, skipWaiting() {} });
  const urlAntes = await db.kvGet('servidorUrl');
  const fallosAntes = await db.kvGet('fallos');
  const setTimeoutReal = window.setTimeout;
  // Las esperas entre reintentos (2 a 5 s) pasan a 0 para no tardar; el tiempo máximo (240 s) no se toca.
  window.setTimeout = (f, ms, ...a) => setTimeoutReal(f, ms >= 2000 && ms <= 5000 ? 0 : ms, ...a);
  await db.kvSet('servidorUrl', SERVIDOR_URL);
  const caso = async (falso, procesar) => {
    const p = ej.parteInfra();
    await db.putParte(p);
    await db.putSalida({ id: crypto.randomUUID(), parteId: p.id, creado: '2026-10-14T10:00:00+02:00', datos: { asunto: 'x', archivos: [] } });
    await db.kvSet('fallos', []);
    let llamadas = 0;
    const cuenta = async (url, op) => { if (JSON.parse(op.body).accion === 'enviar') llamadas++; return falso(); };
    const r = await conFetch(cuenta, async () => {
      const salida = await procesar();
      await new Promise((ok) => setTimeoutReal(ok, 100));   // deja acabar el envío de fallos que lanza la app
      return salida;
    });
    const g = await db.getParte(p.id);
    const cola = await db.listarSalida();
    const visto = {
      r, llamadas, estado: g.estado, errorEnvio: g.errorEnvio, recibido: g.recibido,
      cola: cola.map((x) => [x.intentos, x.error]),
      fallos: (await db.kvGet('fallos')).map((f) => [f.tipo, f.mensaje]),
    };
    for (const x of cola) await db.borrarSalida(x.id);
    await db.borrarParte(p.id);
    return visto;
  };
  const casos = {
    'llega': () => respuesta({ ok: true, recibido: '2026-10-14T10:01:00+02:00' }),
    'rechazado': () => respuesta({ ok: false, error: 'Tu registro aún no está aprobado por la oficina.' }),
    'ocupado': () => respuesta({ ok: false, reintentar: true, error: 'El servidor está ocupado.' }),
    'sin conexión': () => { throw new TypeError('Failed to fetch'); },
  };
  try {
    for (const [nombre, falso] of Object.entries(casos)) {
      const app = await caso(falso, () => procesarSalida());
      const enSW = await caso(falso, () => sw.procesarSalida());
      igual(enSW, app, nombre);
    }
    igual((await caso(casos['sin conexión'], () => sw.procesarSalida())).llamadas, 5, '5 intentos');
  } finally {
    window.setTimeout = setTimeoutReal;
    await db.kvSet('servidorUrl', urlAntes);
    await db.kvSet('fallos', fallosAntes || []);
  }
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

/** Los 3 adjuntos que manda la app (PDF, Datos y Fotos), con 3 fotos y un formato 1. */
function adjuntosConFotos() {
  const b64 = btoa('foto');
  const datos = {
    ref: 'SUP-0007', rev: 1, fecha: '2026-10-15',
    trabajos: [
      { referencia: { tipo: 'SIOS', codigo: '12345' } },
      { referencia: { tipo: 'SIN_REF', motivo: 'Limpieza cuneta Ñ' } },
    ],
  };
  const fotos = [
    { archivo: 'T1_antes_1.jpg', trabajo: 1, fase: 'antes', base64: b64 },
    { archivo: 'T1_antes_2.jpg', trabajo: 1, fase: 'antes', base64: b64 },
    { archivo: 'T2_despues_1.jpg', trabajo: 2, fase: 'despues', base64: b64 },
    { archivo: 'Formato1_1.jpg', trabajo: 0, fase: 'formato', base64: b64 },
  ];
  return [
    { nombre: 'Parte_x.pdf', tipo: 'application/pdf', base64: btoa('%PDF-prueba') },
    { nombre: 'Datos_x.txt', tipo: 'text/plain', texto: JSON.stringify(datos) },
    { nombre: 'Fotos_x.txt', tipo: 'text/plain', texto: JSON.stringify({ formato: 'fotos-parte-lav', fotos }) },
  ];
}

prueba('servidor: sin copia configurada sale un solo correo, igual que siempre', async () => {
  const E = await servidorListo();
  E.post(E.parte({ archivos: adjuntosConFotos() }));
  igual(E.correos.length, 1);
  igual(E.correos[0].cc, undefined);
  igual(E.correos[0].attachments.map((b) => b.getName()), ['Parte_x.pdf', 'Datos_x.txt', 'Fotos_x.txt']);
});

prueba('servidor: copia aparte con PDF y fotos .jpg con nombre completo', async () => {
  const E = await servidorListo();
  E.hojas.Ajustes.appendRow(['copia', ' Otro@Ejemplo.test ; mal-escrito , tercero@ejemplo.test']);
  const r = E.post(E.parte({ archivos: adjuntosConFotos() }));
  igual(r.ok, true, r.error);
  igual(E.correos.length, 2, 'oficina + copia');
  const [oficina, copia] = E.correos;
  igual(oficina.to, 'oficina@ejemplo.test');
  igual(oficina.cc, undefined, 'el correo de la oficina no lleva CC');
  igual(oficina.attachments.map((b) => b.getName()), ['Parte_x.pdf', 'Datos_x.txt', 'Fotos_x.txt'], 'adjuntos de la oficina (Power Automate)');
  igual(copia.to, 'otro@ejemplo.test,tercero@ejemplo.test');
  igual(copia.attachments.map((b) => b.getName()), [
    'Parte_x.pdf',
    'SUP-0007_2026-10-15_T1_SIOS-12345_antes_1.jpg',
    'SUP-0007_2026-10-15_T1_SIOS-12345_antes_2.jpg',
    'SUP-0007_2026-10-15_T2_Limpieza_cuneta_N_despues_1.jpg',
    'SUP-0007_2026-10-15_Formato1_1.jpg',
  ]);
  cierto(copia.attachments.slice(1).every((b) => b.getContentType() === 'image/jpeg'), 'las fotos deben ir como image/jpeg');
  igual(JSON.parse(E.props.CORREOS).n, 3, 'cuenta 1 (oficina) + 2 (copia)');
});

prueba('servidor: si falla la copia, el parte sale igual y se apunta el error', async () => {
  const E = await servidorListo();
  E.hojas.Ajustes.appendRow(['copia', 'otro@ejemplo.test']);
  let n = 0;
  E.g.alEnviarCorreo = () => { if (++n === 2) throw new Error('fallo en la copia'); };
  const r = E.post(E.parte({ archivos: adjuntosConFotos() }));
  igual(r.ok, true, 'el parte no debe fallar por la copia');
  igual(E.hojas.Envios._d.length, 2, 'el parte queda apuntado en Envios');
  const err = E.hojas.Errores._d.at(-1);
  igual(err[4], 'copia');
  cierto(/fallo en la copia/.test(err[5]), 'mensaje del error');
});

prueba('servidor: un reintento no manda el correo dos veces', async () => {
  const E = await servidorListo();
  const p = E.parte();
  E.post(p);
  const r = E.post({ ...p, peticion: crypto.randomUUID() });
  igual(r.repetido, true);
  igual(E.correos.length, 1);
});

prueba('servidor: reintento horas después (sin caché) lo encuentra en Envios sin leerla entera', async () => {
  const E = await servidorListo();
  const p = E.parte();
  const r1 = E.post(p);
  for (const k of Object.keys(E.cache)) delete E.cache[k];   // la caché de Google ha caducado
  const lecturas = E.hojas.Envios._lecturas;
  const r2 = E.post({ ...p, peticion: crypto.randomUUID() });
  igual(r2.repetido, true, r2.error);
  igual(r2.recibido, r1.recibido, 'misma fecha de recepción');
  igual(E.correos.length, 1);
  igual(E.hojas.Envios._lecturas, lecturas, 'ha leído Envios entera para buscar un envío');
});

prueba('servidor: si falla el apunte en Envios, el reintento no manda el parte otra vez', async () => {
  const E = await servidorListo();
  E.post(E.parte({ ref: 'INF-0005' }));   // los últimos números ya guardados
  const normal = E.hojas.Envios.appendRow;
  E.hojas.Envios.appendRow = () => { throw new Error('Google no responde'); };
  const p = E.parte({ ref: 'INF-0006' });
  const r1 = E.post(p);
  igual(r1.ok, true, 'el correo salió: no puede dar error');
  igual(E.correos.length, 2);
  cierto(/INF-0006.*no está en Envios/.test(E.hojas.Errores._d.at(-1)[5]), 'aviso en Errores');
  E.hojas.Envios.appendRow = normal;
  const r2 = E.post({ ...p, peticion: crypto.randomUUID() });
  igual(r2.repetido, true, 'el reintento debe saber que ya salió');
  igual(E.correos.length, 2, 'no se manda dos veces');
  igual(E.post({ accion: 'config', token: E.token, peticion: crypto.randomUUID() }).ultimos, { INF: 6 }, 'el número 6 no se puede reutilizar');
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

prueba('servidor: PIN mal: a los 5 fallos se bloquea, y ya ni el PIN bueno entra', async () => {
  const E = await servidorListo();
  igual(E.post({ accion: 'pin', token: E.token, pin: '1234', peticion: crypto.randomUUID() }).ok, true, 'PIN de Ana');
  const entrar = (pin) => E.post({ accion: 'login', email: 'ana@ejemplo.test', pin, peticion: crypto.randomUUID() });
  for (let i = 0; i < 5; i++) igual(entrar('0000').error, 'PIN incorrecto.', `fallo ${i + 1}`);
  cierto(/Demasiados intentos/.test(entrar('1234').error), 'bloqueado aunque el PIN sea el bueno');
  E.hojas.Usuarios._d[1][6] = '0';   // pasa el tiempo de bloqueo (la fila 1 es Ana)
  const r = entrar('1234');
  igual(r.ok, true, r.error);
  cierto(Boolean(r.token), 'entra con el PIN bueno');
});

prueba('servidor: un parte que pesa más de 24 MB no sale y se puede reintentar sin él', async () => {
  const E = await servidorListo();
  const grande = { nombre: 'Fotos_x.txt', tipo: 'application/octet-stream', base64: btoa('x'.repeat(25 * 1024 * 1024)) };
  const p = E.parte({ archivos: [grande] });
  cierto(/pesa demasiado/.test(E.post(p).error), 'aviso de peso');
  igual(E.correos.length, 0, 'no sale ningún correo');
  igual(E.hojas.Envios._d.length, 1, 'no se apunta en Envios');
  const r = E.post(E.parte({ envioId: p.envioId }));   // mismo envío, ya sin las fotos de más
  igual(r.ok, true, r.error);
  igual(E.correos.length, 1, 'el reintento sale');
});

prueba('servidor: dar de baja con el enlace firmado y volver a activar', async () => {
  const E = await servidorListo();
  igual(E.post({ accion: 'pin', token: E.token, pin: '1234', peticion: crypto.randomUUID() }).ok, true, 'PIN de Ana');
  const url = E.s.enlaceRevision(' Ana@Ejemplo.test ');
  const firma = new URL(url).searchParams.get('firma');
  cierto(url.includes('accion=revisar') && firma, url);
  let error = '';
  try { E.s.revisarRegistro('ana@ejemplo.test', 'firma-falsa', 'rechazado'); } catch (e) { error = e.message; }
  igual(error, 'Enlace no válido.', 'firma falsa');
  try { E.s.enlaceRevision('nadie@ejemplo.test'); error = ''; } catch (e) { error = e.message; }
  cierto(/No hay ninguna cuenta/.test(error), 'correo que no existe');
  const todas = E.s.enlaceRevision();   // así la ejecuta el botón «Ejecutar» del editor
  cierto(todas.includes('Ana Prueba <ana@ejemplo.test> · activo') && todas.includes(firma), 'sin correo: todas las cuentas');
  cierto(todas.includes('Rechazado Prueba'), 'también las de baja');

  igual(E.s.revisarRegistro('ana@ejemplo.test', firma, 'rechazado'), 'rechazado');
  const pedir = (o) => E.post({ peticion: crypto.randomUUID(), ...o });
  cierto(/no está activa/.test(E.post(E.parte()).error), 'no puede enviar');
  cierto(/no está activa/.test(pedir({ accion: 'config', token: E.token }).error), 'no recibe la lista');
  cierto(/no está activa/.test(pedir({ accion: 'login', email: 'ana@ejemplo.test', pin: '1234' }).error), 'no puede entrar');
  igual(pedir({ accion: 'estado', token: E.token }).estado, 'rechazado', 'la app ve que está de baja');
  igual(E.correos.length, 0);

  igual(E.s.revisarRegistro('ana@ejemplo.test', firma, 'activo'), 'activo');
  igual(E.post(E.parte()).ok, true, 'reactivada: vuelve a enviar');
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

prueba('servidor: la lista trae el último número enviado de cada prefijo', async () => {
  const E = await servidorListo();
  E.post(E.parte({ ref: 'INF-0012' }));
  E.post(E.parte({ ref: 'INF-0003' }));
  E.post(E.parte({ ref: 'LOC-0002' }));
  E.hojas.Envios.appendRow(['x', 'otro@ejemplo.test', 'Otro', 'INF-0099', 'a', '1', 'f']);
  const r = E.post({ accion: 'config', token: E.token, peticion: crypto.randomUUID() });
  igual(r.ok, true, r.error);
  igual(r.ultimos, { INF: 12, LOC: 2 }, 'solo los de este capataz, el más alto');
});

prueba('servidor: los últimos números no leen la hoja Envios en cada config', async () => {
  const E = await servidorListo();
  E.post(E.parte({ ref: 'INF-0012' }));
  const config = () => E.post({ accion: 'config', token: E.token, peticion: crypto.randomUUID() });
  const antes = E.hojas.Envios._lecturas;
  igual(config().ultimos, { INF: 12 });
  igual(config().ultimos, { INF: 12 });
  igual(E.hojas.Envios._lecturas, antes, 'config ha leído Envios');
  E.post(E.parte({ ref: 'INF-0013' }));
  igual(config().ultimos, { INF: 13 }, 'se pone al día al enviar');
});

prueba('servidor: últimos números desde un servidor viejo (sin guardar) y rectificativos', async () => {
  const E = await servidorListo();
  // Envíos de antes del cambio: están en Envios pero no en las propiedades.
  E.hojas.Envios.appendRow(['v1', 'ana@ejemplo.test', 'Ana', 'INF-0040', 'a', '1', 'f']);
  E.hojas.Envios.appendRow(['v2', 'ANA@ejemplo.test', 'Ana', 'SUP-0007', 'a', '1', 'f']);
  // Rectificativo de un parte viejo: no puede dejar el número en 3.
  igual(E.post(E.parte({ ref: 'INF-0003' })).ok, true);
  const r = E.post({ accion: 'config', token: E.token, peticion: crypto.randomUUID() });
  igual(r.ultimos, { INF: 40, SUP: 7 });
  // Si se pierde lo guardado, se vuelve a calcular.
  delete E.props['ult:ana@ejemplo.test'];
  igual(E.post({ accion: 'config', token: E.token, peticion: crypto.randomUUID() }).ultimos, { INF: 40, SUP: 7 });
});

/** Registro hasta el paso del código: devuelve una función que pide buscarNombre con lo escrito. */
function registroConCodigo(E, email = 'nuevo@ejemplo.test') {
  E.hojas.Trabajadores.appendRow(['José Pérez Gil', 'UTE', '', '']);
  E.hojas.Trabajadores.appendRow(['José Martínez Gil', 'UTE', '', '']);
  E.hojas.Trabajadores.appendRow(['Ana Prueba', 'UTE', '', '']);
  igual(E.post({ accion: 'codigo', email, peticion: crypto.randomUUID() }).ok, true);
  const codigo = /(\d{6})/.exec(E.correos.at(-1).subject)[1];
  return { codigo, buscar: (texto) => E.post({ accion: 'buscarNombre', email, codigo, texto, peticion: crypto.randomUUID() }) };
}

prueba('servidor: el código ya no devuelve la lista de trabajadores', async () => {
  const E = await servidorListo();
  const { codigo } = registroConCodigo(E);
  const r = E.post({ accion: 'verificar', email: 'nuevo@ejemplo.test', codigo, peticion: crypto.randomUUID() });
  igual(r.ok, true, r.error);
  igual(r.nombres, [], 'la lista de nombres sale del servidor');
  cierto(!/José|Ana/.test(JSON.stringify(r)), 'hay nombres en la respuesta');
});

prueba('servidor: buscar el nombre al registrarse (tildes, orden, ambiguos, ya registrados)', async () => {
  const E = await servidorListo();
  const { codigo, buscar } = registroConCodigo(E);
  igual(buscar('perez jose').nombre, 'José Pérez Gil', 'sin tildes y en otro orden');
  igual(buscar('  JOSÉ   pérez  gil ').nombre, 'José Pérez Gil', 'mayúsculas y espacios');
  cierto(/más de una persona/.test(buscar('José Gil').error), 'dos José Gil');
  cierto(/al menos un apellido/.test(buscar('José').error), 'una sola palabra');
  cierto(/No te encontramos/.test(buscar('Jo Pe').error), 'trozos de palabra no valen');
  cierto(/ya tiene una cuenta/.test(buscar('Ana Prueba').error), 'Ana ya está registrada');
  cierto(/código/.test(E.post({ accion: 'buscarNombre', email: 'nuevo@ejemplo.test', codigo: '000000', texto: 'jose perez', peticion: crypto.randomUUID() }).error), 'código malo');
  // Con el nombre encontrado, el registro termina como siempre.
  const r = E.post({ accion: 'registro', email: 'nuevo@ejemplo.test', codigo, nombre: 'José Pérez Gil', pin: '1234', peticion: crypto.randomUUID() });
  igual(r.ok, true, r.error);
  igual(r.estado, 'pendiente');
});

prueba('servidor: no se puede sacar la lista probando nombres', async () => {
  const E = await servidorListo();
  const { buscar } = registroConCodigo(E);
  for (let i = 0; i < 9; i++) buscar('nadie ' + i);
  cierto(/No te encontramos/.test(buscar('nadie 9').error), 'el intento 10 aún vale');
  cierto(/Demasiados intentos/.test(buscar('jose perez').error), 'el 11 se corta, aunque sea bueno');
});

prueba('servidor: archivo anual de Envios (sin perder números ni duplicar partes)', async () => {
  const E = await servidorListo();
  const viejo = (id, ref, fecha) => E.hojas.Envios.appendRow([id, 'ana@ejemplo.test', 'Ana', ref, 'a', '1', fecha]);
  const idViejo = crypto.randomUUID();
  viejo(idViejo, 'INF-0099', '2024-03-01T08:00:00+01:00');
  viejo(crypto.randomUUID(), 'SUP-0050', '2024-05-01T08:00:00+02:00');
  viejo(crypto.randomUUID(), 'INF-0100', '2025-01-10T08:00:00+01:00');
  const p = E.parte({ ref: 'INF-0101' });
  E.post(p);   // envío de hoy: se queda en Envios
  delete E.props['ult:ana@ejemplo.test'];   // como en un servidor recién actualizado

  igual(E.s.archivarEnvios(), 3, 'archivados');
  igual(E.hojas.Envios._d.slice(1).map((f) => f[3]), ['INF-0101'], 'en Envios queda solo el de hoy');
  igual(E.hojas.EnviosArchivo._d[0][0], 'EnvioId', 'el archivo lleva cabecera');
  igual(E.hojas.EnviosArchivo._d.slice(1).map((f) => f[3]), ['INF-0099', 'SUP-0050', 'INF-0100']);
  igual(E.post({ accion: 'config', token: E.token, peticion: crypto.randomUUID() }).ultimos, { INF: 101, SUP: 50 }, 'los números viejos no se pierden');
  igual(E.s.archivarEnvios(), 0, 'segunda pasada');

  // Un reintento de un envío archivado tampoco se manda otra vez.
  for (const k of Object.keys(E.cache)) delete E.cache[k];
  const r = E.post(E.parte({ envioId: idViejo, ref: 'INF-0099' }));
  igual(r.repetido, true, r.error);
  igual(E.correos.length, 1, 'solo el envío de hoy');
});

prueba('servidor: cada petición abre la hoja una sola vez', async () => {
  // Un entorno simulado es una sola ejecución de Google: el libro se abre una vez (al preparar la
  // prueba) y ninguna petición más lo vuelve a abrir. Antes, config lo abría una vez por cada hoja.
  const E = await servidorListo();
  const antes = E.aperturas();
  igual(antes, 1, 'al preparar la prueba');
  const r = E.post({ accion: 'config', token: E.token, peticion: crypto.randomUUID() });
  igual(r.ok, true, r.error);
  igual(E.post(E.parte()).ok, true);
  igual(E.aperturas(), antes, 'config y enviar no deben volver a abrir el libro');
});

// ---------- pantallas (pruebas de humo) ----------
// La app de verdad, en un marco: se pinta cada pantalla con los partes de ejemplo y se comprueba
// que sale sin errores. Así salta cualquier función que falte o que no se importe al partir
// app.js en módulos. No se guarda nada ni se llama al servidor: solo se pinta (render).

let marco = null;

/** Carga index.html en un marco y coge su módulo estado.js (el mismo que usa la app). */
async function appEnMarco() {
  if (marco) return marco;
  const f = document.createElement('iframe');
  f.style.cssText = 'width:400px;height:700px;border:1px solid #ccc';
  const errores = [];
  await new Promise((res) => { f.onload = res; f.src = '../index.html'; document.body.append(f); });
  f.contentWindow.addEventListener('error', (e) => errores.push(e.message));
  f.contentWindow.addEventListener('unhandledrejection', (e) => errores.push(String(e.reason)));
  const inicio = Date.now();
  while (!(f.contentDocument.getElementById('app').innerHTML.length > 100)) {
    if (Date.now() - inicio > 10000) throw new Error('la app no arranca en el marco');
    await new Promise((r) => setTimeout(r, 100));
  }
  // Un script del propio marco: así el módulo es el mismo que usa la app, no una copia.
  const s = f.contentDocument.createElement('script');
  s.type = 'module';
  s.textContent = "import * as m from './js/estado.js'; import * as i from './js/vista-inicio.js'; window.moduloInicio = i; window.moduloEstado = m;";
  f.contentDocument.head.append(s);
  while (!f.contentWindow.moduloEstado) {
    if (Date.now() - inicio > 10000) throw new Error('no se puede cargar js/estado.js en el marco');
    await new Promise((r) => setTimeout(r, 50));
  }
  marco = { f, m: f.contentWindow.moduloEstado, errores };
  return marco;
}

const perfilEjemplo = () => ({ email: 'ana@ejemplo.test', capataz: 'Ana Prueba', token: 'prueba', cuenta: 'activo', pin: { salt: '', hash: '', iter: 1 } });
const borrador = (p) => ({ ...p, estado: 'borrador' });

/** Pinta una pantalla y comprueba que salen los textos esperados y ningún error. */
async function pantalla(preparar, ...esperados) {
  const { m, errores } = await appEnMarco();
  const { estado, render, app } = m;
  Object.assign(estado, {
    vista: 'inicio', config: ej.config, perfil: perfilEjemplo(), reg: {}, otros: [], lista: [], parte: null, trabajoIdx: null,
    busqueda: '', otroAbierto: false, errores: [], menu: false, eligeMaquina: false, fotoVista: null, procesando: '',
    envio: null, preguntaOtro: false, preguntaExtras: false, repetir: null, avisoCopia: '',
  });
  preparar(estado);
  render();
  await new Promise((r) => setTimeout(r, 100));   // miniaturas y lo que se pinta después
  if (errores.length) throw new Error(`errores en «${estado.vista}»: ${errores.splice(0).join(' | ')}`);
  const texto = app.textContent;
  for (const e of esperados) cierto(texto.includes(e), `en «${estado.vista}» falta el texto «${e}»`);
}

prueba('pantallas: registro, acceso y PIN', async () => {
  const reg = { email: 'ana@ejemplo.test', codigo: '123456', texto: 'ana prueba', nombre: 'Ana Prueba' };
  for (const vista of ['bienvenida', 'reg-email', 'reg-codigo', 'login', 'rec-email', 'rec-pin']) {
    await pantalla((e) => { e.vista = vista; e.perfil = null; e.reg = { ...reg }; });
  }
  await pantalla((e) => { e.vista = 'reg-nombre'; e.perfil = null; e.reg = { ...reg }; }, 'Tu nombre y apellidos', 'Buscarme');
  await pantalla((e) => { e.vista = 'reg-pin'; e.perfil = null; e.reg = { ...reg }; }, 'Ana Prueba', 'Si no eres tú');
  await pantalla((e) => { e.vista = 'pin'; }, 'Ana Prueba');
  for (const vista of ['setup-datos', 'setup-capataz', 'setup-pin']) await pantalla((e) => { e.vista = vista; e.perfil = null; });
});

prueba('pantallas: inicio, menú y elegir máquina', async () => {
  const lista = [borrador(ej.parteInfra()), ej.parteSuper(), { ...ej.parteMaqVia(), estado: 'en-cola' }, { ...ej.parteLoco(), estado: 'enviado' }];
  await pantalla((e) => { e.lista = lista; }, 'Partes LAV', 'INF-9001', 'SUP-9001', '🗑');
  await pantalla((e) => { e.lista = lista; e.menu = true; }, 'Guía rápida', 'Aspecto', 'Automático', 'Oscuro', 'Grande');
  await pantalla((e) => { e.lista = lista; e.menu = true; e.espacio = { poco: true, texto: 'Espacio usado: 900 MB. Queda poco sitio' }; }, 'Queda poco sitio');
  await pantalla((e) => { e.eligeMaquina = true; }, '¿Con qué máquina?', 'Bateadora 08-475-4S', 'Dresina');
  await pantalla((e) => { e.perfil.cuenta = 'pendiente'; }, 'pendiente de que lo apruebe');
});

prueba('pantallas: parte INFRA y SUPER', async () => {
  await pantalla((e) => { e.vista = 'parte'; e.parte = borrador(ej.parteInfra()); }, 'INF-9001', 'Maquinaria', 'Vehículos', 'Horas extra');
  await pantalla((e) => { e.vista = 'parte'; e.parte = borrador(ej.parteSuper()); }, 'SUP-9001', 'Jornada nocturna', 'Maquinaria');
  await pantalla((e) => { e.vista = 'parte'; e.parte = borrador(ej.parteInfra()); e.otroAbierto = true; e.busqueda = 'luis'; }, 'Persona que no está en la lista');
  await pantalla((e) => {
    e.vista = 'parte'; e.parte = borrador(ej.parteInfra()); e.parte.usaExtras = null; e.preguntaExtras = true;
  }, '¿Ha habido horas extra?', 'Sí, apuntarlas');
  await pantalla((e) => {
    e.vista = 'parte'; e.parte = borrador(ej.parteInfra()); e.parte.fecha = '';
    e.errores = [{ msg: 'Falta la fecha de la jornada.', trabajo: null }, { msg: 'Trabajo 1: falta la línea.', trabajo: 0 }];
  }, 'Falta por completar', 'Falta la fecha de la jornada.');
});

prueba('aspecto: tema y letra se guardan, se aplican y los valores raros se ignoran', () => {
  const antes = localStorage.getItem('partes-lav-aspecto');
  const raiz = document.createElement('div');   // una raíz de mentira: la prueba no cambia la página de pruebas
  try {
    localStorage.removeItem('partes-lav-aspecto');
    igual(leerAspecto(), { tema: 'auto', letra: 'normal' }, 'por defecto');
    guardarAspecto({ tema: 'oscuro' }, raiz);
    igual(raiz.dataset.tema, 'oscuro');
    igual(raiz.dataset.letra, undefined, 'la letra no se toca al cambiar el tema');
    guardarAspecto({ letra: 'grande' }, raiz);
    igual(leerAspecto(), { tema: 'oscuro', letra: 'grande' }, 'se recuerda cada ajuste');
    igual([raiz.dataset.tema, raiz.dataset.letra], ['oscuro', 'grande']);
    guardarAspecto({ tema: 'auto', letra: 'normal' }, raiz);
    igual([raiz.dataset.tema, raiz.dataset.letra], [undefined, undefined], 'auto y normal quitan los atributos');
    localStorage.setItem('partes-lav-aspecto', JSON.stringify({ tema: 'rosa', letra: 'enorme' }));
    igual(leerAspecto(), { tema: 'auto', letra: 'normal' }, 'valores raros: por defecto');
    localStorage.setItem('partes-lav-aspecto', '{no es json');
    igual(leerAspecto(), { tema: 'auto', letra: 'normal' }, 'dato roto: por defecto');
    aplicarAspecto({ tema: 'claro', letra: 'grande' }, raiz);
    igual([raiz.dataset.tema, raiz.dataset.letra], ['claro', 'grande']);
  } finally {
    if (antes == null) localStorage.removeItem('partes-lav-aspecto'); else localStorage.setItem('partes-lav-aspecto', antes);
  }
});

prueba('pantallas: jornada sin trabajos', async () => {
  await pantalla((e) => { e.vista = 'parte'; e.parte = borrador(ej.parteInfra()); }, 'Jornada sin trabajos', 'Trabajos');
  await pantalla((e) => {
    e.vista = 'parte'; e.parte = borrador(ej.parteSuper()); e.parte.sinTrabajos = true;
  }, '¿Por qué no se ha podido trabajar?', 'Con «Jornada sin trabajos» solo hace falta');
  await pantalla((e) => {
    e.vista = 'parte'; e.parte = borrador(ej.parteInfra()); e.parte.sinTrabajos = true; e.parte.sinTrabajosOtro = true;
    e.parte.motivoSinTrabajos = 'Se cayó la catenaria';
  }, '¿Por qué no se ha podido trabajar?', 'Otro (escribirlo)');
  await pantalla((e) => { e.lista = [{ ...borrador(ej.parteInfra()), sinTrabajos: true }]; }, 'Jornada sin trabajos');
  // Maquinaria: vía, locomotora y dresina lo llevan; con la casilla marcada no piden horario, viaje ni trabajos.
  for (const [parte, tipoRef] of [[ej.parteMaqVia(), 'MAQ-9001'], [ej.parteLoco(), 'LOC-9001'], [ej.parteLoco('dresina'), 'DRE-9001']]) {
    await pantalla((e) => { e.vista = 'parte'; e.parte = borrador(parte); }, tipoRef, 'Jornada sin trabajos');
    await pantalla((e) => { e.vista = 'parte'; e.parte = borrador(parte); e.parte.sinTrabajos = true; },
      '¿Por qué no se ha podido trabajar?', 'Con «Jornada sin trabajos» solo hace falta la fecha, la máquina y el motivo');
  }
});

prueba('pantallas: trabajo de INFRA', async () => {
  await pantalla((e) => { e.vista = 'trabajo'; e.parte = borrador(ej.parteInfra()); e.trabajoIdx = 0; }, 'Trabajo 1 · INF-9001');
  await pantalla((e) => { e.vista = 'trabajo'; e.parte = borrador(ej.parteInfra()); e.trabajoIdx = 1; e.preguntaOtro = true; }, '¿Has hecho otro trabajo en esta jornada?');
  await pantalla((e) => {
    e.vista = 'trabajo'; e.parte = borrador(ej.parteInfra()); e.trabajoIdx = 0;
    Object.assign(e.parte.trabajos[0], { finalizado: false, noRealizado: true, motivoNoRealizado: 'Falta de material' });
  }, 'No realizado', '¿Por qué no se ha realizado?', 'No hace falta poner horas de vía');
  await pantalla((e) => {
    e.vista = 'trabajo'; e.parte = borrador(ej.parteInfra()); e.trabajoIdx = 0;
    Object.assign(e.parte.trabajos[0], { sinFotos: true, motivoSinFotos: 'algo escrito', sinFotosOtro: true });
  }, 'No se han podido hacer fotos', 'Saldrá en rojo en el PDF');
  await pantalla((e) => {
    e.vista = 'parte'; e.parte = borrador(ej.parteInfra());
    Object.assign(e.parte.trabajos[0], { finalizado: false, noRealizado: true, motivoNoRealizado: 'Falta de material' });
    Object.assign(e.parte.trabajos[1], { sinFotos: true, motivoSinFotos: 'Sin luz suficiente' });
  }, 'No realizado · Falta de material', 'Sin fotos: Sin luz suficiente');
});

prueba('pantallas: varios aparatos en un trabajo', async () => {
  const conAparatos = (e, aparato) => {
    e.vista = 'trabajo'; e.config = { ...ej.config, aparatos: APARATOS }; e.parte = borrador(ej.parteInfra()); e.trabajoIdx = 0;
    Object.assign(e.parte.trabajos[0], { aparato, pkInicio: '', pkFin: '' });
  };
  await pantalla((e) => conAparatos(e, ''), '+ Añadir otro aparato', 'Sin aparato');
  await pantalla((e) => conAparatos(e, 'S2 PRU 2, aguja 3'), 'AD V2 200+050', 'PK del más bajo al más alto');
  {
    // Los de dilatación, con el nombre del viaducto o el antiguo «AD …», van juntos en su grupo.
    const { m } = await appEnMarco();
    const grupo = m.app.querySelector('select[data-aparato="0"] optgroup[label="Aparatos de dilatación"]');
    igual([...grupo.querySelectorAll('option')].map((o) => o.value), ['AD V2 200+050', 'Sobre el Barranco de Prueba E1 · 210+050']);
  }
  // Elegir, añadir otro, elegir y quitar, como lo haría el capataz.
  const { m } = await appEnMarco();
  const { app } = m;
  const t = m.estado.parte.trabajos[0];
  igual(t.filasAparato.map((f) => f.otro), [false, true], 'el escrito a mano sale como «Otro»');
  const elegir = (i, valor) => {
    const s = app.querySelector(`select[data-aparato="${i}"]`);
    s.value = valor;
    s.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pulsar = (sel) => app.querySelector(sel).click();
  pulsar('[data-action="quitar-aparato"][data-i="1"]');
  igual([t.aparato, t.pkInicio, t.pkFin], ['S2 PRU 2', '100+250', '100+430'], 'queda uno: sus PK');
  pulsar('[data-action="anadir-aparato"]');
  igual(t.aparato, 'S2 PRU 2', 'la fila vacía no cuenta');
  elegir(1, 'S1 PRU 1');
  igual([t.aparato, t.pkInicio, t.pkFin], ['S2 PRU 2, S1 PRU 1', '100+250', '100+820'], 'dos: del más bajo al más alto');
  elegir(1, '__otro');
  const inp = app.querySelector('input[data-aparato-txt="1"]');
  inp.value = 'aguja 3';
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  igual(t.aparato, 'S2 PRU 2, aguja 3', 'escrito a mano');
});

prueba('pantallas: maquinaria de vía, locomotora y dresina', async () => {
  await pantalla((e) => { e.vista = 'parte'; e.parte = borrador(ej.parteMaqVia()); }, 'MAQ-9001', 'Tajo 1', 'Viaje', 'Encargado de trabajo', 'entrega de vía bloqueada (EVB)');
  await pantalla((e) => { e.vista = 'parte'; e.parte = borrador(ej.parteLoco()); }, 'LOC-9001', 'Vagones', 'Trabajo realizado', 'Responsable de trabajos');
  await pantalla((e) => { e.vista = 'parte'; e.parte = borrador(ej.parteLoco('dresina')); }, 'DRE-9001', 'Telefonemas', 'ET / al amparo de', 'entrega de vía bloqueada (EVB)', 'OMI', 'Piloto');
});

prueba('pantallas: parte nuevo de los 5 tipos', async () => {
  const { f, m, errores } = await appEnMarco();
  const { nuevoParte } = f.contentWindow.moduloInicio;
  f.contentWindow.confirm = () => true;   // «Ya tienes un parte… ¿Quieres empezar otro?»
  const casos = [
    ['INFRA', null, 'INF-', 'Medidas antiincendios'], ['SUPER', null, 'SUP-', 'Jornada nocturna'],
    ['MAQUINARIA', { descripcion: 'Bateadora prueba', uic: '0', trabajo: 'Bateo', parte: 'via' }, 'MAQ-', 'Tajo 1'],
    ['MAQUINARIA', { descripcion: '', uic: '', parte: 'locomotora', otro: true }, 'LOC-', 'Vagones'],
    ['MAQUINARIA', { descripcion: 'Dresina prueba', uic: '0', trabajo: '', parte: 'dresina' }, 'DRE-', 'Telefonemas'],
  ];
  for (const [tipo, maquina, prefijo, texto] of casos) {
    Object.assign(m.estado, { config: ej.config, perfil: perfilEjemplo(), parte: null, vista: 'inicio', errores: [] });
    await nuevoParte(tipo, maquina);
    // Si ya hay un parte anterior del mismo tipo, pregunta si copiarlo: aquí, en blanco.
    if (m.estado.repetir) await f.contentWindow.moduloInicio.contestarRepetir(false);
    await new Promise((r) => setTimeout(r, 100));
    if (errores.length) throw new Error(`errores al crear ${prefijo}: ${errores.splice(0).join(' | ')}`);
    igual(m.estado.vista, 'parte', `${prefijo} abre el parte`);
    cierto(m.estado.parte.ref.startsWith(prefijo), `referencia ${m.estado.parte.ref}`);
    cierto(m.app.textContent.includes(texto), `en el parte ${prefijo} falta «${texto}»`);
  }
});

prueba('pantallas: parte nuevo igual que el anterior', async () => {
  const { f, m, errores } = await appEnMarco();
  const { nuevoParte, contestarRepetir } = f.contentWindow.moduloInicio;
  f.contentWindow.confirm = () => true;
  const previo = { ...ej.parteSuper(), id: crypto.randomUUID(), ref: 'SUP-8001', fecha: '2099-01-01' };   // el más reciente
  Object.assign(m.estado, { config: ej.config, perfil: perfilEjemplo(), parte: previo, vista: 'inicio', errores: [] });
  await m.guardarYa();
  m.estado.parte = null;
  try {
    await nuevoParte('SUPER');
    igual(m.estado.vista, 'inicio', 'antes de crear, pregunta');
    cierto(m.app.textContent.includes('¿Empezar igual que el último parte?') && m.app.textContent.includes('SUP-8001'), 'sale la hoja');
    cierto(m.app.textContent.includes('Luis Ejemplo'), 'dice a quién copia');
    // Desmarca vehículos y copia el resto.
    m.app.querySelector('[data-repetir="vehiculos"]').checked = false;
    await contestarRepetir(true);
    await new Promise((r) => setTimeout(r, 100));
    if (errores.length) throw new Error(errores.splice(0).join(' | '));
    const p = m.estado.parte;
    igual(m.estado.vista, 'parte');
    cierto(p.id !== previo.id && p.ref !== 'SUP-8001', 'es un parte nuevo');
    igual(p.personal.map((x) => x.nombre), ['Ana Prueba', 'Luis Ejemplo']);
    igual([p.usaMaquinaria, p.maquinas.length, p.usaVehiculos, p.medidas], [true, 1, null, ['Extintor en el vehículo']]);
    igual([p.trabajos.length, p.formato1.length, p.usaExtras], [0, 0, null], 'sin trabajos, formato 1 ni extras');
    cierto(m.app.textContent.includes('Copiado del SUP-8001'), 'aviso en el parte');
    // «No, empezar en blanco».
    await m.ir('inicio');
    await nuevoParte('SUPER');
    await contestarRepetir(false);
    igual(m.estado.parte.personal.length, 1, 'en blanco: solo el capataz');
    cierto(!m.app.textContent.includes('Copiado del'), 'sin aviso');
  } finally {
    const db = await import('../js/db.js');
    for (const p of await db.listarPartes()) if (p.fecha === '2099-01-01' || p.estado === 'borrador') await db.borrarParte(p.id);
  }
});

prueba('pantallas: envío', async () => {
  await pantalla((e) => { e.vista = 'envio'; e.parte = ej.parteInfra(); }, 'Cerrado · falta enviarlo');
  await pantalla((e) => { e.vista = 'envio'; e.parte = { ...ej.parteSuper(), estado: 'en-cola', errorEnvio: 'Sin cobertura' }; }, 'No se ha podido enviar');
  await pantalla((e) => { e.vista = 'envio'; e.parte = { ...ej.parteMaqVia(), estado: 'enviado', recibido: '2026-10-14T10:05:00+02:00' }; }, 'Recibido en la oficina');
  await pantalla((e) => { e.vista = 'envio'; e.perfil.token = ''; e.parte = ej.parteLoco('dresina'); }, 'Cómo enviarlo');
  const borradas = { ...ej.parteInfra(), estado: 'enviado', recibido: '2026-10-14T10:05:00+02:00', fotosBorradas: '2026-11-14T08:00:00+01:00' };
  await pantalla((e) => { e.vista = 'envio'; e.parte = borradas; }, 'Recibido en la oficina', 'Las fotos se borraron de este móvil', 'Corregir el parte');
  await pantalla((e) => { e.vista = 'envio'; e.perfil.token = ''; e.parte = borradas; e.envio = { listo: true }; }, 'Las fotos se borraron de este móvil');
  cierto(!marco.m.app.querySelector('[data-action="enviar"]') && marco.m.app.querySelector('[data-action="ver-pdf"]'),
    'sin fotos no se ofrece volver a mandarlo por Gmail, pero sí ver el PDF');
  marco.f.remove();
  marco = null;
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
