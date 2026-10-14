// Partes de ejemplo para las pruebas. Nombres y datos INVENTADOS: el repositorio es público.

export const config = {
  nombre: 'Lista de prueba', fecha: '2026-10-14',
  destinatario: 'oficina@ejemplo.test',
  cabecera: { jefatura: 'JEFATURA PRUEBA', ambito: 'Base prueba', empresa: 'Empresa prueba', lineaInfra: 'L040 - L038', lineaSuper: 'L040 - L038' },
  trabajadores: [
    { nombre: 'Ana Prueba', empresa: 'E1', habilitacion: 'H1', categoria: 'Capataz' },
    { nombre: 'Luis Ejemplo', empresa: 'E1', habilitacion: '', categoria: 'Oficial' },
  ],
};

const persona = (nombre, extra = {}) => ({ nombre, empresa: 'E1', habilitacion: '', categoria: 'Oficial', otro: false, ...extra });

const foto = (id, fase, origen = 'camara') => ({
  id, fase, origen, etiqueta: 'prueba', fechaFoto: '2026-10-14T09:00:00+02:00',
  fuenteFecha: origen === 'galeria' ? 'archivo' : 'camara', ancho: 64, alto: 48, anadida: '2026-10-14T09:00:00+02:00',
});

const base = (tipo, ref) => ({
  formato: 'parte-lav', version: 1, id: crypto.randomUUID(), ref, rev: 1, rectificaA: null,
  tipo, fecha: '2026-10-14', nocturna: false, capataz: 'Ana Prueba',
  personal: [persona('Ana Prueba', { categoria: 'Capataz' }), persona('Luis Ejemplo')],
  trabajos: [], formato1: [], usaMaquinaria: false, maquinas: [], usaVehiculos: true,
  vehiculos: [{ descripcion: 'Furgoneta prueba', matricula: '0000-XXX', otro: false }],
  usaExtras: true, extras: [{ nombre: 'Luis Ejemplo', horas: '1,5', tipo: 'normales', motivo: 'prueba' }],
  medidas: ['Extintor en el vehículo'], medidasOtrasSi: false, medidasOtras: '', antiincendios: 'Extintor en el vehículo',
  observaciones: 'Parte de prueba automática.', estado: 'cerrado',
  creado: '2026-10-14T08:00:00+02:00', modificado: '2026-10-14T10:00:00+02:00', cierre: '2026-10-14T10:00:00+02:00',
  envios: [], app: { version: 'prueba' },
});

const trabajo = (n, extra = {}) => ({
  id: crypto.randomUUID(), referencia: { tipo: 'SIOS', codigo: `S-${n}`, motivo: '' }, tipoCoste: '', pidame: `P${n}`,
  sinVia: false, telefonema: { numero: '11', salida: '12' }, entradaVia: '08:00', salidaVia: '09:30', horaInicio: '', horaFin: '',
  linea: '040', via: '1', aparato: '', pkInicio: '481+045', pkFin: '481+300', metrosLineales: null,
  motivoActuacion: 'Revisión', finalizado: true, descripcion: 'Trabajo de prueba', fotos: [], ...extra,
});

export function parteInfra() {
  const p = base('INFRA', 'INF-9001');
  p.trabajos = [
    trabajo(1, { tipoCoste: 'RREE', fotos: [foto('f1', 'antes'), foto('f2', 'despues', 'galeria')] }),
    trabajo(2, { referencia: { tipo: 'SIN_REF', codigo: '', motivo: 'Limpieza de cuneta' }, sinVia: true, horaInicio: '10:00', horaFin: '11:00', fotos: [foto('f3', 'antes'), foto('f4', 'durante')], finalizado: false }),
  ];
  return p;
}

export function parteSuper() {
  const p = base('SUPER', 'SUP-9001');
  p.nocturna = true;
  p.usaMaquinaria = true;
  p.maquinas = [{ descripcion: 'Bateadora pequeña', otro: false }];
  p.trabajos = [trabajo(1, { referencia: { tipo: 'INCIDENCIA', codigo: 'I-1', motivo: '' }, fotos: [foto('f5', 'antes'), foto('f6', 'despues')] })];
  p.formato1 = [{ ...foto('f7', 'formato'), etiqueta: 'FORMATO 1' }];
  return p;
}

export function parteMaqVia() {
  const p = base('MAQUINARIA', 'MAQ-9001');
  Object.assign(p, {
    subtipo: 'via', personal: [persona('Ana Prueba', { puesto: 'encargado' }), persona('Luis Ejemplo', { puesto: 'maquinista' })],
    horaInicio: '22:00', horaFin: '06:00',
    maquinasVia: [{ descripcion: 'Bateadora prueba', uic: '00000000000-0', trabajo: 'Bateo', horas: '6', otro: false }],
    viaje: { horaSalida: '21:00', lugarSalida: 'Base', horaLlegada: '06:30', lugarLlegada: 'Base' },
    tajos: [{
      id: 't1', llegada: '22:30', inicio: '23:00', fin: '05:00', salida: '05:30', via: '1', pkInicio: '300+000', pkFin: '301+000', desvio: '',
      nivelado: { si: true, modo: 'calculado', max: '20', pk: '300+500' }, alineado: { si: false, modo: '', max: '', pk: '' },
      estabilizado: { si: true, programada: true }, registro: { si: true, cuando: 'ambos', texto: '' }, perfilado: { si: false, cepillado: null },
    }],
  });
  return p;
}

export function parteLoco(subtipo = 'locomotora') {
  const p = base('MAQUINARIA', subtipo === 'locomotora' ? 'LOC-9001' : 'DRE-9001');
  Object.assign(p, {
    subtipo, personal: [persona('Ana Prueba', { puesto: 'maquinista' }), persona('Luis Ejemplo', { puesto: 'operario' })],
    maquina: { descripcion: subtipo === 'locomotora' ? 'Locomotora prueba' : 'Dresina prueba', uic: '00000000000-0', otro: true },
    acta: 'A-1', salida: { hora: '22:00', lugar: 'Base' }, apartado: { hora: '05:00', lugar: 'Base' },
    realizados: [{ id: 'r1', via: '2', pkInicio: '300+000', pkFin: '300+800', horaInicio: '23:00', horaFin: '02:00', trabajo: 'Descarga de balasto', m3: '30' }],
    combustible: { salida: '50', llegada: '40' }, km: { salida: '1000', llegada: '1040' },
    ...(subtipo === 'locomotora'
      ? { vagones: [{ tipo: 'tolva', uic: '1234', m3: '30' }], procedencia: 'Cantera prueba' }
      : { uicPlataforma: '00000000000-1', telefonemas: { entrada: { numero: '5', hora: '22:10' }, salida: { numero: '6', hora: '04:50' } } }),
  });
  return p;
}
