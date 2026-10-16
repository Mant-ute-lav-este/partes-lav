// Datos del parte: listas fijas, partes nuevos de cada apartado y arreglos de los partes
// guardados por versiones antiguas. Sin pantalla ni estado.

import { uuid } from './util.js';

export const FASES = [['antes', 'Antes'], ['durante', 'Durante'], ['despues', 'Después']];
export const PREFIJO_REF = { INFRA: 'INF', SUPER: 'SUP', MAQUINARIA: 'MAQ' };

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
