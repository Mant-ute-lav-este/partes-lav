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

prueba('validaciones: puestos, subtipos y horas extra', () => {
  igual(val.subtipoDe({}), 'via', 'parte de maquinaria antiguo, sin subtipo');
  igual(val.subtipoDe({ subtipo: 'dresina' }), 'dresina');
  igual(val.puestosDe({ subtipo: 'dresina' }).map((x) => x[0]), ['maquinista', 'amparo', 'operario']);
  igual(val.puestosDe({}).map((x) => x[0]), ['encargado', 'maquinista', 'piloto', 'omi', 'operario']);
  igual([val.nombrePuesto('omi'), val.nombrePuesto('amparo'), val.nombrePuesto('responsable'), val.nombrePuesto('nada')],
    ['OMI', 'ET / al amparo de', 'Responsable de trabajos', 'Personal']);
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
  igual(con((x) => { x.via = ''; }), [{ corto: 'vía', largo: 'elige la vía (1 o 2).' }]);
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
  solo((p) => { p.tajos[0].via = ''; p.tajos[0].nivelado.si = null; }, ['Tajo 1: elige la vía (1 o 2).', 'Tajo 1: Nivelado: contesta Sí o No.']);
  solo((p) => { p.personal.push({ nombre: '', puesto: 'piloto', otro: true }); }, ['Piloto: escribe el nombre o quítalo.']);
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
  solo((p) => { p.personal[0].puesto = 'operario'; }, ['Elige al maquinista (en «Personal»).']);
  solo((p) => { p.personal.push({ nombre: '', puesto: 'amparo', otro: true }); }, ['ET / al amparo de: escribe el nombre o quítalo.']);
  solo((p) => { p.realizados[0].via = ''; }, ['Trabajo 1: elige la vía (1 o 2).']);
  solo((p) => { p.acta = ''; p.combustible.salida = ''; }, ['Falta el nº de acta.', 'Falta el combustible de salida y de llegada.']);
  // Comportamiento actual: el texto habla de «locomotora» también en la dresina.
  solo((p) => { p.maquina.descripcion = ''; }, ['Escribe qué locomotora es.']);
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
