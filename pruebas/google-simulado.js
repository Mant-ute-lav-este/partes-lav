// Google simulado en memoria para probar servidor/Code.gs sin tocar el servidor real:
// hoja de cálculo, caché, propiedades, bloqueo y correo. Solo lo que usa Code.gs.

export async function cargarServidor() {
  const codigo = await fetch('../servidor/Code.gs', { cache: 'no-store' }).then((r) => r.text());
  return () => crearEntorno(codigo);
}

function crearEntorno(codigo) {
  const hojas = {};
  const props = {};
  const cache = {};
  const correos = [];
  const portal = [];   // peticiones al portal de la UTE (UrlFetchApp)
  let bloqueado = false;
  let aperturas = 0;   // veces que se abre la hoja (openById)
  const g = {};

  const hoja = () => {
    const d = [];
    const h = {
      _d: d,
      _lecturas: 0,   // veces que se ha leído la hoja entera
      getDataRange: () => ({ getValues: () => { h._lecturas++; return d.map((r) => r.slice()); } }),
      appendRow: (r) => d.push(r.map(String)),
      getLastRow: () => d.length,
      getMaxRows: () => Math.max(d.length, 1000),
      getMaxColumns: () => 26,
      getLastColumn: () => Math.max(0, ...d.map((r) => r.length)),
      setFrozenRows: () => {},
      deleteRows: (desde, n) => { d.splice(desde - 1, n); },
      createTextFinder: (texto) => {
        const f = {
          matchEntireCell: () => f,
          findNext: () => {
            const i = d.findIndex((fila) => fila.some((v) => String(v) === String(texto)));
            return i < 0 ? null : { getRow: () => i + 1 };
          },
        };
        return f;
      },
      getRange: (r, c, nr = 1, nc = 1) => ({
        getValue: () => ((d[r - 1] || [])[c - 1] ?? ''),
        setNumberFormat: () => {},
        setValue: (v) => { while (d.length < r) d.push([]); d[r - 1][c - 1] = String(v); },
        setValues: (vals) => vals.forEach((fila, i) => fila.forEach((v, j) => {
          while (d.length < r + i) d.push([]);
          d[r - 1 + i][c - 1 + j] = v;
        })),
        clearContent: () => {
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (d[r - 1 + i]) d[r - 1 + i][c - 1 + j] = '';
        },
      }),
    };
    return h;
  };
  const libro = {
    getSheetByName: (n) => hojas[n] || null,
    insertSheet: (n) => (hojas[n] = hoja()),
    getSheets: () => Object.values(hojas),
    deleteSheet: () => {},
    getUrl: () => 'libro-simulado',
    getId: () => 'HOJA',
  };
  // Resúmenes falsos pero deterministas: basta con que distintas entradas den distinto resultado.
  const bytesDe = (s) => {
    let h = 2166136261;
    for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return Array.from({ length: 32 }, (_, i) => (h >>> (i % 24)) & 255);
  };
  const p2 = (n) => String(n).padStart(2, '0');
  Object.assign(g, {
    SpreadsheetApp: { openById: () => { aperturas++; return libro; }, create: () => libro },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (bloqueado) return false; bloqueado = true; return true; },
        waitLock: () => { if (bloqueado) throw new Error('bloqueo ocupado'); bloqueado = true; },
        releaseLock: () => { bloqueado = false; },
      }),
    },
    Utilities: {
      formatDate: (d, z, f) => {
        const Y = d.getFullYear(); const M = p2(d.getMonth() + 1); const D = p2(d.getDate());
        if (f === 'yyyyMMdd') return `${Y}${M}${D}`;
        if (f === 'yyyy-MM-dd') return `${Y}-${M}-${D}`;
        if (f === 'dd/MM/yyyy') return `${D}/${M}/${Y}`;
        return `${Y}-${M}-${D}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}+02:00`;
      },
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      computeDigest: (a, s) => bytesDe('d' + s),
      computeHmacSha256Signature: (s, k) => bytesDe('h' + k + s),
      base64Decode: (b) => Array.from(atob(b), (c) => c.charCodeAt(0)),
      newBlob: (bytes, tipo, nombre) => ({
        getBytes: () => (typeof bytes === 'string' ? Array.from(bytes) : bytes),
        getName: () => nombre, getContentType: () => tipo,
      }),
      DigestAlgorithm: {}, Charset: {},
    },
    MailApp: {
      sendEmail: (o) => { if (g.alEnviarCorreo) g.alEnviarCorreo(o); correos.push(o); },
      getRemainingDailyQuota: () => 100 - correos.length,
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        portal.push({ url, o });
        const r = g.alPortal ? g.alPortal(url, o) : { codigo: 200, texto: '{"ok":true}' };
        return { getResponseCode: () => r.codigo, getContentText: () => r.texto };
      },
    },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: {} },
    HtmlService: { createHtmlOutput: (html) => ({ html }) }, ScriptApp: { getService: () => ({ getUrl: () => 'https://servidor.simulado/exec' }) },
    Logger: { log: () => {} }, DriveApp: {},
  });
  const nombres = Object.keys(g);
  const s = new Function(...nombres, `${codigo}
    return { doPost, doGet, VERSION_SERVIDOR, configurar, limpiarSesiones_, resumenDiario, crearSesion_, tabla_, enviarCorreo_, archivarEnvios, revisarRegistro, enlaceRevision, reintentarPortal };`)(...nombres.map((n) => g[n]));
  const post = (o) => JSON.parse(s.doPost({ postData: { contents: JSON.stringify(o) } }));
  return { s, post, g, hojas, props, cache, correos, portal, bloqueado: () => bloqueado, aperturas: () => aperturas };
}
