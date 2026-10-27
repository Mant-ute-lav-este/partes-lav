// Datos del parte: listas fijas, partes nuevos de cada apartado y arreglos de los partes
// guardados por versiones antiguas. Sin pantalla ni estado.

import { uuid, normaliza } from './util.js';

export const FASES = [['antes', 'Antes'], ['durante', 'Durante'], ['despues', 'Después']];
export const PREFIJO_REF = { INFRA: 'INF', SUPER: 'SUP', MAQUINARIA: 'MAQ' };

/** Clave del contador del móvil para un prefijo: INF, SUP y MAQ van por tipo (como siempre); LOC y DRE, por prefijo. */
export function claveContador(prefijo) {
  const tipo = Object.keys(PREFIJO_REF).find((t) => PREFIJO_REF[t] === prefijo);
  return `contador-${tipo || prefijo}`;
}

/** Líneas que se ofrecen en botones, en Infra y en Super (las de la cabecera del PDF no cuentan aquí). */
export const LINEAS = ['040', '038'];

// Cada máquina abre su parte: «via» (tren de bateo: tajos con nivelado, alineado…),
// «locomotora» (vagones y balasto) o «dresina» (plataforma y telefonemas).
// Mientras la oficina no ponga las máquinas en la hoja («MaquinasVia»), se usan estas.
export const MAQUINAS_VIA_PROVISIONALES = [
  { descripcion: 'Bateadora 08-475-4S', uic: '99713011401-7', trabajo: 'Bateo', parte: 'via' },
  { descripcion: 'Perfiladora PDB-110', uic: '99713011302-7', trabajo: 'Perfilado', parte: 'via' },
  { descripcion: 'Estabilizador DGS-62N', uic: '97180150217-2', trabajo: 'Estabilizado', parte: 'via' },
  { descripcion: 'Dresina', uic: '99719231001-6', trabajo: '', parte: 'dresina' },
];

export const nuevaMaquinaVia = () => ({ descripcion: '', uic: '', trabajo: '', horas: '', otro: false });

export function nuevoTajo() {
  return {
    id: uuid(), llegada: '', inicio: '', fin: '', salida: '', via: '', pkInicio: '', pkFin: '', desvio: '',
    nivelado: { si: null, modo: '', max: '', pk: '' },
    alineado: { si: null, modo: '', max: '', pk: '' },
    estabilizado: { si: null, programada: null },
    registro: { si: null, cuando: '', texto: '' },
    perfilado: { si: null, cepillado: null },
  };
}

export const MODOS_NIVELADO = [['calculado', 'Calculado'], ['manual', 'Manual'], ['visor', 'Visor']];
export const MODOS_ALINEADO = [['calculado', 'Calculado'], ['auto', 'Auto'], ['visor', 'Visor']];
export const CUANDO_REGISTRO = [['antes', 'Antes'], ['despues', 'Después'], ['ambos', 'Ambos']];

export const nuevoRealizado = () => ({ id: uuid(), via: '', pkInicio: '', pkFin: '', horaInicio: '', horaFin: '', trabajo: '', m3: '' });

export const MAX_TOLVA = 35;   // m³ por tolva (en el papel: «35 / Tolva»)

export function persona(x) {
  return {
    nombre: (x.nombre || '').trim(),
    empresa: (x.empresa || '').trim(),
    habilitacion: (x.habilitacion || '').trim(),
    categoria: (x.categoria || '').trim(),
    otro: Boolean(x.otro),
  };
}

// Maquinaria y vehículos: dos secciones con Sí/No obligatorio y desplegables con la lista de la
// oficina, más la opción «Otra» para escribirla a mano.
export const EQUIPOS = {
  maquinas: {
    titulo: 'Maquinaria', pregunta: '¿Se ha usado maquinaria?', usa: 'usaMaquinaria',
    elegir: 'Elige la máquina…', otra: 'Otra (escribirla)', anadir: '+ Añadir otra máquina', conMatricula: false,
  },
  vehiculos: {
    titulo: 'Vehículos', pregunta: '¿Se han usado vehículos?', usa: 'usaVehiculos',
    elegir: 'Elige el vehículo…', otra: 'Otro (escribirlo)', anadir: '+ Añadir otro vehículo', conMatricula: true,
  },
};

export const textoEquipo = (x) => [x.descripcion, x.matricula].filter(Boolean).join(' · ');

// Trabajo que no se ha podido hacer, o sin fotos posibles: motivo de una lista fija (más «Otro»).
// Se guarda el texto del motivo; con «Otro», lo que escriba el capataz.
export const MOTIVOS_NO_REALIZADO = [
  'Lluvia / meteorología',
  'Sin corte de vía / sin autorización',
  'Falta de material',
  'Falta de personal o maquinaria',
];
export const MOTIVOS_SIN_FOTOS = [
  'Prohibido fotografiar en la zona',
  'Móvil sin batería / sin cámara',
  'Sin luz suficiente',
];

export const TIPOS_EXTRA =[['normales', 'Normales'], ['nocturnas', 'Nocturnas'], ['festivas', 'Festivas']];

// Medidas antiincendios: casillas con la lista de la oficina (varias a la vez) más «Otras».
// Mientras la oficina no ponga su lista en la hoja, se usa esta.
export const MEDIDAS_PROVISIONALES = [
  'Extintor en el vehículo',
  'Batefuegos',
  'Mochila extintora de agua',
  'Cuba o depósito de agua',
  'Zona de trabajo despejada de vegetación',
  'Vigilancia tras trabajos con riesgo de chispas',
  'Revisión de la zona al terminar',
];

/** Texto de las medidas para el PDF y los datos: «Extintor en el vehículo; Batefuegos; Otras: …». */
export function textoMedidas(p) {
  const otras = p.medidasOtrasSi && (p.medidasOtras || '').trim();
  return [...p.medidas, otras && `Otras: ${otras}`].filter(Boolean).join('; ');
}

/**
 * Borradores de antes de separar maquinaria y vehículos (v0.5.0 y anteriores): lo apuntado
 * queda como vehículos y se vuelve a preguntar por la maquinaria. Los partes ya cerrados no se
 * tocan: su PDF sale con la tabla única de antes.
 */
export function normalizarParte(p) {
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
  if (!p.formato1) p.formato1 = [];
  // Antes de v0.7.0 las medidas antiincendios eran texto libre: pasa a «Otras».
  if (!p.medidas) {
    p.medidas = [];
    p.medidasOtras = p.antiincendios || '';
    p.medidasOtrasSi = Boolean(p.medidasOtras.trim());
  }
  return p;
}

// ---------- Repetir el parte anterior ----------
// Al crear un INFRA o un SUPER se ofrece empezar igual que el último del mismo tipo: personal,
// maquinaria, vehículos y medidas antiincendios. Trabajos, horas extra, fotos, formato 1 y
// observaciones no se copian; la fecha y la jornada nocturna salen como en un parte nuevo.

/** Último parte del tipo dado: el de fecha más reciente y, a igual fecha, el último tocado. */
export function ultimoParteDe(partes, tipo) {
  return partes
    .filter((x) => x.tipo === tipo)
    .sort((a, b) => `${b.fecha}${b.modificado}`.localeCompare(`${a.fecha}${a.modificado}`))[0] || null;
}

const nombres = (ps) => {
  const n = ps.map((x) => x.nombre);
  return n.length > 3 ? `${n.slice(0, 3).join(', ')} y ${n.length - 3} más` : n.join(', ');
};
const textoUsa = (usa, xs) => (usa ? `Sí · ${xs.map(textoEquipo).filter(Boolean).join(', ') || 'sin elegir'}` : 'No');

/**
 * Apartados del parte anterior que se pueden copiar, para la hoja «¿Empezar igual…?».
 * Solo salen los que tienen algo: sin ninguno, no hace falta preguntar.
 * @param {object} previo parte anterior
 * @param {string} capataz el capataz no cuenta: ya va en el parte nuevo
 * @param {string[]} medidasLista medidas de la lista de la oficina (las que ya no estén no se copian)
 * @returns {{clave: string, titulo: string, detalle: string}[]}
 */
export function apartadosCopiables(previo, capataz, medidasLista) {
  const r = [];
  const ya = normaliza(capataz);
  const gente = (previo.personal || []).filter((x) => x.nombre && normaliza(x.nombre) !== ya);
  if (gente.length) r.push({ clave: 'personal', titulo: 'Personal', detalle: `${gente.length} persona(s): ${nombres(gente)}` });
  // Los partes de antes de v0.6.0 no separaban maquinaria y vehículos: no se copian.
  if (Array.isArray(previo.maquinas)) {
    if (previo.usaMaquinaria != null) r.push({ clave: 'maquinas', titulo: 'Maquinaria', detalle: textoUsa(previo.usaMaquinaria, previo.maquinas) });
    if (previo.usaVehiculos != null) r.push({ clave: 'vehiculos', titulo: 'Vehículos', detalle: textoUsa(previo.usaVehiculos, previo.vehiculos || []) });
  }
  const medidas = (previo.medidas || []).filter((m) => medidasLista.includes(m));
  const otras = previo.medidasOtrasSi && (previo.medidasOtras || '').trim();
  if (medidas.length || otras) {
    r.push({ clave: 'medidas', titulo: 'Medidas antiincendios', detalle: [medidas.length && `${medidas.length} medida(s)`, otras && `Otras: ${otras}`].filter(Boolean).join(' · ') });
  }
  return r;
}

/**
 * Parte nuevo con los apartados elegidos copiados del anterior. No cambia ni el nuevo ni el
 * anterior: devuelve uno nuevo.
 * @param {object} nuevo parte recién creado (con el capataz en el personal)
 * @param {object} previo parte anterior
 * @param {string[]} claves apartados que copiar: personal, maquinas, vehiculos, medidas
 * @param {string[]} medidasLista medidas de la lista de la oficina
 */
export function repetirParte(nuevo, previo, claves, medidasLista) {
  const p = structuredClone(nuevo);
  const copia = (xs) => (xs || []).map((x) => ({ ...x }));
  if (claves.includes('personal')) {
    const ya = new Set(p.personal.map((x) => normaliza(x.nombre)));
    for (const x of previo.personal || []) {
      if (x.nombre && !ya.has(normaliza(x.nombre))) { p.personal.push(persona(x)); ya.add(normaliza(x.nombre)); }
    }
  }
  if (Array.isArray(previo.maquinas)) {
    if (claves.includes('maquinas') && previo.usaMaquinaria != null) {
      p.usaMaquinaria = previo.usaMaquinaria;
      p.maquinas = previo.usaMaquinaria ? copia(previo.maquinas) : [];
    }
    if (claves.includes('vehiculos') && previo.usaVehiculos != null) {
      p.usaVehiculos = previo.usaVehiculos;
      p.vehiculos = previo.usaVehiculos ? copia(previo.vehiculos) : [];
    }
  }
  if (claves.includes('medidas')) {
    p.medidas = (previo.medidas || []).filter((m) => medidasLista.includes(m));
    p.medidasOtrasSi = Boolean(previo.medidasOtrasSi && (previo.medidasOtras || '').trim());
    p.medidasOtras = p.medidasOtrasSi ? previo.medidasOtras : '';
    p.antiincendios = textoMedidas(p);
  }
  return p;
}

// ---------- Fotos de partes ya enviados ----------
// Las fotos ocupan casi todo el espacio del móvil. Cuando un parte lleva tiempo en la oficina, se
// borran del móvil (allí están las originales) y se quedan los datos, para repetir o rectificar.

export const DIAS_FOTOS = 30;

/** Fecha (ISO, la del móvil) del último envío del parte; '' si no tiene. */
export function fechaEnvio(p) {
  const x = (p.envios || [])[(p.envios || []).length - 1];
  return typeof x === 'string' ? x : (x && x.fecha) || '';
}

/**
 * ¿Hay que borrar ya las fotos de este parte? Solo de partes enviados hace más de «dias» días.
 * Borradores, cerrados y en cola nunca; tampoco si la fecha del envío no se entiende.
 */
export function fotosCaducadas(p, ahora = new Date(), dias = DIAS_FOTOS) {
  if (!p || p.estado !== 'enviado' || p.fotosBorradas) return false;
  const t = Date.parse(fechaEnvio(p));
  return Number.isFinite(t) && ahora.getTime() - t > dias * 86400000;
}

/** Al rectificar: quita las fotos que ya no están en el móvil, para que la app pida fotos nuevas. */
export function quitarFotosQueFaltan(p, existe) {
  let quitadas = 0;
  for (const t of p.trabajos || []) {
    const antes = (t.fotos || []).length;
    t.fotos = (t.fotos || []).filter((f) => existe.has(f.id));
    quitadas += antes - t.fotos.length;
  }
  const antes = (p.formato1 || []).length;
  p.formato1 = (p.formato1 || []).filter((f) => existe.has(f.id));
  return quitadas + antes - p.formato1.length;
}
