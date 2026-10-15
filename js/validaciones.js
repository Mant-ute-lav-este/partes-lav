// Validaciones de los partes y comprobaciones de los campos. Son funciones puras, sin pantalla
// ni estado, para poder probarlas solas (pruebas/pruebas.js).

export const horaValida = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));

export const pkValido = (s) => /^\s*\d+\s*[+.,/]\s*\d+\s*$/.test(String(s || ''));

export const numeroValido = (s) => /^\s*\d+([.,]\d+)?\s*$/.test(String(s == null ? '' : s));
export const aNumero = (s) => Number(String(s == null ? '' : s).replace(',', '.'));

export const textoBool = (v) => (v === true ? 'si' : v === false ? 'no' : '');
export const numeroOk = (s) => Number(String(s == null ? '' : s).replace(',', '.')) > 0;

/** Número de semana (ISO) de una fecha «AAAA-MM-DD». */
export function semanaIso(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia + 3);
  const primerJueves = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return String(1 + Math.round(((d - primerJueves) / 86400000 - 3 + ((primerJueves.getUTCDay() + 6) % 7)) / 7));
}

export const PUESTOS_MAQ = [
  ['encargado', 'Encargado de trabajo', false],
  ['maquinista', 'Maquinista tipo A', false],
  ['piloto', 'Piloto', false],
  ['omi', 'OMI', false],
  ['operario', 'Operario/s', true],   // el único puesto con varias personas
];
export const nombrePuesto = (clave) => ([...PUESTOS_MAQ, ...PUESTOS_LD.locomotora, ...PUESTOS_LD.dresina]
  .find((x) => x[0] === clave) || [, 'Personal'])[1];

// Puestos de cada parte: [clave, título, admite varias personas]
export const PUESTOS_LD = {
  locomotora: [['maquinista', 'Maquinista', false], ['responsable', 'Responsable de trabajos', false], ['operario', 'Operario/s', true]],
  dresina: [['maquinista', 'Maquinista', false], ['amparo', 'ET / al amparo de', false], ['operario', 'Operario/s', true]],
};
export const puestosDe = (p) => (subtipoDe(p) === 'via' ? PUESTOS_MAQ : PUESTOS_LD[subtipoDe(p)]);

export const SUBTIPOS_MAQ = {
  via: { prefijo: 'MAQ', titulo: 'Parte de maquinaria de vía' },
  locomotora: { prefijo: 'LOC', titulo: 'Parte de trabajos con locomotora' },
  dresina: { prefijo: 'DRE', titulo: 'Parte de trabajos con dresina' },
};
export const subtipoDe = (p) => p.subtipo || 'via';   // los primeros partes de maquinaria no lo llevan

/** Horas extra de las personas que siguen en el parte y tienen horas puestas. */
export function extrasDelParte(p) {
  return (p.personal || [])
    .map((x) => (p.extras || []).find((e) => e.nombre === x.nombre))
    .filter((e) => e && Number(e.horas) > 0);
}

/**
 * Lo que le falta a un trabajo para poder cerrar el parte: { corto } para la lista de trabajos
 * y { largo } para el aviso al cerrar. Fotos: antes y después; si el trabajo no está terminado,
 * basta con una de durante o de después.
 */
export function faltasTrabajo(t) {
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

export function validar(p) {
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

export function faltasTajo(t) {
  const e = [];
  const add = (corto, largo) => e.push({ corto, largo });
  [['llegada', 'llegada a tajo'], ['inicio', 'inicio de trabajo'], ['fin', 'fin de trabajo'], ['salida', 'salida de tajo']]
    .forEach(([k, txt]) => { if (!horaValida(t[k])) add(txt, `falta la hora de ${txt}.`); });
  if (!t.via) add('vía', 'elige la vía (1 o 2).');
  if (!pkValido(t.pkInicio)) add('PK inicio', 'falta el PK de inicio (km y metros).');
  if (!pkValido(t.pkFin)) add('PK final', 'falta el PK final (km y metros).');
  const op = (nombre, o, si) => {
    if (o.si == null) add(nombre.toLowerCase(), `${nombre}: contesta Sí o No.`);
    else if (o.si) si();
  };
  const geometria = (nombre, o, metodos, etqMax) => op(nombre, o, () => {
    if (!o.modo) add(`método de ${nombre.toLowerCase()}`, `${nombre}: elige ${metodos}.`);
    else if (o.modo === 'calculado') {
      if (!numeroOk(o.max)) add(etqMax, `${nombre} calculado: falta el ${etqMax} (mm).`);
      if (!pkValido(o.pk)) add(`PK del ${etqMax}`, `${nombre} calculado: falta el PK del ${etqMax.replace(/\.$/, '')}.`);
    }
  });
  geometria('Nivelado', t.nivelado, 'Calculado, Manual o Visor', 'Lev. máx.');
  geometria('Alineado', t.alineado, 'Calculado, Auto o Visor', 'Rip. máx.');
  op('Estabilizado', t.estabilizado, () => {
    if (t.estabilizado.programada == null) add('¿programada?', 'Estabilizado: indica si es programada (Sí o No).');
  });
  op('Registro', t.registro, () => {
    if (!t.registro.cuando) add('registro antes/después', 'Registro: elige Antes, Después o Ambos.');
  });
  op('Perfilado', t.perfilado, () => {
    if (t.perfilado.cepillado == null) add('cepillado', 'Perfilado: indica si hay cepillado (Sí o No).');
  });
  return e;
}

export function faltasRealizado(r) {
  const e = [];
  const add = (corto, largo) => e.push({ corto, largo });
  if (!r.via) add('vía', 'elige la vía (1 o 2).');
  if (!pkValido(r.pkInicio)) add('PK inicio', 'falta el PK de inicio (km y metros).');
  if (!pkValido(r.pkFin)) add('PK fin', 'falta el PK de fin (km y metros).');
  if (!horaValida(r.horaInicio)) add('hora inicio', 'falta la hora de inicio.');
  if (!horaValida(r.horaFin)) add('hora fin', 'falta la hora de fin.');
  if (!String(r.trabajo || '').trim()) add('trabajo', 'escribe el trabajo realizado.');
  return e;
}

export function validarMaq(p) {
  const e = [];
  const add = (msg) => e.push({ msg, trabajo: null });
  const vacio = (s) => !String(s == null ? '' : s).trim();
  if (!p.fecha) add('Falta la fecha de la jornada.');
  if (!horaValida(p.horaInicio) || !horaValida(p.horaFin)) add('Falta el horario de la jornada (inicio y fin).');
  const maquinas = p.maquinasVia.filter((m) => !vacio(m.descripcion));
  if (!maquinas.length) add('Elige al menos una máquina.');
  p.maquinasVia.forEach((m, i) => {
    if (m.otro && vacio(m.descripcion)) add(`Máquina ${i + 1}: escribe cuál es.`);
    else if (!vacio(m.descripcion) && !numeroOk(m.horas)) add(`Pon las horas de ${m.descripcion}.`);
  });
  const v = p.viaje;
  if (!horaValida(v.horaSalida)) add('Viaje: falta la hora de salida.');
  if (vacio(v.lugarSalida)) add('Viaje: falta el lugar de salida.');
  if (!horaValida(v.horaLlegada)) add('Viaje: falta la hora de llegada.');
  if (vacio(v.lugarLlegada)) add('Viaje: falta el lugar de llegada.');
  if (!p.tajos.length) add('Añade al menos un tajo.');
  p.tajos.forEach((t, i) => faltasTajo(t).forEach((f) => add(`Tajo ${i + 1}: ${f.largo}`)));
  p.personal.forEach((x) => { if (vacio(x.nombre)) add(`${nombrePuesto(x.puesto)}: escribe el nombre o quítalo.`); });
  if (p.usaExtras) {
    const hs = extrasDelParte(p);
    if (!hs.length) add('Has marcado horas extra: pon las horas de quien las haya hecho (o marca «No»).');
    hs.filter((x) => !x.tipo).forEach((x) => add(`Horas extra de ${x.nombre}: elige si son normales, nocturnas o festivas.`));
  }
  return e;
}

export function validarLD(p) {
  const e = [];
  const add = (msg) => e.push({ msg, trabajo: null });
  const vacio = (s) => !String(s == null ? '' : s).trim();
  const loco = subtipoDe(p) === 'locomotora';
  if (!p.fecha) add('Falta la fecha.');
  if (vacio(p.maquina.descripcion)) add('Escribe qué locomotora es.');
  if (vacio(p.acta)) add('Falta el nº de acta.');
  if (!p.personal.some((x) => x.puesto === 'maquinista' && !vacio(x.nombre))) add('Elige al maquinista (en «Personal»).');
  if (!horaValida(p.salida.hora)) add('Falta la hora de salida.');
  if (vacio(p.salida.lugar)) add('Falta el lugar de salida.');
  if (!horaValida(p.apartado.hora)) add('Falta la hora de apartado.');
  if (vacio(p.apartado.lugar)) add('Falta el lugar de apartado.');
  if (loco) {
    p.vagones.forEach((v, i) => {
      if (!v.tipo) add(`Vagón ${i + 1}: elige tolva o plataforma.`);
      if (!/^\d{4}$/.test(String(v.uic || '').trim())) add(`Vagón ${i + 1}: pon los 4 últimos dígitos del UIC.`);
      if (v.tipo === 'tolva' && !numeroValido(v.m3)) add(`Vagón ${i + 1}: pon los m³ descargados.`);
    });
  }
  if (!p.realizados.length) add('Añade al menos un trabajo realizado.');
  p.realizados.forEach((r, i) => faltasRealizado(r).forEach((f) => add(`Trabajo ${i + 1}: ${f.largo}`)));
  if (!numeroValido(p.combustible.salida) || !numeroValido(p.combustible.llegada)) add('Falta el combustible de salida y de llegada.');
  if (!numeroValido(p.km.salida) || !numeroValido(p.km.llegada)) add('Faltan los kilómetros de salida y de llegada.');
  p.personal.forEach((x) => { if (vacio(x.nombre)) add(`${nombrePuesto(x.puesto)}: escribe el nombre o quítalo.`); });
  if (p.usaExtras) {
    const hs = extrasDelParte(p);
    if (!hs.length) add('Has marcado horas extra: pon las horas de quien las haya hecho (o marca «No»).');
    hs.filter((x) => !x.tipo).forEach((x) => add(`Horas extra de ${x.nombre}: elige si son normales, nocturnas o festivas.`));
  }
  return e;
}
