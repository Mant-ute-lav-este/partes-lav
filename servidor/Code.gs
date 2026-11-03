/**
 * Partes LAV · servidor de envío (Google Apps Script)
 *
 * - Registra a los capataces (Gmail + código por correo + nombre de la lista + PIN).
 *   Cada registro queda pendiente hasta que la oficina lo aprueba desde un enlace.
 *   Si alguien olvida el PIN, crea otro con un código que le llega al correo.
 * - Sirve a la app la lista de la oficina (trabajadores, máquinas, vehículos, aparatos con sus PK, medidas antiincendios, motivos, cabecera, y máquinas de vía y su personal para el parte de maquinaria).
 * - Recibe los partes y los manda por correo a la oficina, donde Power Automate los
 *   guarda en la carpeta de Teams.
 * - Manda los datos de cada parte (sin fotos) al portal de la UTE, si está configurado.
 *
 * Los datos viven en la hoja de cálculo «Partes LAV · Datos», que crea configurar().
 * Los secretos (PIMIENTA y CLAVE_ADMIN) se generan solos y se guardan en las
 * propiedades del script: este archivo no contiene ningún dato privado.
 *
 * Instalación: ejecutar configurar() una vez y publicar como aplicación web
 * (Ejecutar como: yo · Quién tiene acceso: cualquier usuario).
 */

// Número de esta versión del servidor. SUBIRLO en cada despliegue (el mismo que «Versión N» en
// Gestionar implementaciones) y apuntarlo en el CHANGELOG. Sale en la lista que pide la app
// (Menú → «Servidor: vN») y en la página de la URL: así se comprueba qué versión está en marcha.
const VERSION_SERVIDOR = 22;
const ZONA = 'Europe/Madrid';
const MAX_ADJUNTOS_BYTES = 24 * 1024 * 1024;   // Gmail admite 25 MB por correo
const MAX_ARCHIVOS = 12;   // PDF, Datos y Fotos, más hasta 6 registros DRP de la bateadora (con margen)
// Adjuntos que se admiten en un parte (por extensión) y el tipo con el que salen en el correo.
const TIPOS_ADJUNTO = {
  pdf: 'application/pdf', txt: 'text/plain', json: 'application/json',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', drp: 'application/octet-stream',
};

const ACCIONES = {
  codigo: pedirCodigo_,
  verificar: verificarCodigo_,
  buscarNombre: buscarNombre_,
  registro: registrar_,
  estado: estado_,
  login: entrar_,
  config: config_,
  enviar: enviar_,
  pin: cambiarPin_,
  nuevoPin: nuevoPin_,
  cargarLista: cargarLista_,
  fallo: registrarFallos_,
  salir: salir_,
};

// Acciones que se bloquean ellas mismas solo en los tramos cortos: enviar un parte con fotos
// tarda segundos y, con el bloqueo puesto, dejaba esperando a todos los demás móviles.
const SIN_BLOQUEO = { enviar: true };

// Acciones que llevan el token de sesión del móvil (las que llaman a usuarioDeSesion_).
const CON_SESION = { estado: true, config: true, enviar: true, pin: true, fallo: true, salir: true };

// ---------- Entrada ----------

function doPost(e) {
  let texto;
  const lock = LockService.getScriptLock();
  try {
    let datos;
    try {
      datos = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (x) {
      throw new Error('Petición no válida.');   // sin el detalle técnico del error de lectura
    }
    // Solo las acciones propias: «constructor» o «toString» también existen en cualquier objeto.
    const accion = Object.prototype.hasOwnProperty.call(ACCIONES, datos.accion) ? ACCIONES[datos.accion] : null;
    if (!accion) throw new Error('Acción desconocida.');
    // Un token inventado se descarta aquí, antes de coger el bloqueo y sin leer la hoja Sesiones.
    if (CON_SESION[datos.accion] && !tokenPosible_(datos.token)) throw new Error(SESION_NO_VALIDA);
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
    if (enlaceValido_(email, p.firma, 'pendiente') === 'no-valido') return HtmlService.createHtmlOutput('<p>Enlace no válido.</p>');
    const usuarios = tabla_('Usuarios').filas;
    const u = usuarios.find((f) => String(f.Email).toLowerCase() === email);
    if (!u) return HtmlService.createHtmlOutput('<p>Ese registro no existe.</p>');
    if (enlaceValido_(email, p.firma, String(u.Estado)) !== 'ok') return HtmlService.createHtmlOutput('<p>' + ENLACE_CADUCADO + '</p>');
    const t = HtmlService.createTemplate(PAGINA_REVISION_);
    t.email = email;
    t.nombre = String(u.Nombre);
    t.estado = String(u.Estado);
    t.firma = p.firma;
    t.caduca = fechaCaducidad_(p.firma);
    const otras = otrasConNombre_(usuarios, u);
    t.otras = otras.map((o) => o.Email + ' · ' + o.Estado);
    t.hayPendientes = otras.some((o) => o.Estado === 'pendiente');
    return t.evaluate().setTitle('Partes LAV · Registro').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return HtmlService.createHtmlOutput('<p>Partes LAV · servidor de envío · v' + VERSION_SERVIDOR + '</p>');
}

// ---------- Instalación ----------

/**
 * Toda función sin «_» al final la puede llamar desde el navegador cualquiera que abra la página del
 * servidor (google.script.run), y se ejecuta como el dueño. Por eso las de mantenimiento empiezan por
 * aquí: solo siguen si las lanza un activador de este proyecto hecho para esa misma función, o el dueño
 * desde el editor. Una función pública nueva tiene que empezar por aquí (lo vigila una prueba).
 */
function soloDueno_(e, funcion) {
  const uid = e && e.triggerUid ? String(e.triggerUid) : '';
  if (uid && funcion && ScriptApp.getProjectTriggers().some((t) =>
    String(t.getUniqueId()) === uid && t.getHandlerFunction() === funcion)) return;
  const activo = Session.getActiveUser().getEmail();
  if (activo && activo === Session.getEffectiveUser().getEmail()) return;
  throw new Error('Esta función solo se puede ejecutar desde el editor de Apps Script.');
}

function configurar() {
  soloDueno_();
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

const SEGUNDOS_CODIGO = 1800;   // el código por correo vale 30 minutos

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
  if (n >= 5) throw new Error('Has pedido demasiados códigos. Espera una hora y vuelve a intentarlo.');
  if (g >= 40) throw new Error('Hoy se han pedido demasiados códigos. Inténtalo mañana o avisa a la oficina.');
  // Si ya hay un código vigente se reenvía el mismo (así el correo anterior sigue valiendo); los fallos se conservan.
  let previo = null;
  try { previo = JSON.parse(cache.get('c:' + email) || 'null'); } catch (e) { previo = null; }
  const codigo = previo && previo.codigo ? String(previo.codigo) : String(Math.floor(100000 + Math.random() * 900000));
  cache.put('c:' + email, JSON.stringify({ codigo: codigo, fallos: previo && previo.fallos ? previo.fallos : 0 }), SEGUNDOS_CODIGO);
  cache.put(kn, String(n + 1), 3600);
  cache.put(kg, String(g + 1), 21600);
  enviarCorreo_({
    to: email,
    name: 'Partes LAV',
    subject: 'Tu código para la app Partes LAV: ' + codigo,
    body: 'Tu código para ' + (paraPin ? 'crear un PIN nuevo' : 'registrarte') + ' en la app Partes LAV es: ' + codigo +
      '\n\nCaduca en 30 minutos.\nSi no lo has pedido tú, ignora este correo.',
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
    if (o.fallos >= 5) cache.remove(k); else cache.put(k, JSON.stringify(o), SEGUNDOS_CODIGO);
    throw new Error(o.fallos >= 5 ? 'Demasiados intentos. Pide un código nuevo.' : 'El código no es correcto.');
  }
  if (consumir) cache.remove(k);
}

/**
 * Solo comprueba el código. Ya NO devuelve la lista de trabajadores: cualquiera con un Gmail podía
 * pedir un código a su correo y llevarse los nombres de todos. Ahora cada uno escribe el suyo (buscarNombre).
 * `nombres` va vacía para las apps de antes de la 0.18, que la esperan (al abrirse se actualizan solas).
 */
function verificarCodigo_(d) {
  comprobarCodigo_(email_(d.email), d.codigo, false);
  return { nombres: [] };
}

const MAX_BUSQUEDAS_NOMBRE = 15;  // por correo y hora: que no se pueda sacar la lista probando nombres

/** «José  Pérez» → ['jose', 'perez']: sin tildes, mayúsculas ni espacios de más. */
function palabras_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .split(/[^a-z0-9ñ]+/).filter(Boolean);
}

/**
 * Registro, paso 3: la persona escribe su nombre y al menos un apellido, en cualquier orden. Solo se
 * contesta si encaja exactamente con UNA persona de la lista (palabras enteras): así no se puede
 * sacar la lista probando letras. Devuelve el nombre tal como está en la lista.
 */
function buscarNombre_(d) {
  const email = email_(d.email);
  comprobarCodigo_(email, d.codigo, false);
  const buscadas = palabras_(d.texto);
  if (buscadas.length < 2) throw new Error('Escribe tu nombre y al menos un apellido, por ejemplo: Jose Bordetas.');
  const cache = CacheService.getScriptCache();
  const kb = 'b:' + email;
  const n = Number(cache.get(kb) || 0);
  if (n >= MAX_BUSQUEDAS_NOMBRE) throw new Error('Demasiados intentos. Espera una hora o habla con la oficina.');
  cache.put(kb, String(n + 1), 3600);
  const encajan = tabla_('Trabajadores').filas.map((t) => String(t.Nombre || '')).filter((nombre) => {
    const suyas = palabras_(nombre);
    // Palabra entera; o una inicial suelta (en la lista o escrita) que coincide con la primera letra de la otra:
    // «Jose L Bordetas» y «Jose Luis Bordetas» valen para «Jose Luis Bordetas Puig».
    return nombre && buscadas.every((p) => suyas.some((s) => s === p ||
      (s.length === 1 && p.charAt(0) === s) || (p.length === 1 && s.charAt(0) === p)));
  });
  if (!encajan.length) throw new Error('No te encontramos. Escribe nombre y un apellido (por ejemplo Jose Bordetas) o habla con la oficina.');
  if (encajan.length > 1) throw new Error('Hay más de una persona con ese nombre: añade el otro apellido.');
  const nombre = encajan[0];
  // Solo bloquea una cuenta ACTIVA: si alguien pide antes tu nombre, la oficina recibe las dos solicitudes y elige.
  if (tabla_('Usuarios').filas.some((u) => String(u.Nombre) === nombre && u.Estado === 'activo')) {
    throw new Error('Ese nombre ya tiene una cuenta. Habla con la oficina.');
  }
  return { nombre: nombre };
}

function registrar_(d) {
  const email = email_(d.email);
  const nombre = String(d.nombre || '').trim();
  const pin = String(d.pin || '');
  if (!/^\d{4,6}$/.test(pin)) throw new Error('El PIN tiene que tener de 4 a 6 cifras.');
  comprobarCodigo_(email, d.codigo, false);
  if (buscarUsuario_(email)) throw new Error('Este correo ya está registrado. Usa «Ya tengo cuenta».');
  if (!tabla_('Trabajadores').filas.some((t) => String(t.Nombre) === nombre)) throw new Error('Elige tu nombre de la lista.');
  if (tabla_('Usuarios').filas.some((u) => String(u.Nombre) === nombre && u.Estado === 'activo')) {
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
  const usuarios = tabla_('Usuarios').filas;
  const u = usuarios.find((f) => String(f.Email).toLowerCase() === email);
  const otras = u ? otrasConNombre_(usuarios, u) : [];
  const caduca = caducaNueva_();
  enviarCorreo_({
    to: admin,
    name: 'Partes LAV',
    subject: 'Registro en la app de partes: ' + nombre,
    body: nombre + ' (' + email + ') se ha registrado en la app de partes.\n\n' +
      (otras.length
        ? '⚠ Ya hay otra solicitud con este nombre: ' + otras.map((o) => o.Email + ' (' + o.Estado + ')').join(', ') +
          '. Aprueba solo la buena: al aprobar una, las demás pendientes pasan a rechazadas.\n\n'
        : '') +
      'Para aprobarlo o rechazarlo, abre este enlace (vale ' + DIAS_ENLACE + ' días, hasta el ' + fechaEnlace_(caduca) + '):\n' + urlRevision_(email, caduca) +
      '\n\nHasta que lo apruebes no podrá enviar partes.' +
      '\nPara darlo de baja más adelante, pide un enlace nuevo a quien administra la app.',
  });
}

const DIAS_ENLACE = 30;   // lo que vale el enlace de revisión desde que se crea
const ENLACE_CADUCADO = 'Este enlace ha caducado. Pide uno nuevo a quien administra la app.';

/**
 * Firma del enlace de revisión (desde v21): «caducidad.firma», con la caducidad dentro de lo firmado:
 * si se cambia la fecha a mano, deja de valer. La caducidad es una medianoche: el mismo día sale el mismo enlace.
 */
function firmaRevision_(email, caduca) {
  return caduca + '.' + firma_('revisar:' + email + ':' + caduca);
}

/** Caducidad de un enlace creado ahora: la medianoche (UTC) de dentro de DIAS_ENLACE días. */
function caducaNueva_() {
  return Math.ceil((Date.now() + DIAS_ENLACE * 86400000) / 86400000) * 86400000;
}

function urlRevision_(email, caduca) {
  caduca = caduca || caducaNueva_();
  return ScriptApp.getService().getUrl() + '?accion=revisar&email=' + encodeURIComponent(email) +
    '&firma=' + firmaRevision_(email, caduca);
}

/**
 * 'ok', 'caducado' o 'no-valido'. Los enlaces de antes de la v21 (firma sin fecha) solo sirven
 * mientras la cuenta está pendiente: así los correos de registro ya enviados no se quedan sin valer,
 * pero no sirven para dar de baja ni para reactivar.
 */
function enlaceValido_(email, firma, estado) {
  const f = String(firma || '');
  const m = /^(\d{1,15})\.[0-9a-f]{64}$/.exec(f);
  if (m) {
    if (f !== firmaRevision_(email, m[1])) return 'no-valido';
    return Date.now() < Number(m[1]) ? 'ok' : 'caducado';
  }
  if (f && f === firma_('revisar:' + email)) return estado === 'pendiente' ? 'ok' : 'caducado';
  return 'no-valido';
}

/** «dd/mm/aaaa» en que caduca el enlace; '' en los de antes de la v21. */
function fechaCaducidad_(firma) {
  const m = /^(\d{1,15})\./.exec(String(firma || ''));
  return m ? fechaEnlace_(Number(m[1])) : '';
}

/** Último día en que vale: la caducidad es una medianoche UTC, que en Madrid cae ya de madrugada del día siguiente. */
function fechaEnlace_(caduca) {
  return Utilities.formatDate(new Date(caduca - 3 * 3600000), ZONA, 'dd/MM/yyyy');
}

/** Las demás cuentas, no rechazadas, con el mismo nombre que u. */
function otrasConNombre_(usuarios, u) {
  return usuarios.filter((f) => f._fila !== u._fila && String(f.Nombre) === String(u.Nombre) && f.Estado !== 'rechazado');
}

/**
 * Para dar de baja a alguien o cuando el enlace del correo ha caducado: ejecutarla a mano en el editor
 * («Ejecutar» no pasa argumentos: sin correo saca el enlace de todas las cuentas, con su nombre
 * y estado) y abrir el enlace que sale en el registro de ejecución. Cada enlace vale DIAS_ENLACE días.
 * No devuelve nada: lo que devuelve una función pública le llega a quien la llame desde una página.
 */
function enlaceRevision(email) {
  soloDueno_();
  enlaceRevision_(email);
}

function enlaceRevision_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) {
    const lineas = tabla_('Usuarios').filas.map((u) =>
      u.Nombre + ' <' + u.Email + '> · ' + u.Estado + '\n' + urlRevision_(String(u.Email).toLowerCase()));
    Logger.log(lineas.join('\n\n'));
    return lineas.join('\n\n');
  }
  if (!buscarUsuario_(email)) throw new Error('No hay ninguna cuenta con ese correo: ' + email);
  const url = urlRevision_(email);
  Logger.log(url);
  return url;
}

/**
 * Llamada desde la página de revisión (pública: sin guion bajo). Al aprobar a alguien, las demás
 * solicitudes pendientes con su nombre pasan a rechazadas; si ya hay otra cuenta activa con ese
 * nombre, no deja (dos cuentas activas con el mismo nombre firmarían partes por la misma persona).
 */
function revisarRegistro(email, firma, decision) {
  email = String(email || '').toLowerCase();
  // Primero lo que se comprueba sin abrir la hoja; el estado de la cuenta, ya con el bloqueo.
  if (enlaceValido_(email, firma, 'pendiente') === 'no-valido') throw new Error('Enlace no válido.');
  if (decision !== 'activo' && decision !== 'rechazado') throw new Error('Decisión no válida.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const t = tabla_('Usuarios');
    const u = t.filas.find((f) => String(f.Email).toLowerCase() === email);
    if (!u) throw new Error('Ese registro no existe.');
    if (enlaceValido_(email, firma, String(u.Estado)) !== 'ok') throw new Error(ENLACE_CADUCADO);
    if (decision === 'activo') {
      const otras = otrasConNombre_(t.filas, u);
      const activa = otras.find((o) => o.Estado === 'activo');
      if (activa) throw new Error('Ya hay una cuenta activa con este nombre (' + activa.Email + '). Dala de baja antes.');
      otras.forEach((o) => escribir_(t, o._fila, { Estado: 'rechazado', Revisado: ahora_() }));
    }
    escribir_(t, u._fila, { Estado: decision, Revisado: ahora_() });
  } finally {
    lock.releaseLock();
  }
  return decision;
}

// ATENCIÓN: la usa también la app del almacén. No cambiar lo que recibe ni lo que devuelve sin avisar
// al compañero (hay una prueba «contrato almacén» en pruebas/pruebas.js que lo vigila).
function estado_(d) {
  const u = usuarioDeSesion_(d.token, false);
  return { estado: String(u.Estado), nombre: String(u.Nombre) };
}

// ATENCIÓN: la usa también la app del almacén. No cambiar lo que recibe ni lo que devuelve sin avisar
// al compañero (hay una prueba «contrato almacén» en pruebas/pruebas.js que lo vigila).
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

// ATENCIÓN: la usa también la app del almacén. No cambiar lo que recibe ni lo que devuelve sin avisar
// al compañero (hay una prueba «contrato almacén» en pruebas/pruebas.js que lo vigila).
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

const SESION_NO_VALIDA = 'Sesión no válida. Vuelve a entrar.';

/**
 * Token de sesión (desde v20): 64 cifras al azar + 64 de firma con la PIMIENTA. Para el móvil y
 * para el almacén sigue siendo un texto opaco. En la hoja solo se guarda su hash, como siempre.
 */
function crearSesion_(email) {
  const azar = sha256_(Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + Date.now());
  const token = azar + firma_('sesion:' + azar);
  hoja_('Sesiones').appendRow(['h' + sha256_(token), email, ahora_(), '']);
  return token;
}

/**
 * ¿Puede ser un token que dio este servidor? Sin bloqueo y sin leer la hoja Sesiones (salvo para
 * rehacer, como mucho cada 6 horas, la lista de tokens antiguos). Si dice que sí, usuarioDeSesion_
 * lo comprueba de verdad en la hoja.
 * Los tokens de antes de la v20 (64 cifras, sin firma) siguen valiendo: ya no se crean, así que su
 * lista solo encoge, y la limpieza de 180 días acabará borrándolos todos.
 */
function tokenPosible_(token) {
  const t = String(token || '');
  if (/^[0-9a-f]{128}$/.test(t)) return t.slice(64) === firma_('sesion:' + t.slice(0, 64));
  if (/^[0-9a-f]{64}$/.test(t)) {
    const lista = sesionesAntiguas_();
    return lista === null || lista.indexOf('|' + sha256_(t).slice(0, 16) + '|') >= 0;
  }
  return false;
}

/** Principio del hash de cada sesión de la hoja, como «|abc…|def…|». null = no cabe en la caché. */
function sesionesAntiguas_() {
  const cache = CacheService.getScriptCache();
  const guardada = cache.get('sesiones-antiguas');
  if (guardada) return guardada;
  const lista = '|' + tabla_('Sesiones').filas
    .map((f) => String(f.TokenHash).slice(1, 17)).filter(Boolean).join('|') + '|';
  try { cache.put('sesiones-antiguas', lista, 21600); } catch (x) { return null; }   // sin caché: se mira la hoja, como antes
  return lista;
}

function usuarioDeSesion_(token, exigirActivo) {
  if (!token) throw new Error(SESION_NO_VALIDA);
  const th = 'h' + sha256_(String(token));
  const sesiones = tabla_('Sesiones');
  const s = sesiones.filas.find((f) => f.TokenHash === th);
  if (!s) throw new Error(SESION_NO_VALIDA);
  const u = buscarUsuario_(String(s.Email).toLowerCase());
  if (!u) throw new Error(SESION_NO_VALIDA);
  if (exigirActivo && u.Estado !== 'activo') {
    throw new Error(u.Estado === 'pendiente'
      ? 'Tu registro aún no está aprobado por la oficina.'
      : 'Tu cuenta no está activa. Habla con la oficina.');
  }
  escribir_(sesiones, s._fila, { UltimoUso: ahora_() });
  return u;
}

/**
 * «Cerrar sesión» en el móvil: la sesión deja de valer también aquí. Si ya no estaba (repetición,
 * limpieza de 180 días), contesta «ok» igual. Va con el bloqueo: quitar una fila mueve las demás.
 */
function salir_(d) {
  const th = 'h' + sha256_(String(d.token || ''));
  const t = tabla_('Sesiones');
  const s = t.filas.find((f) => f.TokenHash === th);
  if (s) t.h.deleteRows(s._fila, 1);
  return {};
}

// ---------- Lista de la oficina ----------

function config_(d) {
  const u = usuarioDeSesion_(d.token, false);
  if (u.Estado === 'rechazado') throw new Error('Tu cuenta no está activa. Habla con la oficina.');
  // Pendiente de aprobar: la lista va vacía (nada de habilitaciones, empresas ni matrículas a quien
  // la oficina aún no conoce). Vacía y no null: las apps de antes de la 0.23.0 leen sus campos.
  // En cuanto la aprueban, la misma petición trae la lista completa.
  if (u.Estado !== 'activo') return { estado: String(u.Estado), nombre: String(u.Nombre), config: configVacia_() };
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
      versionServidor: VERSION_SERVIDOR,
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

/** La misma forma que la lista de config_, sin ningún dato de la oficina. */
function configVacia_() {
  return {
    formato: 'config-partes-lav', version: 1, versionServidor: VERSION_SERVIDOR,
    nombre: 'Lista de la oficina', fecha: '', destinatario: '',
    cabecera: { jefatura: '', ambito: '', empresa: '', lineaInfra: '', lineaSuper: '' },
    capataces: [], trabajadores: [], maquinas: [], aparatos: [], antiincendios: [],
    maquinasVia: [], personalMaquinaria: [], vehiculos: [], motivos: { infra: [], super: [] },
  };
}

/**
 * Número más alto que este capataz ya ha enviado de cada prefijo ({INF: 12, LOC: 3…}). Con él, un
 * móvil reinstalado sigue la numeración en vez de volver a la 0001 y pisar carpetas en Teams.
 *
 * Se guarda en las propiedades del script («ult:<correo>») y se pone al día en cada envío, para no
 * leer la hoja Envios entera, que no para de crecer. Si no está (la primera vez), se calcula una vez
 * desde Envios. Va una propiedad por capataz para que los envíos de dos capataces a la vez, que van
 * sin bloqueo, no se pisen: los de un mismo móvil salen de uno en uno.
 */
function ultimosNumeros_(email) {
  const e = String(email).toLowerCase();
  const guardado = props_().getProperty('ult:' + e);
  if (guardado) {
    try { return JSON.parse(guardado); } catch (x) { /* ilegible: se vuelve a calcular */ }
  }
  const ultimos = {};
  tabla_('Envios').filas.forEach((f) => {
    const m = /^([A-Z]+)-(\d+)$/.exec(String(f.Ref || ''));
    if (m && String(f.Email).toLowerCase() === e) ultimos[m[1]] = Math.max(ultimos[m[1]] || 0, Number(m[2]));
  });
  props_().setProperty('ult:' + e, JSON.stringify(ultimos));
  return ultimos;
}

/** Tras un envío: sube el número guardado si este es más alto (un rectificativo de uno viejo no lo baja). */
function apuntarUltimo_(email, ref) {
  const m = /^([A-Z]+)-(\d+)$/.exec(String(ref || ''));
  if (!m) return;
  const ultimos = ultimosNumeros_(email);
  if ((ultimos[m[1]] || 0) >= Number(m[2])) return;
  ultimos[m[1]] = Number(m[2]);
  props_().setProperty('ult:' + String(email).toLowerCase(), JSON.stringify(ultimos));
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
 *
 * Para no mandar nunca un parte dos veces, nada más salir el correo se deja la marca «ya enviado»
 * en la caché (6 horas). Así, aunque luego falle el apunte en Envios, el reintento no lo vuelve a
 * mandar. Pasadas esas horas lo encuentra en Envios (buscando solo ese identificador).
 */
function enviar_(d) {
  const envioId = String(d.envioId || '');
  if (!/^[0-9a-f-]{36}$/i.test(envioId)) throw new Error('Envío sin identificador.');
  const cache = CacheService.getScriptCache();
  const reserva = 'e:' + envioId;
  const hecho = 'h:' + envioId;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw ocupado_('El servidor está ocupado. Se reintentará.');
  let u, aj;
  try {
    u = usuarioDeSesion_(d.token, true);
    // Si la app reintenta un envío que ya llegó (p. ej. se cortó la cobertura al recibir
    // la respuesta), no se manda dos veces.
    const previo = cache.get(hecho) || recibidoEnEnvios_(envioId);
    if (previo) return { recibido: String(previo), repetido: true };
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
  // A partir de aquí el correo YA ha salido: nada puede devolver error, o la app lo reenviaría.
  try { cache.put(hecho, r.fecha, 21600); } catch (x) { /* sin caché: queda la reserva y Envios */ }
  const fila = [envioId, String(u.Email), String(u.Nombre), celda_(d.ref), celda_(r.asunto), String(r.bytes), r.fecha];
  let apuntado = false;
  for (let i = 0; i < 3 && !apuntado; i++) {
    try {
      if (i) Utilities.sleep(1000 * i);
      hoja_('Envios').appendRow(fila);
      apuntado = true;
    } catch (err) {
      if (i === 2) apuntarError_('envios', String(d.ref || '') + ' (' + envioId + ') no está en Envios: ' + String((err && err.message) || err));
    }
  }
  // Sin apunte, la reserva se alarga 6 horas: otra defensa más, además de la marca «ya enviado».
  if (apuntado) cache.remove(reserva);
  else try { cache.put(reserva, '1', 21600); } catch (x) { /* nada más que hacer */ }
  // El parte ya ha salido y está apuntado: si esto falla no se puede dar error (la app lo reenviaría).
  // Sin el número guardado, la próxima vez se vuelve a calcular desde Envios.
  try {
    apuntarUltimo_(u.Email, d.ref);
  } catch (err) {
    try { props_().deleteProperty('ult:' + String(u.Email).toLowerCase()); } catch (x) { /* nada más que hacer */ }
    apuntarError_('ultimos', String(d.ref || '') + ': ' + String((err && err.message) || err));
  }
  // Va lo último y nunca da error: el parte ya está en la oficina pase lo que pase con el portal.
  enviarAlPortal_(d, u, r.fecha);
  return { recibido: r.fecha };
}

/**
 * Fecha de recepción si ese envío ya está en Envios o en su archivo ('' si no). Busca solo ese
 * identificador, sin leer la hoja entera.
 */
function recibidoEnEnvios_(envioId) {
  const hojas = ['Envios', 'EnviosArchivo'];
  for (let i = 0; i < hojas.length; i++) {
    const h = hoja_(hojas[i]);
    const celda = h && h.createTextFinder(envioId).matchEntireCell(true).findNext();
    if (celda) return String(h.getRange(celda.getRow(), 7).getValue() || 'sí');
  }
  return '';
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
  if (!archivos.length || archivos.length > MAX_ARCHIVOS) throw new Error('El parte no trae los archivos esperados.');
  let bytes = 0;
  const adjuntos = archivos.map((a) => {
    const nombre = String(a.nombre || 'archivo').replace(/[^\w.\-]/g, '_');
    // Solo los tipos que manda la app, y con el tipo que pone el servidor (no el que diga el móvil):
    // este correo llega a la oficina y Power Automate lo sube a Teams.
    const ext = (/\.([a-z0-9]+)$/i.exec(nombre) || [])[1];
    const tipo = ext && Object.prototype.hasOwnProperty.call(TIPOS_ADJUNTO, ext.toLowerCase()) ? TIPOS_ADJUNTO[ext.toLowerCase()] : '';
    if (!tipo) throw new Error('El parte trae un archivo que no se admite: ' + nombre);
    const blob = a.base64 != null
      ? Utilities.newBlob(Utilities.base64Decode(String(a.base64)), tipo, nombre)
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
  const drp = adjuntos.filter((b) => /\.drp$/i.test(String(b.getName())));   // registros de la bateadora, tal cual
  enviarCorreo_({
    to: para,
    name: 'Partes LAV',
    replyTo: String(u.Email),
    subject: asunto,
    body: cuerpo + '\n\nCopia: PDF del parte' + (jpgs.length ? ' y ' + jpgs.length + ' foto(s) sueltas en .jpg.' : ' (sin fotos).') +
      (drp.length ? ' Y ' + drp.length + ' registro(s) DRP.' : ''),
    attachments: pdf.concat(jpgs, drp),
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
    h.appendRow([ahora_(), ahora_(), 'servidor', '', tipo, celda_(String(mensaje).slice(0, 200))]);
  } catch (e) { /* sin hoja: nada más que hacer */ }
}

// ---------- Portal de la UTE ----------

// La dirección y la clave del portal están en las propiedades del script (PORTAL_URL y PORTAL_CLAVE),
// no aquí: este archivo está en un repositorio público. Sin ellas no se manda nada al portal.
const PORTAL_LOTE = 200;   // partes por envío que admite el portal
const MAX_CELDA = 49000;   // Google admite 50.000 caracteres por celda

/**
 * Manda al portal los datos del parte: el mismo Datos_ que guarda Power Automate (sin fotos), más
 * quién lo envió y cuándo llegó («servidor»). El portal lo guarda por su «id» y, si llega otra vez,
 * lo actualiza. Un rectificativo lleva otro «id» y en «rectificaA.id» el del parte al que sustituye.
 * El parte ya ha salido a la oficina: esto nunca lanza error. Si el portal falla, el parte queda en la
 * hoja PortalPendientes y se reintenta con el resumen diario (o a mano con reintentarPortal).
 */
function enviarAlPortal_(d, u, recibido) {
  const ref = String(d.ref || '');
  try {
    if (!portal_()) return;
    const a = (Array.isArray(d.archivos) ? d.archivos : []).find((x) => String(x.nombre || '').indexOf('Datos_') === 0);
    if (!a || a.texto == null) throw new Error('el parte no trae Datos_');
    const datos = JSON.parse(String(a.texto));
    datos.servidor = { email: String(u.Email), nombre: String(u.Nombre), recibido: recibido, envioId: String(d.envioId) };
    const texto = JSON.stringify(datos);
    try {
      mandarAlPortal_(texto);
    } catch (err) {
      const motivo = String((err && err.message) || err);
      if (texto.length > MAX_CELDA) {
        apuntarError_('portal', ref + ': ' + motivo + ' · no cabe en PortalPendientes: mandarlo con los atrasados');
      } else {
        asegurarHoja_('PortalPendientes', ['Recibido', 'Ref', 'Datos']).appendRow([recibido, celda_(ref), texto]);
        apuntarError_('portal', ref + ': ' + motivo + ' · queda en PortalPendientes');
      }
    }
  } catch (err) {
    apuntarError_('portal', ref + ': ' + String((err && err.message) || err));
  }
}

/** { url, clave } del portal, o null si no está configurado. */
function portal_() {
  const p = props_();
  const url = p.getProperty('PORTAL_URL');
  const clave = p.getProperty('PORTAL_CLAVE');
  return url && clave ? { url: url, clave: clave } : null;
}

/** Manda al portal un cuerpo JSON ya en texto. Lanza error si el portal no contesta «ok». */
function mandarAlPortal_(cuerpo) {
  const c = portal_();
  const r = UrlFetchApp.fetch(c.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-clave': c.clave },
    payload: cuerpo,
    muteHttpExceptions: true,
  });
  const texto = r.getContentText();
  let j = null;
  try { j = JSON.parse(texto); } catch (e) { /* no es JSON: se trata como fallo */ }
  if (r.getResponseCode() >= 300 || !j || !j.ok) {
    throw new Error('el portal contesta ' + r.getResponseCode() + ': ' + String((j && j.error) || texto).slice(0, 120));
  }
}

/**
 * Vuelve a mandar al portal los partes de PortalPendientes, en lotes de PORTAL_LOTE, y quita los que
 * han entrado. Lo llama el resumen diario; también se puede ejecutar a mano. Devuelve cuántos quedan.
 * Los envíos nuevos se apuntan siempre al final, así que se quitan solo las filas de arriba.
 */
function reintentarPortal(e) {
  soloDueno_(e);
  return reintentarPortal_();
}

function reintentarPortal_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const t = tabla_('PortalPendientes');
    if (!t.h || !t.filas.length || !portal_()) return t.filas.length;
    let hechas = 0;
    while (hechas < t.filas.length) {
      const lote = t.filas.slice(hechas, hechas + PORTAL_LOTE);
      try {
        mandarAlPortal_('{"partes":[' + lote.map((f) => String(f.Datos)).join(',') + ']}');
      } catch (err) {
        apuntarError_('portal', 'reintento: ' + String((err && err.message) || err));
        break;
      }
      hechas += lote.length;
    }
    if (hechas) t.h.deleteRows(2, hechas);
    Logger.log('Mandados al portal: ' + hechas + ' · quedan: ' + (t.filas.length - hechas));
    return t.filas.length - hechas;
  } finally {
    lock.releaseLock();
  }
}

// ---------- Copia de seguridad ----------

const COPIAS_A_GUARDAR = 8;   // semanas
const HORAS_ENTRE_COPIAS = 6;

/**
 * Copia la hoja de datos en la carpeta «Partes LAV · Copias» del Drive de la cuenta y deja solo
 * las últimas COPIAS_A_GUARDAR (las demás van a la papelera, de donde Google las borra a los 30 días).
 * La llama el activador semanal; también se puede ejecutar a mano.
 * Como mucho una cada HORAS_ENTRE_COPIAS: repetida muchas veces seguidas mandaría a la papelera las
 * copias buenas de las semanas anteriores.
 */
function copiaSeguridad(e) {
  soloDueno_(e, 'copiaSeguridad');
  copiaSeguridad_();
}

function copiaSeguridad_() {
  const ultima = Number(props_().getProperty('ULTIMA_COPIA') || 0);
  if (Date.now() - ultima < HORAS_ENTRE_COPIAS * 3600000) {
    Logger.log('Ya hay una copia de hace menos de ' + HORAS_ENTRE_COPIAS + ' horas: no se hace otra.');
    return;
  }
  props_().setProperty('ULTIMA_COPIA', String(Date.now()));
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
  // Con la copia ya hecha, se archivan los envíos viejos. Si falla, la copia vale igual.
  try {
    Logger.log('Envíos archivados: ' + archivarEnvios_());
  } catch (err) {
    apuntarError_('archivo', String((err && err.message) || err));
  }
}

// ---------- Archivo de envíos ----------

const MESES_ENVIOS = 12;   // en la hoja Envios se quedan solo los envíos de este tiempo

/**
 * Pasa a la hoja «EnviosArchivo» los envíos de hace más de MESES_ENVIOS meses, para que Envios no
 * crezca sin fin. Se ejecuta solo cada lunes, tras la copia de seguridad; también se puede a mano.
 * Antes se aseguran los últimos números de cada capataz, que la primera vez se calculan desde Envios.
 * Las filas viejas están arriba (se apuntan por orden de llegada) y se quitan con deleteRows, sin
 * reescribir la hoja: así no se pierde un envío que se esté apuntando a la vez (eso va sin bloqueo).
 * Devuelve cuántos ha archivado.
 */
function archivarEnvios(e) {
  soloDueno_(e);
  return archivarEnvios_();
}

function archivarEnvios_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const t = tabla_('Envios');
    if (!t.h || !t.filas.length) return 0;
    const correos = {};
    t.filas.forEach((f) => { if (f.Email) correos[String(f.Email).toLowerCase()] = true; });
    Object.keys(correos).forEach((e) => ultimosNumeros_(e));
    const limite = new Date();
    limite.setMonth(limite.getMonth() - MESES_ENVIOS);
    let n = 0;
    while (n < t.filas.length && new Date(String(t.filas[n].Recibido)).getTime() < limite.getTime()) n++;
    if (!n) return 0;
    const archivo = asegurarHoja_('EnviosArchivo', t.cab);
    const viejas = t.filas.slice(0, n).map((f) => t.cab.map((c) => String(f[c] == null ? '' : f[c])));
    archivo.getRange(archivo.getLastRow() + 1, 1, n, t.cab.length).setValues(viejas);
    t.h.deleteRows(2, n);
    return n;
  } finally {
    lock.releaseLock();
  }
}

/** Se ejecuta una vez a mano: crea el activador que hace la copia cada lunes a las 3 de la madrugada. */
function activarCopiaSemanal() {
  soloDueno_();
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
function resumenDiario(e) {
  soloDueno_(e, 'resumenDiario');
  resumenDiario_();
}

function resumenDiario_() {
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
  if (portal_()) {
    let pendientes;
    try {
      pendientes = reintentarPortal_();
    } catch (err) {
      pendientes = 'no se ha podido comprobar (' + ((err && err.message) || err) + ')';
    }
    if (pendientes) cuerpo += '\n\nPartes pendientes de mandar al portal de la UTE: ' + pendientes +
      ' · se reintenta cada día con este resumen; detalle en la hoja «Errores».';
  }
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
  soloDueno_();
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
    filas.push([recibido, celda_(String(f.fecha || '').slice(0, 25)), usuario, celda_(String(f.version || '').slice(0, 10)),
      celda_(String(f.tipo || '').slice(0, 20)), celda_(String(f.mensaje || '').slice(0, 200))]);
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

/**
 * Texto que viene del móvil, listo para una celda: si empieza por = + - o @, Sheets lo tomaría por
 * una fórmula al abrir la hoja; con el apóstrofo delante queda como texto.
 */
function celda_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function props_() { return PropertiesService.getScriptProperties(); }

// La hoja se abre una sola vez por petición (abrirla es lo más lento de Google). No se queda vieja:
// Apps Script empieza cada petición y cada activador desde cero, con esta variable vacía.
let libroAbierto_ = null;
function libro_() {
  if (!libroAbierto_) libroAbierto_ = SpreadsheetApp.openById(props_().getProperty('HOJA_ID'));
  return libroAbierto_;
}
function hoja_(nombre) { return libro_().getSheetByName(nombre); }
function ahora_() { return Utilities.formatDate(new Date(), ZONA, "yyyy-MM-dd'T'HH:mm:ssXXX"); }
function hex_(bytes) { return bytes.map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''); }
function sha256_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function firma_(s) { return hex_(Utilities.computeHmacSha256Signature(s, props_().getProperty('PIMIENTA'), Utilities.Charset.UTF_8)); }

function email_(s) {
  const e = String(s || '').trim().toLowerCase();
  // Empieza por letra o número: un correo que empiece por + o - se tomaría por fórmula en la hoja Usuarios.
  if (!/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(e)) throw new Error('Ese correo no es válido.');
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
  .nota { color: #555; font-size: 14px; }
  .aviso { background: #fff4e5; border-left: 4px solid #b54708; padding: 10px 12px; }
</style></head><body>
<h2>Registro en la app de partes</h2>
<p><strong><?= nombre ?></strong><br><?= email ?></p>
<p id="estado">Estado actual: <strong><?= estado === 'rechazado' ? 'de baja / rechazado' : estado ?></strong></p>
<? if (otras.length) { ?>
<p class="aviso">⚠ Hay otra solicitud con este nombre:<br>
<? for (var i = 0; i < otras.length; i++) { ?><?= otras[i] ?><br><? } ?>
Aprueba solo la buena: al aprobar una, las demás pendientes pasan a rechazadas.</p>
<? } ?>
<? if (estado === 'pendiente') { ?>
<button class="si" onclick="decidir(this, 'activo')">Aprobar</button>
<button class="no" onclick="decidir(this, 'rechazado')">Rechazar</button>
<? } else if (estado === 'activo') { ?>
<button class="no" onclick="decidir(this, 'rechazado')">Dar de baja</button>
<p class="nota">Ya no podrá entrar ni enviar partes. Lo que ya envió se queda en la oficina. Se puede volver a activar con este mismo enlace mientras no caduque.</p>
<? } else { ?>
<button class="si" onclick="decidir(this, 'activo')">Volver a activar</button>
<? } ?>
<? if (caduca) { ?><p class="nota">Este enlace vale hasta el <?= caduca ?>.</p><? } ?>
<script>
  // Dos toques para decidir: un toque sin querer no cambia nada. El segundo solo cuenta si llega
  // medio segundo después: un solo toque puede llegar como dos clics seguidos (visto en la v14).
  function decidir(boton, d) {
    var primero = Number(boton.dataset.seguro || 0);
    if (!primero || Date.now() - primero < 500) {
      if (!primero) boton.dataset.seguro = String(Date.now());
      boton.textContent = 'Pulsa otra vez para confirmar';
      return;
    }
    var el = document.getElementById('estado');
    el.textContent = 'Guardando…';
    document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    google.script.run
      .withSuccessHandler(function (r) {
        el.innerHTML = 'Hecho: <strong>' + (r === 'activo' ? 'activo (puede entrar y enviar)' : 'de baja / rechazado') + '</strong>.' +
          (r === 'activo' && <?!= JSON.stringify(hayPendientes) ?> ? ' Las otras solicitudes pendientes con este nombre han pasado a rechazadas.' : '');
        document.querySelectorAll('button').forEach(function (b) { b.remove(); });
      })
      .withFailureHandler(function (e) {
        el.textContent = 'Error: ' + e.message;
        document.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
      })
      .revisarRegistro(<?!= JSON.stringify(email) ?>, <?!= JSON.stringify(firma) ?>, d);
  }
</script>
</body></html>`;
