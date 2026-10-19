/**
 * Partes LAV · servidor de envío (Google Apps Script)
 *
 * - Registra a los capataces (Gmail + código por correo + nombre de la lista + PIN).
 *   Cada registro queda pendiente hasta que la oficina lo aprueba desde un enlace.
 *   Si alguien olvida el PIN, crea otro con un código que le llega al correo.
 * - Sirve a la app la lista de la oficina (trabajadores, máquinas, vehículos, aparatos con sus PK, medidas antiincendios, motivos, cabecera, y máquinas de vía y su personal para el parte de maquinaria).
 * - Recibe los partes y los manda por correo a la oficina, donde Power Automate los
 *   guarda en la carpeta de Teams.
 *
 * Los datos viven en la hoja de cálculo «Partes LAV · Datos», que crea configurar().
 * Los secretos (PIMIENTA y CLAVE_ADMIN) se generan solos y se guardan en las
 * propiedades del script: este archivo no contiene ningún dato privado.
 *
 * Instalación: ejecutar configurar() una vez y publicar como aplicación web
 * (Ejecutar como: yo · Quién tiene acceso: cualquier usuario).
 */

const ZONA = 'Europe/Madrid';
const MAX_ADJUNTOS_BYTES = 24 * 1024 * 1024;   // Gmail admite 25 MB por correo

const ACCIONES = {
  codigo: pedirCodigo_,
  verificar: verificarCodigo_,
  registro: registrar_,
  estado: estado_,
  login: entrar_,
  config: config_,
  enviar: enviar_,
  pin: cambiarPin_,
  nuevoPin: nuevoPin_,
  cargarLista: cargarLista_,
  fallo: registrarFallos_,
};

// Acciones que se bloquean ellas mismas solo en los tramos cortos: enviar un parte con fotos
// tarda segundos y, con el bloqueo puesto, dejaba esperando a todos los demás móviles.
const SIN_BLOQUEO = { enviar: true };

// ---------- Entrada ----------

function doPost(e) {
  let texto;
  const lock = LockService.getScriptLock();
  try {
    const datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const accion = ACCIONES[datos.accion];
    if (!accion) throw new Error('Acción desconocida.');
    if (SIN_BLOQUEO[datos.accion]) texto = responder_(datos, accion);
    else texto = lock.tryLock(30000)
      ? responder_(datos, accion)
      : JSON.stringify({ ok: false, reintentar: true, error: 'El servidor está ocupado. Se reintentará.' });
  } catch (err) {
    texto = JSON.stringify({ ok: false, error: String((err && err.message) || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* no estaba bloqueado */ }
  }
  return ContentService.createTextOutput(texto).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Hace cada petición una sola vez. A veces Google pierde la respuesta por el camino (la app
 * recibe una página de error aunque la acción se haya hecho) y la app repite la petición con
 * el mismo identificador: entonces se devuelve la respuesta guardada, sin volver a mandar el
 * código, registrar a nadie ni enviar el parte otra vez.
 */
function responder_(datos, accion) {
  const id = String(datos.peticion || '');
  const clave = /^[0-9a-f-]{36}$/i.test(id)
    ? 'p:' + sha256_([id, datos.accion, datos.token || '', datos.email || ''].join('|'))
    : '';
  const cache = CacheService.getScriptCache();
  const guardada = clave ? cache.get(clave) : null;
  if (guardada) return guardada;
  let respuesta;
  try {
    respuesta = Object.assign({ ok: true }, accion(datos));
  } catch (err) {
    respuesta = { ok: false, error: String((err && err.message) || err) };
    if (err && err.reintentar) respuesta.reintentar = true;
  }
  const texto = JSON.stringify(respuesta);
  // «Ocupado» no se guarda: el reintento con el mismo identificador tiene que volver a probar.
  if (clave && !respuesta.reintentar) {
    try { cache.put(clave, texto, 1800); } catch (x) { /* demasiado grande para la caché: no se guarda */ }
  }
  return texto;
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.accion === 'revisar') {
    const email = String(p.email || '').toLowerCase();
    if (!p.firma || p.firma !== firma_('revisar:' + email)) return HtmlService.createHtmlOutput('<p>Enlace no válido.</p>');
    const u = buscarUsuario_(email);
    if (!u) return HtmlService.createHtmlOutput('<p>Ese registro no existe.</p>');
    const t = HtmlService.createTemplate(PAGINA_REVISION_);
    t.email = email;
    t.nombre = String(u.Nombre);
    t.estado = String(u.Estado);
    t.firma = p.firma;
    return t.evaluate().setTitle('Partes LAV · Registro').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createHtmlOutput('<p>Partes LAV · servidor de envío.</p>');
}

// ---------- Instalación ----------

function configurar() {
  const p = props_();
  let libro;
  if (p.getProperty('HOJA_ID')) {
    libro = libro_();
  } else {
    libro = SpreadsheetApp.create('Partes LAV · Datos');
    p.setProperty('HOJA_ID', libro.getId());
  }
  crearHoja_(libro, 'Usuarios', ['Email', 'Nombre', 'Estado', 'Sal', 'PinHash', 'Intentos', 'BloqueadoHasta', 'Creado', 'Revisado']);
  crearHoja_(libro, 'Sesiones', ['TokenHash', 'Email', 'Creado', 'UltimoUso']);
  crearHoja_(libro, 'Envios', ['EnvioId', 'Email', 'Nombre', 'Ref', 'Asunto', 'Bytes', 'Recibido']);
  crearHoja_(libro, 'Trabajadores', ['Nombre', 'Empresa', 'Habilitacion', 'Categoria']);
  crearHoja_(libro, 'Maquinas', ['Descripcion']);
  crearHoja_(libro, 'Antiincendios', ['Medida']);
  crearHoja_(libro, 'Aparatos', ['Nombre', 'PkInicio', 'PkFin']);
  crearHoja_(libro, 'Vehiculos', ['Descripcion', 'Matricula']);
  crearHoja_(libro, 'MaquinasVia', ['Descripcion', 'UIC', 'Trabajo', 'Parte']);
  crearHoja_(libro, 'PersonalMaquinaria', ['Nombre', 'Empresa', 'Categoria']);
  crearHoja_(libro, 'Motivos', ['Tipo', 'Motivo']);
  crearHoja_(libro, 'Ajustes', ['Clave', 'Valor']);
  crearHoja_(libro, 'Errores', ['Recibido', 'Fecha', 'Usuario', 'Version', 'Tipo', 'Mensaje']);
  const sobra = libro.getSheetByName('Hoja 1') || libro.getSheetByName('Sheet1');
  if (sobra && libro.getSheets().length > 1) libro.deleteSheet(sobra);
  if (!p.getProperty('PIMIENTA')) p.setProperty('PIMIENTA', Utilities.getUuid() + Utilities.getUuid());
  if (!p.getProperty('CLAVE_ADMIN')) p.setProperty('CLAVE_ADMIN', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('Hoja de datos: ' + libro.getUrl());
  Logger.log('Clave de administración: ' + p.getProperty('CLAVE_ADMIN'));
}

function crearHoja_(libro, nombre, cabeceras) {
  let h = libro.getSheetByName(nombre);
  if (!h) h = libro.insertSheet(nombre);
  if (h.getLastRow() === 0) h.appendRow(cabeceras);
  // Todo como texto: así Sheets no convierte fechas ni códigos en números.
  h.getRange(1, 1, h.getMaxRows(), Math.max(cabeceras.length, h.getMaxColumns())).setNumberFormat('@');
  h.setFrozenRows(1);
  return h;
}

// ---------- Registro y acceso ----------

/** Código por correo para registrarse o, con para: 'pin', para crear un PIN nuevo. */
function pedirCodigo_(d) {
  const email = email_(d.email);
  const paraPin = d.para === 'pin';
  const u = buscarUsuario_(email);
  if (paraPin) {
    if (!u) throw new Error('No hay ninguna cuenta con ese correo. Regístrate primero.');
    if (u.Estado === 'rechazado') throw new Error('Esta cuenta no está activa. Habla con la oficina.');
  } else if (u) {
    throw new Error('Este correo ya está registrado. Usa «Ya tengo cuenta».');
  }
  const cache = CacheService.getScriptCache();
  const kn = 'n:' + email;
  const kg = 'g:' + Utilities.formatDate(new Date(), ZONA, 'yyyyMMdd');
  const n = Number(cache.get(kn) || 0);
  const g = Number(cache.get(kg) || 0);
  if (n >= 3) throw new Error('Has pedido demasiados códigos. Espera una hora y vuelve a intentarlo.');
  if (g >= 40) throw new Error('Hoy se han pedido demasiados códigos. Inténtalo mañana o avisa a la oficina.');
  const codigo = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('c:' + email, JSON.stringify({ codigo: codigo, fallos: 0 }), 600);
  cache.put(kn, String(n + 1), 3600);
  cache.put(kg, String(g + 1), 21600);
  enviarCorreo_({
    to: email,
    name: 'Partes LAV',
    subject: 'Tu código para la app Partes LAV: ' + codigo,
    body: 'Tu código para ' + (paraPin ? 'crear un PIN nuevo' : 'registrarte') + ' en la app Partes LAV es: ' + codigo +
      '\n\nCaduca en 10 minutos.\nSi no lo has pedido tú, ignora este correo.',
  });
  return {};
}

function comprobarCodigo_(email, codigo, consumir) {
  const cache = CacheService.getScriptCache();
  const k = 'c:' + email;
  const guardado = cache.get(k);
  if (!guardado) throw new Error('El código ha caducado. Pide uno nuevo.');
  const o = JSON.parse(guardado);
  if (o.codigo !== String(codigo || '').trim()) {
    o.fallos += 1;
    if (o.fallos >= 5) cache.remove(k); else cache.put(k, JSON.stringify(o), 600);
    throw new Error(o.fallos >= 5 ? 'Demasiados intentos. Pide un código nuevo.' : 'El código no es correcto.');
  }
  if (consumir) cache.remove(k);
}

function verificarCodigo_(d) {
  const email = email_(d.email);
  comprobarCodigo_(email, d.codigo, false);
  const ocupados = new Set(tabla_('Usuarios').filas.filter((u) => u.Estado !== 'rechazado').map((u) => String(u.Nombre)));
  const nombres = tabla_('Trabajadores').filas
    .map((t) => String(t.Nombre))
    .filter((n) => n && !ocupados.has(n))
    .sort((a, b) => a.localeCompare(b, 'es'));
  return { nombres: nombres };
}

function registrar_(d) {
  const email = email_(d.email);
  const nombre = String(d.nombre || '').trim();
  const pin = String(d.pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw new Error('El PIN tiene que tener de 4 a 6 cifras.');
  comprobarCodigo_(email, d.codigo, false);
  if (buscarUsuario_(email)) throw new Error('Este correo ya está registrado. Usa «Ya tengo cuenta».');
  if (!tabla_('Trabajadores').filas.some((t) => String(t.Nombre) === nombre)) throw new Error('Elige tu nombre de la lista.');
  if (tabla_('Usuarios').filas.some((u) => String(u.Nombre) === nombre && u.Estado !== 'rechazado')) {
    throw new Error('Ese nombre ya tiene una cuenta. Habla con la oficina.');
  }
  const sal = Utilities.getUuid();
  hoja_('Usuarios').appendRow([email, nombre, 'pendiente', sal, 'h' + firma_(sal + ':' + pin), '0', '0', ahora_(), '']);
  comprobarCodigo_(email, d.codigo, true);
  avisarRegistro_(email, nombre);
  return { token: crearSesion_(email), estado: 'pendiente', nombre: nombre };
}

function avisarRegistro_(email, nombre) {
  const aj = ajustes_();
  const admin = aj.admin || aj.destinatario;
  if (!admin) return;
  const url = ScriptApp.getService().getUrl() + '?accion=revisar&email=' + encodeURIComponent(email) +
    '&firma=' + firma_('revisar:' + email);
  enviarCorreo_({
    to: admin,
    name: 'Partes LAV',
    subject: 'Registro en la app de partes: ' + nombre,
    body: nombre + ' (' + email + ') se ha registrado en la app de partes.\n\n' +
      'Para aprobarlo o rechazarlo, abre este enlace:\n' + url +
      '\n\nHasta que lo apruebes no podrá enviar partes.',
  });
}

/** Llamada desde la página de revisión (pública: sin guion bajo). */
function revisarRegistro(email, firma, decision) {
  email = String(email || '').toLowerCase();
  if (!firma || firma !== firma_('revisar:' + email)) throw new Error('Enlace no válido.');
  if (decision !== 'activo' && decision !== 'rechazado') throw new Error('Decisión no válida.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const t = tabla_('Usuarios');
    const u = t.filas.find((f) => String(f.Email).toLowerCase() === email);
    if (!u) throw new Error('Ese registro no existe.');
    escribir_(t, u._fila, { Estado: decision, Revisado: ahora_() });
  } finally {
    lock.releaseLock();
  }
  return decision;
}

function estado_(d) {
  const u = usuarioDeSesion_(d.token, false);
  return { estado: String(u.Estado), nombre: String(u.Nombre) };
}

function entrar_(d) {
  const email = email_(d.email);
  const t = tabla_('Usuarios');
  const u = t.filas.find((f) => String(f.Email).toLowerCase() === email);
  if (!u) throw new Error('No hay ninguna cuenta con ese correo. Regístrate primero.');
  if (u.Estado === 'rechazado') throw new Error('Esta cuenta no está activa. Habla con la oficina.');
  const bloqueo = Number(u.BloqueadoHasta || 0);
  if (Date.now() < bloqueo) throw new Error('Demasiados intentos. Espera ' + Math.ceil((bloqueo - Date.now()) / 60000) + ' minutos.');
  if ('h' + firma_(u.Sal + ':' + String(d.pin || '')) !== String(u.PinHash)) {
    const fallos = Number(u.Intentos || 0) + 1;
    escribir_(t, u._fila, { Intentos: String(fallos), BloqueadoHasta: String(fallos >= 5 ? Date.now() + 15 * 60000 : 0) });
    throw new Error('PIN incorrecto.');
  }
  escribir_(t, u._fila, { Intentos: '0', BloqueadoHasta: '0' });
  return { token: crearSesion_(email), estado: String(u.Estado), nombre: String(u.Nombre) };
}

function cambiarPin_(d) {
  const u = usuarioDeSesion_(d.token, false);
  const pin = String(d.pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw new Error('El PIN tiene que tener de 4 a 6 cifras.');
  escribir_(tabla_('Usuarios'), u._fila, { PinHash: 'h' + firma_(u.Sal + ':' + pin), Intentos: '0', BloqueadoHasta: '0' });
  return {};
}

/** «He olvidado el PIN»: con el código que llega al correo se crea un PIN nuevo y se entra. */
function nuevoPin_(d) {
  const email = email_(d.email);
  const pin = String(d.pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw new Error('El PIN tiene que tener de 4 a 6 cifras.');
  comprobarCodigo_(email, d.codigo, false);
  const t = tabla_('Usuarios');
  const u = t.filas.find((f) => String(f.Email).toLowerCase() === email);
  if (!u) throw new Error('No hay ninguna cuenta con ese correo. Regístrate primero.');
  if (u.Estado === 'rechazado') throw new Error('Esta cuenta no está activa. Habla con la oficina.');
  escribir_(t, u._fila, { PinHash: 'h' + firma_(u.Sal + ':' + pin), Intentos: '0', BloqueadoHasta: '0' });
  comprobarCodigo_(email, d.codigo, true);
  return { token: crearSesion_(email), estado: String(u.Estado), nombre: String(u.Nombre) };
}

function crearSesion_(email) {
  const token = sha256_(Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Date.now());
  hoja_('Sesiones').appendRow(['h' + sha256_(token), email, ahora_(), '']);
  return token;
}

function usuarioDeSesion_(token, exigirActivo) {
  if (!token) throw new Error('Sesión no válida. Vuelve a entrar.');
  const th = 'h' + sha256_(String(token));
  const sesiones = tabla_('Sesiones');
  const s = sesiones.filas.find((f) => f.TokenHash === th);
  if (!s) throw new Error('Sesión no válida. Vuelve a entrar.');
  const u = buscarUsuario_(String(s.Email).toLowerCase());
  if (!u) throw new Error('Sesión no válida. Vuelve a entrar.');
  if (exigirActivo && u.Estado !== 'activo') {
    throw new Error(u.Estado === 'pendiente'
      ? 'Tu registro aún no está aprobado por la oficina.'
      : 'Tu cuenta no está activa. Habla con la oficina.');
  }
  escribir_(sesiones, s._fila, { UltimoUso: ahora_() });
  return u;
}

// ---------- Lista de la oficina ----------

function config_(d) {
  // También para registros pendientes: pueden ir haciendo partes, que se enviarán al aprobarlos.
  const u = usuarioDeSesion_(d.token, false);
  if (u.Estado === 'rechazado') throw new Error('Tu cuenta no está activa. Habla con la oficina.');
  const aj = ajustes_();
  const motivos = { infra: [], super: [] };
  tabla_('Motivos').filas.forEach((m) => {
    const tipo = String(m.Tipo).toLowerCase();
    if (motivos[tipo] && m.Motivo) motivos[tipo].push(String(m.Motivo));
  });
  return {
    estado: String(u.Estado),
    nombre: String(u.Nombre),
    ultimos: ultimosNumeros_(u.Email),
    config: {
      formato: 'config-partes-lav',
      version: 1,
      nombre: aj.nombre || 'Lista de la oficina',
      fecha: aj.fecha || '',
      destinatario: aj.destinatario || '',   // para el envío alternativo por Gmail
      cabecera: {
        jefatura: aj.jefatura || '', ambito: aj.ambito || '', empresa: aj.empresa || '',
        lineaInfra: aj.lineaInfra || '', lineaSuper: aj.lineaSuper || '',
      },
      capataces: [],
      trabajadores: tabla_('Trabajadores').filas.filter((t) => t.Nombre).map((t) => ({
        nombre: String(t.Nombre), empresa: String(t.Empresa || ''),
        habilitacion: String(t.Habilitacion || ''), categoria: String(t.Categoria || ''),
      })),
      maquinas: tabla_('Maquinas').filas.filter((v) => v.Descripcion).map((v) => ({
        descripcion: String(v.Descripcion),
      })),
      aparatos: tabla_('Aparatos').filas.filter((a) => a.Nombre).map((a) => ({
        nombre: String(a.Nombre), pkInicio: String(a.PkInicio || ''), pkFin: String(a.PkFin || ''),
      })),
      antiincendios: tabla_('Antiincendios').filas.map((m) => String(m.Medida || '').trim()).filter(Boolean),
      // Parte de maquinaria de vía: sus máquinas y su personal (si la hoja aún no existe, van vacías)
      maquinasVia: tabla_('MaquinasVia').filas.filter((m) => m.Descripcion).map((m) => ({
        descripcion: String(m.Descripcion), uic: String(m.UIC || ''), trabajo: String(m.Trabajo || ''),
        parte: String(m.Parte || 'via').toLowerCase(),   // via, locomotora o dresina: qué parte abre
      })),
      personalMaquinaria: tabla_('PersonalMaquinaria').filas.filter((t) => t.Nombre).map((t) => ({
        nombre: String(t.Nombre), empresa: String(t.Empresa || ''), categoria: String(t.Categoria || ''),
      })),
      vehiculos: tabla_('Vehiculos').filas.filter((v) => v.Descripcion).map((v) => ({
        descripcion: String(v.Descripcion), matricula: String(v.Matricula || ''),
      })),
      motivos: motivos,
    },
  };
}

/**
 * Número más alto que este capataz ya ha enviado de cada prefijo ({INF: 12, LOC: 3…}). Con él, un
 * móvil reinstalado sigue la numeración en vez de volver a la 0001 y pisar carpetas en Teams.
 */
function ultimosNumeros_(email) {
  const e = String(email).toLowerCase();
  const ultimos = {};
  tabla_('Envios').filas.forEach((f) => {
    const m = /^([A-Z]+)-(\d+)$/.exec(String(f.Ref || ''));
    if (m && String(f.Email).toLowerCase() === e) ultimos[m[1]] = Math.max(ultimos[m[1]] || 0, Number(m[2]));
  });
  return ultimos;
}

/**
 * Sube la lista de la oficina (mismo formato que config-partes-lav.json). Requiere la clave de
 * administración. Solo cambia lo que venga: trabajadores, maquinas, vehiculos, aparatos, antiincendios, motivos y, si
 * viene la cabecera, los ajustes.
 */
function cargarLista_(d) {
  const clave = props_().getProperty('CLAVE_ADMIN');
  if (!clave || String(d.clave || '') !== clave) throw new Error('Clave de administración incorrecta.');
  const c = d.config || {};
  if (c.formato !== 'config-partes-lav') throw new Error('No es una lista de Partes LAV.');
  const hecho = {};
  if (Array.isArray(c.trabajadores)) {
    reemplazar_('Trabajadores', c.trabajadores.map((t) => [t.nombre, t.empresa || '', t.habilitacion || '', t.categoria || '']));
    hecho.trabajadores = c.trabajadores.length;
  }
  if (Array.isArray(c.maquinas)) {
    asegurarHoja_('Maquinas', ['Descripcion']);
    reemplazar_('Maquinas', c.maquinas.map((v) => [v.descripcion]));
    hecho.maquinas = c.maquinas.length;
  }
  if (Array.isArray(c.vehiculos)) {
    reemplazar_('Vehiculos', c.vehiculos.map((v) => [v.descripcion, v.matricula || '']));
    hecho.vehiculos = c.vehiculos.length;
  }
  if (Array.isArray(c.aparatos)) {
    asegurarHoja_('Aparatos', ['Nombre', 'PkInicio', 'PkFin']);
    reemplazar_('Aparatos', c.aparatos.map((a) => [a.nombre, a.pkInicio || '', a.pkFin || '']));
    hecho.aparatos = c.aparatos.length;
  }
  if (Array.isArray(c.maquinasVia)) {
    asegurarHoja_('MaquinasVia', ['Descripcion', 'UIC', 'Trabajo', 'Parte']);
    reemplazar_('MaquinasVia', c.maquinasVia.map((m) => [m.descripcion, m.uic || '', m.trabajo || '', m.parte || 'via']));
    hecho.maquinasVia = c.maquinasVia.length;
  }
  if (Array.isArray(c.personalMaquinaria)) {
    asegurarHoja_('PersonalMaquinaria', ['Nombre', 'Empresa', 'Categoria']);
    reemplazar_('PersonalMaquinaria', c.personalMaquinaria.map((t) => [t.nombre, t.empresa || '', t.categoria || '']));
    hecho.personalMaquinaria = c.personalMaquinaria.length;
  }
  if (Array.isArray(c.antiincendios)) {
    asegurarHoja_('Antiincendios', ['Medida']);
    reemplazar_('Antiincendios', c.antiincendios.map((m) => [m]));
    hecho.antiincendios = c.antiincendios.length;
  }
  if (c.motivos) {
    const m = c.motivos;
    reemplazar_('Motivos', [].concat(
      (m.infra || []).map((x) => ['infra', x]),
      (m.super || []).map((x) => ['super', x]),
    ));
    hecho.motivos = true;
  }
  if (c.cabecera) {
    const cab = c.cabecera;
    const aj = {
      nombre: c.nombre || '', fecha: c.fecha || '', destinatario: c.destinatario || '', admin: c.admin || c.destinatario || '',
      copia: c.copia != null ? c.copia : (ajustes_().copia || ''),   // si la lista no la trae, se conserva la que hay
      jefatura: cab.jefatura || '', ambito: cab.ambito || '', empresa: cab.empresa || '',
      lineaInfra: cab.lineaInfra || '', lineaSuper: cab.lineaSuper || '',
    };
    reemplazar_('Ajustes', Object.keys(aj).map((k) => [k, aj[k]]));
    hecho.ajustes = true;
  }
  return hecho;
}

function asegurarHoja_(nombre, cabeceras) {
  const libro = libro_();
  return libro.getSheetByName(nombre) || crearHoja_(libro, nombre, cabeceras);
}

// ---------- Envío de partes ----------

/**
 * Va en tres tramos para no tener parado al resto de móviles mientras sale el correo:
 *  1. Con bloqueo (corto): sesión, ¿ya enviado?, ¿otro intento de este mismo parte en curso?, reserva.
 *  2. Sin bloqueo: adjuntos y correo, que es lo lento.
 *  3. Apuntar en Envios (appendRow no depende de números de fila, no necesita bloqueo).
 * La reserva dura 10 minutos en la caché: si un reintento llega mientras el primero aún está
 * mandando el correo, recibe «ocupado» y la app vuelve a probar más tarde, cuando ya figura en Envios.
 */
function enviar_(d) {
  const envioId = String(d.envioId || '');
  if (!/^[0-9a-f-]{36}$/i.test(envioId)) throw new Error('Envío sin identificador.');
  const cache = CacheService.getScriptCache();
  const reserva = 'e:' + envioId;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw ocupado_('El servidor está ocupado. Se reintentará.');
  let u, aj;
  try {
    u = usuarioDeSesion_(d.token, true);
    // Si la app reintenta un envío que ya llegó (p. ej. se cortó la cobertura al recibir
    // la respuesta), no se manda dos veces.
    const previo = tabla_('Envios').filas.find((f) => f.EnvioId === envioId);
    if (previo) return { recibido: String(previo.Recibido), repetido: true };
    if (cache.get(reserva)) throw ocupado_('Este parte se está enviando. Se comprobará en un momento.');
    aj = ajustes_();
    if (!aj.destinatario) throw new Error('Falta el correo de destino en los ajustes del servidor.');
    cache.put(reserva, '1', 600);
  } finally {
    lock.releaseLock();
  }
  let r;
  try {
    r = mandarParte_(d, u, aj);
  } catch (err) {
    cache.remove(reserva);   // el correo no ha salido: se puede volver a intentar ya
    throw err;
  }
  // Si esto fallara, la reserva sigue 10 minutos y evita mandar el correo dos veces enseguida.
  hoja_('Envios').appendRow([envioId, String(u.Email), String(u.Nombre), String(d.ref || ''), r.asunto, String(r.bytes), r.fecha]);
  cache.remove(reserva);
  return { recibido: r.fecha };
}

function ocupado_(mensaje) {
  const err = new Error(mensaje);
  err.reintentar = true;
  return err;
}

/** Monta los adjuntos y manda el correo del parte. Devuelve { fecha, asunto, bytes }. */
function mandarParte_(d, u, aj) {
  let asunto = String(d.asunto || '').replace(/[\r\n]+/g, ' ').trim();
  if (asunto.indexOf('PARTE LAV') !== 0) asunto = 'PARTE LAV · ' + asunto;
  const archivos = Array.isArray(d.archivos) ? d.archivos : [];
  if (!archivos.length || archivos.length > 6) throw new Error('El parte no trae los archivos esperados.');
  let bytes = 0;
  const adjuntos = archivos.map((a) => {
    const nombre = String(a.nombre || 'archivo').replace(/[^\w.\-]/g, '_');
    const blob = a.base64 != null
      ? Utilities.newBlob(Utilities.base64Decode(String(a.base64)), String(a.tipo || 'application/octet-stream'), nombre)
      : Utilities.newBlob(String(a.texto || ''), 'text/plain', nombre);
    bytes += blob.getBytes().length;
    return blob;
  });
  if (bytes > MAX_ADJUNTOS_BYTES) throw new Error('El parte pesa demasiado (' + Math.round(bytes / 1048576) + ' MB). Quita alguna foto.');
  const recibido = ahora_();
  const cuerpo = String(d.cuerpo || '') + '\n\nRecibido en el servidor: ' + recibido +
    '\nEnviado por: ' + u.Nombre + ' <' + u.Email + '>';
  // Correo de la oficina: es el que lee Power Automate para guardar en Teams. No cambiar sus adjuntos.
  enviarCorreo_({
    to: aj.destinatario,
    name: 'Partes LAV',
    replyTo: String(u.Email),
    subject: asunto,
    body: cuerpo,
    attachments: adjuntos,
  });
  // Copia (fila «copia» de Ajustes): correo aparte con el PDF y las fotos sueltas en .jpg.
  // El parte ya ha salido: si la copia falla, NO se lanza el error (la app reenviaría el parte
  // y llegaría dos veces a Teams); se apunta en la hoja Errores.
  const copia = correosValidos_(aj.copia);
  if (copia) {
    try {
      mandarCopia_(archivos, adjuntos, copia, asunto, cuerpo, u);
    } catch (err) {
      apuntarError_('copia', String(d.ref || '') + ': ' + String((err && err.message) || err));
    }
  }
  return { fecha: recibido, asunto: asunto, bytes: bytes };
}

/**
 * Correo para la copia: el PDF y cada foto como .jpg con un nombre que lo dice todo,
 * p. ej. «INF-0012_2026-10-15_T1_SIOS-12345_antes_1.jpg». Sin los .txt técnicos.
 */
function mandarCopia_(archivos, adjuntos, para, asunto, cuerpo, u) {
  const texto = (prefijo) => {
    const a = archivos.find((x) => String(x.nombre || '').indexOf(prefijo) === 0);
    return a && a.texto != null ? String(a.texto) : '';
  };
  let datos = {};
  let fotos = [];
  try { datos = JSON.parse(texto('Datos_') || '{}'); } catch (e) { datos = {}; }
  try { fotos = (JSON.parse(texto('Fotos_') || '{}').fotos) || []; } catch (e) { fotos = []; }
  const base = nombreArchivo_(String(datos.ref || 'PARTE') + (datos.rev > 1 ? '_v' + datos.rev : '') + '_' + String(datos.fecha || ''));
  const trabajos = Array.isArray(datos.trabajos) ? datos.trabajos : [];
  const cuenta = {};
  const jpgs = fotos.map((f) => {
    let nombre;
    if (f.fase === 'formato') {
      cuenta.formato = (cuenta.formato || 0) + 1;
      nombre = 'Formato1_' + cuenta.formato;
    } else {
      const k = 'T' + f.trabajo + '_' + f.fase;
      cuenta[k] = (cuenta[k] || 0) + 1;
      nombre = 'T' + f.trabajo + '_' + refTrabajo_(trabajos[f.trabajo - 1]) + '_' + f.fase + '_' + cuenta[k];
    }
    return Utilities.newBlob(Utilities.base64Decode(String(f.base64 || '')), 'image/jpeg', base + '_' + nombreArchivo_(nombre) + '.jpg');
  });
  const pdf = adjuntos.filter((b) => /\.pdf$/i.test(String(b.getName())));
  enviarCorreo_({
    to: para,
    name: 'Partes LAV',
    replyTo: String(u.Email),
    subject: asunto,
    body: cuerpo + '\n\nCopia: PDF del parte' + (jpgs.length ? ' y ' + jpgs.length + ' foto(s) sueltas en .jpg.' : ' (sin fotos).'),
    attachments: pdf.concat(jpgs),
  });
}

/** Referencia del trabajo para el nombre de la foto: SIOS-123, INC-45 o lo que escribió el capataz. */
function refTrabajo_(t) {
  const r = (t && t.referencia) || {};
  if (r.tipo === 'SIOS') return 'SIOS-' + (r.codigo || '');
  if (r.tipo === 'INCIDENCIA') return 'INC-' + (r.codigo || '');
  return String(r.motivo || '').trim().slice(0, 30) || 'SinRef';
}

/** Texto apto para nombre de archivo: sin tildes ni símbolos raros. */
function nombreArchivo_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9+\-]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
}

/** Apunta un fallo del servidor en la hoja Errores (mismo formato que los de los móviles). */
function apuntarError_(tipo, mensaje) {
  try {
    const cab = ['Recibido', 'Fecha', 'Usuario', 'Version', 'Tipo', 'Mensaje'];
    const h = hoja_('Errores') || crearHoja_(libro_(), 'Errores', cab);
    h.appendRow([ahora_(), ahora_(), 'servidor', '', tipo, String(mensaje).slice(0, 200)]);
  } catch (e) { /* sin hoja: nada más que hacer */ }
}

// ---------- Copia de seguridad ----------

const COPIAS_A_GUARDAR = 8;   // semanas

/**
 * Copia la hoja de datos en la carpeta «Partes LAV · Copias» del Drive de la cuenta y deja solo
 * las últimas COPIAS_A_GUARDAR (las demás van a la papelera, de donde Google las borra a los 30 días).
 * La llama el activador semanal; también se puede ejecutar a mano.
 */
function copiaSeguridad() {
  const original = DriveApp.getFileById(props_().getProperty('HOJA_ID'));
  const carpetas = DriveApp.getFoldersByName('Partes LAV · Copias');
  const carpeta = carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder('Partes LAV · Copias');
  const fecha = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  original.makeCopy('Copia ' + fecha + ' · Partes LAV · Datos', carpeta);
  const copias = [];
  const it = carpeta.getFiles();
  while (it.hasNext()) copias.push(it.next());
  copias.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  copias.slice(COPIAS_A_GUARDAR).forEach((f) => f.setTrashed(true));
  Logger.log('Copia hecha: ' + fecha + ' (' + Math.min(copias.length, COPIAS_A_GUARDAR) + ' guardadas)');
}

/** Se ejecuta una vez a mano: crea el activador que hace la copia cada lunes a las 3 de la madrugada. */
function activarCopiaSemanal() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'copiaSeguridad')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('copiaSeguridad').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
}

// ---------- Resumen diario ----------

/**
 * Manda a la oficina la lista de partes recibidos hoy. Solo sabe lo que el servidor ha enviado
 * por correo: no puede saber si Power Automate los ha guardado en Teams.
 * El asunto no lleva «PARTE LAV» a propósito, para que el flujo de Power Automate no lo coja.
 */
function resumenDiario() {
  const aj = ajustes_();
  if (!aj.destinatario) throw new Error('Falta el correo de destino en los ajustes del servidor.');
  const hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  const dia = Utilities.formatDate(new Date(), ZONA, 'dd/MM/yyyy');
  const enviados = tabla_('Envios').filas
    .filter((f) => String(f.Recibido).indexOf(hoy) === 0)
    .sort((a, b) => String(a.Recibido).localeCompare(String(b.Recibido)));
  let cuerpo;
  if (!enviados.length) {
    cuerpo = 'Hoy (' + dia + ') no se ha recibido ningún parte.';
  } else {
    cuerpo = 'Partes recibidos hoy (' + dia + '): ' + enviados.length + '\n\n' + enviados.map((f) =>
      String(f.Recibido).slice(11, 16) + '  ' + String(f.Ref) + '  ' + String(f.Nombre)).join('\n') +
      '\n\nComprueba que están en la carpeta de Teams: este resumen solo cuenta lo recibido por el servidor.';
  }
  let limpieza;
  try {
    const n = limpiarSesiones_();
    limpieza = n ? 'Sesiones borradas hoy (sin uso en ' + DIAS_SESION + ' días o de cuentas dadas de baja): ' + n + '.' : '';
  } catch (err) {
    limpieza = 'No se han podido limpiar las sesiones: ' + ((err && err.message) || err);
  }
  if (limpieza) cuerpo += '\n\n' + limpieza;
  const fh = fallosHoy_();
  cuerpo += '\n\nFallos de campo hoy: ' + fh.total +
    (fh.total ? ' (' + Object.keys(fh.porTipo).map((t) => t + ' ' + fh.porTipo[t]).join(', ') +
      '; ' + fh.usuarios + (fh.usuarios === 1 ? ' móvil' : ' móviles') + ') · detalle en la hoja «Errores».' : '.');
  cuerpo += '\n\nCorreos enviados hoy por el servidor (antes de este): ' + correosHoy_().n +
    ' · cuota restante: ' + MailApp.getRemainingDailyQuota() + '.';
  enviarCorreo_({
    to: aj.destinatario,
    name: 'Partes LAV',
    subject: 'Resumen del día · capataces LAV · ' + dia + ' · ' + enviados.length + (enviados.length === 1 ? ' parte' : ' partes'),
    body: cuerpo,
  });
}

/** Se ejecuta una vez a mano: crea el activador que manda el resumen todos los días a las 16:00. */
function activarResumenDiario() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'resumenDiario')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('resumenDiario').timeBased().everyDays(1).atHour(16).inTimezone(ZONA).create();
}

// ---------- Limpieza de sesiones ----------

const DIAS_SESION = 180;   // sin usar la app en este tiempo, hay que volver a entrar con el PIN

/**
 * Borra las sesiones sin uso en DIAS_SESION días y las de cuentas rechazadas o borradas.
 * Va con bloqueo: al quitar filas cambian los números de fila que usan las demás peticiones.
 * La llama resumenDiario (no necesita activador propio). Devuelve cuántas ha borrado.
 */
function limpiarSesiones_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const t = tabla_('Sesiones');
    if (!t.h || !t.filas.length) return 0;
    const estados = {};
    tabla_('Usuarios').filas.forEach((u) => { estados[String(u.Email).toLowerCase()] = String(u.Estado); });
    const limite = Date.now() - DIAS_SESION * 86400000;
    const reales = t.filas.filter((s) => s.TokenHash);   // sin contar filas vacías
    const quedan = reales.filter((s) => {
      const estado = estados[String(s.Email).toLowerCase()];
      if (!estado || estado === 'rechazado') return false;
      const uso = new Date(String(s.UltimoUso || s.Creado)).getTime();
      return !(uso < limite);   // fecha ilegible (NaN): se conserva
    });
    const borradas = reales.length - quedan.length;
    if (!borradas) return 0;
    const ancho = t.cab.length;
    t.h.getRange(2, 1, t.filas.length, ancho).clearContent();
    if (quedan.length) {
      t.h.getRange(2, 1, quedan.length, ancho).setValues(quedan.map((s) => t.cab.map((c) => String(s[c] == null ? '' : s[c]))));
    }
    return borradas;
  } finally {
    lock.releaseLock();
  }
}

// ---------- Registro de fallos de campo ----------

const MAX_FALLOS_DIA = 200;     // tope diario para que un móvil con un bucle no llene la hoja
const MAX_FALLOS_LOTE = 20;

/**
 * Guarda en la hoja «Errores» los fallos que manda la app. Sin datos personales: el usuario va
 * como un código corto (no reversible sin la pimienta del servidor), nunca nombre ni correo.
 */
function registrarFallos_(d) {
  const u = usuarioDeSesion_(d.token, false);
  const lista = Array.isArray(d.fallos) ? d.fallos.slice(0, MAX_FALLOS_LOTE) : [];
  const cache = CacheService.getScriptCache();
  const kg = 'f:' + Utilities.formatDate(new Date(), ZONA, 'yyyyMMdd');
  let hoy = Number(cache.get(kg) || 0);
  const usuario = firma_('u:' + String(u.Email).toLowerCase()).slice(0, 8);
  const recibido = ahora_();
  const filas = [];
  lista.forEach((f) => {
    if (hoy >= MAX_FALLOS_DIA) return;
    hoy += 1;
    filas.push([recibido, String(f.fecha || '').slice(0, 25), usuario, String(f.version || '').slice(0, 10),
      String(f.tipo || '').slice(0, 20), String(f.mensaje || '').slice(0, 200)]);
  });
  if (filas.length) {
    // Si la hoja aún no existe (servidor sin reconfigurar), se crea aquí.
    const h = hoja_('Errores') || crearHoja_(libro_(), 'Errores', ['Recibido', 'Fecha', 'Usuario', 'Version', 'Tipo', 'Mensaje']);
    h.getRange(h.getLastRow() + 1, 1, filas.length, 6).setValues(filas);
    cache.put(kg, String(hoy), 21600);
  }
  return { guardados: filas.length };
}

/** Fallos de hoy, por tipo, para el resumen de las 16:00. */
function fallosHoy_() {
  const h = hoja_('Errores');
  if (!h) return { total: 0, porTipo: {}, usuarios: 0 };
  const hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  const filas = tabla_('Errores').filas.filter((f) => String(f.Recibido).indexOf(hoy) === 0);
  const porTipo = {};
  const usuarios = {};
  filas.forEach((f) => {
    porTipo[f.Tipo] = (porTipo[f.Tipo] || 0) + 1;
    usuarios[f.Usuario] = true;
  });
  return { total: filas.length, porTipo: porTipo, usuarios: Object.keys(usuarios).length };
}

// ---------- Control de correos ----------

const AVISO_CORREOS = 70;   // Gmail gratuito permite unos 100 al día

/** Cuenta los correos del día (propiedad CORREOS = {dia, n, avisado}). */
function correosHoy_() {
  const dia = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  let o = null;
  try { o = JSON.parse(props_().getProperty('CORREOS') || 'null'); } catch (e) { o = null; }
  if (!o || o.dia !== dia) o = { dia: dia, n: 0, avisado: false };
  return o;
}

/**
 * Único punto de envío de correo del servidor: envía, cuenta y avisa una vez al día
 * al llegar a AVISO_CORREOS. El aviso no lleva «PARTE LAV» en el asunto.
 */
function enviarCorreo_(opciones) {
  MailApp.sendEmail(opciones);
  const o = correosHoy_();
  // Google cuenta el límite diario por DESTINATARIO: un parte con copia gasta 2.
  o.n += [opciones.to, opciones.cc, opciones.bcc].join(',').split(',').filter((x) => x.trim()).length || 1;
  if (o.n >= AVISO_CORREOS && !o.avisado) {
    o.avisado = true;
    const aj = ajustes_();
    const para = aj.admin || aj.destinatario;
    if (para) {
      MailApp.sendEmail({
        to: para,
        name: 'Partes LAV',
        subject: 'Aviso: ' + o.n + ' correos enviados hoy desde el servidor de partes',
        body: 'El servidor de partes ha enviado ' + o.n + ' correos hoy (' + o.dia + ').\n' +
          'Cuota restante hoy según Google: ' + MailApp.getRemainingDailyQuota() + '.\n\n' +
          'Si se agota, la app dará error al enviar o registrarse hasta el día siguiente.',
      });
    }
  }
  props_().setProperty('CORREOS', JSON.stringify(o));
}

// ---------- Utilidades ----------

/** «a@x.com, b@y.com» → solo los correos bien escritos, separados por comas ('' si no hay ninguno). */
function correosValidos_(s) {
  return String(s || '').split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e))
    .join(',');
}

function props_() { return PropertiesService.getScriptProperties(); }
function libro_() { return SpreadsheetApp.openById(props_().getProperty('HOJA_ID')); }
function hoja_(nombre) { return libro_().getSheetByName(nombre); }
function ahora_() { return Utilities.formatDate(new Date(), ZONA, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function hex_(bytes) { return bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''); }
function sha256_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function firma_(s) { return hex_(Utilities.computeHmacSha256Signature(s, props_().getProperty('PIMIENTA'), Utilities.Charset.UTF_8)); }

function email_(s) {
  const e = String(s || '').trim().toLowerCase();
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) throw new Error('Ese correo no es válido.');
  return e;
}

/** Lee una hoja como lista de objetos { Columna: valor, _fila: nº de fila }. */
function tabla_(nombre) {
  const h = hoja_(nombre);
  if (!h) return { h: null, cab: [], filas: [] };   // hoja aún sin crear (p. ej. Maquinas)
  const valores = h.getDataRange().getValues();
  const cab = (valores.shift() || []).map(String);
  const filas = valores.map((v, i) => {
    const o = { _fila: i + 2 };
    cab.forEach((c, j) => { o[c] = v[j]; });
    return o;
  });
  return { h: h, cab: cab, filas: filas };
}

function escribir_(tabla, fila, cambios) {
  Object.keys(cambios).forEach((k) => {
    const col = tabla.cab.indexOf(k) + 1;
    if (col) tabla.h.getRange(fila, col).setValue(String(cambios[k]));
  });
}

function reemplazar_(nombre, filas) {
  const h = hoja_(nombre);
  if (h.getLastRow() > 1) h.getRange(2, 1, h.getLastRow() - 1, h.getLastColumn()).clearContent();
  if (filas.length) h.getRange(2, 1, filas.length, filas[0].length).setValues(filas.map((f) => f.map((x) => String(x == null ? '' : x))));
}

function buscarUsuario_(email) {
  return tabla_('Usuarios').filas.find((u) => String(u.Email).toLowerCase() === email);
}

function ajustes_() {
  const o = {};
  tabla_('Ajustes').filas.forEach((f) => { if (f.Clave) o[String(f.Clave)] = String(f.Valor); });
  return o;
}

const PAGINA_REVISION_ = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 24px auto; padding: 0 16px; color: #10141c; }
  button { font: inherit; font-size: 18px; padding: 12px 22px; margin: 8px 8px 0 0; border: 0; border-radius: 10px; color: #fff; cursor: pointer; }
  .si { background: #157a3a; } .no { background: #b42318; }
</style></head><body>
<h2>Registro en la app de partes</h2>
<p><strong><?= nombre ?></strong><br><?= email ?></p>
<p id="estado">Estado actual: <strong><?= estado ?></strong></p>
<button class="si" onclick="decidir('activo')">Aprobar</button>
<button class="no" onclick="decidir('rechazado')">Rechazar</button>
<script>
  function decidir(d) {
    var el = document.getElementById('estado');
    el.textContent = 'Guardando…';
    google.script.run
      .withSuccessHandler(function (r) { el.innerHTML = 'Hecho: <strong>' + (r === 'activo' ? 'aprobado' : 'rechazado') + '</strong>.'; })
      .withFailureHandler(function (e) { el.textContent = 'Error: ' + e.message; })
      .revisarRegistro(<?!= JSON.stringify(email) ?>, <?!= JSON.stringify(firma) ?>, d);
  }
</script>
</body></html>`;
