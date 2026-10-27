// Pantalla de envío de un parte cerrado: a la oficina por el servidor (con cola si no hay
// cobertura) o, como alternativa, por Gmail; y la corrección con una revisión nueva.

import * as db from './db.js';
import { prepararEnvio, compartir } from './envio.js';
import { generarPDF } from './pdf.js';
import { quitarFotosQueFaltan } from './modelo.js';
import { procesarSalida } from './salida.js';
import { esc, uuid, isoLocal, fmtFecha, fmtFechaHora, toast, blobABase64, FORMATO1 } from './util.js';
import { estado, ir, render, guardarYa, registrarSync } from './estado.js';
import { cabeceraParte, refParte } from './campos.js';
import { ultimoEnvio, textoCuenta } from './vista-inicio.js';
import { APP_VERSION } from './app.js';

// ---------- Envío ----------

export function vEnvio() {
  if (estado.perfil && estado.perfil.token) return vEnvioServidor();
  return vEnvioGmail();
}

export function resumenEnvio(p) {
  const envios = (p.envios || []).map((x) => (typeof x === 'string' ? fmtFechaHora(x) : fmtFechaHora(x.recibido || x.fecha)));
  return `
      <p>Jornada del ${fmtFecha(p.fecha)}${p.nocturna ? ' (nocturna)' : ''} · ${textoCuenta(p)} · ${p.personal.length} persona(s)${(p.formato1 || []).length ? ` · ${esc(FORMATO1.toLowerCase())}: ${p.formato1.length} foto(s)` : ''}</p>
      <p><small>Cerrado en el móvil: ${fmtFechaHora(p.cierre)}${envios.length ? `<br>Envíos: ${envios.join(', ')}` : ''}</small></p>
      ${p.fotosBorradas ? `<p class="nota">Las fotos se borraron de este móvil el ${fmtFechaHora(p.fotosBorradas)} para dejar sitio (la oficina las tiene). El PDF sale sin el anexo de fotos.</p>` : ''}`;
}

export function seccionCorregir() {
  return `
    <section class="tarjeta">
      <h2>¿Hay algo mal?</h2>
      <p class="nota">Puedes corregirlo: se crea una copia para editar y, al enviarla, la oficina guarda las dos versiones.</p>
      <button class="btn secundario" data-action="corregir">Corregir el parte</button>
    </section>`;
}

export function vEnvioServidor() {
  const p = estado.parte;
  const e = estado.envio || {};
  let tarjeta;
  if (p.estado === 'enviado') {
    tarjeta = `
    <section class="tarjeta ok">
      <h2>Recibido en la oficina ✓</h2>
      <p><strong>${fmtFechaHora(p.recibido || ultimoEnvio(p))}</strong></p>
      ${resumenEnvio(p)}
    </section>`;
  } else if (p.estado === 'en-cola') {
    tarjeta = `
    <section class="tarjeta pendiente">
      <h2>${p.errorEnvio ? 'No se ha podido enviar' : 'Enviando…'}</h2>
      <p>${p.errorEnvio ? esc(p.errorEnvio) : 'Si no hay cobertura, se enviará solo en cuanto vuelva, aunque cierres la app.'}</p>
      ${resumenEnvio(p)}
      <button class="btn primario" data-action="reintentar-salida">Intentarlo ahora</button>
    </section>`;
  } else {
    tarjeta = `
    <section class="tarjeta pendiente">
      <h2>Cerrado · falta enviarlo</h2>
      ${resumenEnvio(p)}
      ${e.error ? `<p class="error">${esc(e.error)}</p><button class="btn secundario" data-action="reintentar-envio">Reintentar</button>` : ''}
      <button class="btn primario grande" data-action="enviar" ${e.listo ? '' : 'disabled'}>${e.listo ? 'Enviar a la oficina' : (e.error ? 'No se ha podido preparar' : 'Preparando…')}</button>
    </section>`;
  }
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido">
    ${tarjeta}
    <section class="tarjeta">
      <button class="btn secundario" data-action="ver-pdf" ${e.listo ? '' : 'disabled'}>Ver el PDF</button>
      ${p.estado !== 'enviado' ? `<button class="btn enlace" data-action="enviar-gmail" ${e.listo ? '' : 'disabled'}>¿No funciona el envío? Mandarlo por Gmail</button>` : ''}
    </section>
    ${seccionCorregir()}
  </main>`;
}

export async function enviarServidor() {
  const p = estado.parte;
  const e = estado.envio;
  if (!e || !e.listo) return;
  const archivos = [];
  for (const f of e.archivos) {
    if (f.type === 'application/pdf') archivos.push({ nombre: f.name, tipo: f.type, base64: await blobABase64(f) });
    else archivos.push({ nombre: f.name, tipo: 'text/plain', texto: await f.text() });
  }
  await db.putSalida({ id: uuid(), parteId: p.id, creado: isoLocal(), datos: { ref: p.ref, asunto: e.asunto, cuerpo: e.cuerpo, archivos } });
  p.estado = 'en-cola';
  delete p.errorEnvio;
  await guardarYa();
  render();
  registrarSync();
  await procesarYMostrar(p.id);
}

/** Procesa la cola y avisa de cómo ha ido con el parte abierto. */
export async function procesarYMostrar(parteId) {
  await procesarSalida();
  const p = await db.getParte(parteId);
  if (p && estado.parte && estado.parte.id === parteId) {
    estado.parte = p;
    render();
    if (p.estado === 'enviado') toast('Recibido en la oficina ✓', 4000);
    else if (p.errorEnvio) toast(`No se ha podido enviar: ${p.errorEnvio}`, 6000);
    else toast('Sin cobertura: se enviará solo en cuanto vuelva.', 5000);
  }
}

/** Envío alternativo con Gmail. Si estaba en la cola automática, lo quita para no mandarlo dos veces. */
export async function enviarPorGmail() {
  const p = estado.parte;
  const cola = (await db.listarSalida()).filter((x) => x.parteId === p.id);
  if (cola.length && !confirm('Se quitará de la cola de envío automático y lo mandarás tú con Gmail. ¿Seguir?')) return;
  for (const x of cola) await db.borrarSalida(x.id);
  if (cola.length) { p.estado = 'cerrado'; delete p.errorEnvio; await guardarYa(); }
  await enviar();
}

export function vEnvioGmail() {
  const p = estado.parte;
  const e = estado.envio || {};
  const dest = (estado.config && estado.config.destinatario) || '';
  const enviado = p.estado === 'enviado';
  return `
  ${cabeceraParte('ir-inicio', 'Inicio', refParte(p))}
  <main class="contenido">
    <section class="tarjeta ${enviado ? 'ok' : 'pendiente'}">
      <h2>${enviado ? 'Enviado ✓' : 'Cerrado · falta enviarlo'}</h2>
      ${resumenEnvio(p)}
    </section>

    ${p.fotosBorradas ? `<section class="tarjeta">
      <button class="btn secundario" data-action="ver-pdf" ${e.listo ? '' : 'disabled'}>Ver el PDF</button>
    </section>` : `<section class="tarjeta">
      <h2>${enviado ? 'Volver a enviarlo' : 'Cómo enviarlo'}</h2>
      <ol class="pasos">
        <li>Pulsa <strong>Enviar por correo</strong>.</li>
        <li>Elige <strong>Gmail</strong>.</li>
        <li>En «Para» escribe ${dest ? `<strong>${esc(dest)}</strong> (ya está copiada: mantén pulsado y pega)` : 'la dirección de correo de la oficina (en pruebas, tu propio correo de Rover)'}.</li>
        <li>Pulsa enviar ➤. Si no hay cobertura, Gmail lo mandará solo cuando vuelva.</li>
      </ol>
      ${e.error ? `<p class="error">${esc(e.error)}</p><button class="btn secundario" data-action="reintentar-envio">Reintentar</button>` : ''}
      <button class="btn primario grande" data-action="enviar" ${e.listo ? '' : 'disabled'}>${e.listo ? 'Enviar por correo' : (e.error ? 'No se ha podido preparar' : 'Preparando…')}</button>
      <button class="btn secundario" data-action="ver-pdf" ${e.listo ? '' : 'disabled'}>Ver el PDF</button>
    </section>`}
    ${seccionCorregir()}
  </main>`;
}

export async function prepararEnvioActual() {
  const p = estado.parte;
  estado.envio = { listo: false };
  render();
  try {
    // Sin fotos en el móvil ya no se puede volver a mandar: solo se puede ver el PDF, sin anexo.
    const r = p.fotosBorradas ? { pdf: await generarPDF(p, estado.config, APP_VERSION) } : await prepararEnvio(p, estado.config, async (id) => {
      const f = await db.getFoto(id);
      return f && f.blob;
    }, APP_VERSION);
    if (estado.parte !== p) return;
    estado.envio = { listo: true, ...r };
  } catch (e) {
    console.error(e);
    if (estado.parte !== p) return;
    estado.envio = { listo: false, error: e.message };
  }
  if (estado.vista === 'envio') render();
}

export async function enviar() {
  const p = estado.parte;
  const e = estado.envio;
  if (!e || !e.listo) return;
  const dest = estado.config && estado.config.destinatario;
  if (dest && navigator.clipboard) { try { await navigator.clipboard.writeText(dest); } catch { /* sin portapapeles */ } }
  try {
    const modo = await compartir(e);
    if (modo === 'compartido') {
      p.envios = (p.envios || []).concat([isoLocal()]);
      p.estado = 'enviado';
      await guardarYa();
      render();
      toast('Listo. Comprueba que Gmail lo ha enviado.', 4000);
    } else {
      toast('Este dispositivo no puede compartir: se han descargado los archivos.', 4000);
    }
  } catch (err) {
    if (err && err.name === 'AbortError') toast('Envío cancelado');
    else toast(`No se ha podido compartir: ${err.message}`, 5000);
  }
}

export async function corregir() {
  const p = estado.parte;
  if (!confirm('Se creará una copia para corregir. El parte ya cerrado no se borra. ¿Seguir?')) return;
  const nuevo = structuredClone(p);
  Object.assign(nuevo, {
    id: uuid(), rev: p.rev + 1, rectificaA: { id: p.id, rev: p.rev, cierre: p.cierre },
    estado: 'borrador', cierre: null, envios: [], creado: isoLocal(),
  });
  delete nuevo.recibido;
  delete nuevo.errorEnvio;
  // Las fotos que sigan en el móvil se copian; las borradas por antiguas se quitan del parte nuevo
  // y la app pedirá fotos nuevas al cerrarlo.
  const existe = new Set();
  for (const f of [...nuevo.trabajos.flatMap((t) => t.fotos), ...(nuevo.formato1 || [])]) {
    const reg = await db.getFoto(f.id);
    if (!reg) continue;
    const id = uuid();
    await db.putFoto({ id, parteId: nuevo.id, blob: reg.blob });
    f.id = id;
    existe.add(id);
  }
  const quitadas = quitarFotosQueFaltan(nuevo, existe);
  delete nuevo.fotosBorradas;
  estado.parte = nuevo;
  await guardarYa();
  ir('parte');
  if (quitadas) toast(`Las fotos de este parte ya no estaban en el móvil (${quitadas}). Haz o elige fotos nuevas.`, 6000);
}
