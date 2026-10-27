// Registros DRP en el parte de la bateadora: el apartado opcional, y añadir o quitar archivos.
// Cada archivo se guarda en la tabla «fotos» (con el parteId) para que se borre con el parte.

import * as db from './db.js';
import { esc, uuid, isoLocal, toast, MAX_DRP, MAX_DRP_BYTES } from './util.js';
import { admitirDrp, textoMotivoDrp, leerNombreDrp, tamTexto } from './drp.js';
import { estado, render, guardarYa } from './estado.js';

/** `bateadora` falso: se cambió la máquina con DRP ya añadidos; se enseñan solo para poder quitarlos. */
export function seccionDrp(p, bateadora = true) {
  const fs = p.drp || [];
  const lleno = fs.length >= MAX_DRP;
  return `
    <section class="tarjeta">
      <h2>Registros DRP <span class="contador">${fs.length}</span></h2>
      ${bateadora ? `<p class="nota">Opcional. Añade los archivos .drp que hayas bajado de la bateadora (hasta ${MAX_DRP}, ${Math.round(MAX_DRP_BYTES / 1048576)} MB en total).</p>
      <input type="file" id="in-drp" multiple hidden>
      <button class="btn secundario" data-action="anadir-drp" ${lleno ? 'disabled' : ''}>📎 Añadir archivos DRP</button>`
    : '<p class="falta">La máquina ya no es una bateadora: quita estos archivos o se enviarán con el parte.</p>'}
      ${fs.map((x) => {
    const n = leerNombreDrp(x.nombre);
    return `
      <div class="fila-equipo">
        <div class="equipo-campos"><strong>${esc(x.nombre)}</strong>
          <small>${n ? `Vía ${esc(n.via)} · PK ${esc(n.pkInicio)} → ${esc(n.pkFin)} · ` : ''}${tamTexto(x.tam)}</small></div>
        <button class="btn-quitar" data-action="quitar-drp" data-id="${esc(x.id)}" aria-label="Quitar ${esc(x.nombre)}">✕</button>
      </div>`;
  }).join('')}
    </section>`;
}

export async function anadirDrp(archivos) {
  const p = estado.parte;
  if (!p.drp) p.drp = [];
  const { ok, rechazados } = admitirDrp(p.drp, [...archivos]);
  for (const f of ok) {
    const id = uuid();
    try {
      await db.putFoto({ id, parteId: p.id, blob: f });
    } catch (e) {
      console.error(e);
      toast(e && e.name === 'QuotaExceededError' ? 'No hay espacio en el móvil para guardar el archivo. Libera espacio.' : `No se ha podido guardar ${f.name}.`, 5000);
      continue;
    }
    p.drp.push({ id, nombre: f.name, tam: f.size, anadido: isoLocal() });
  }
  await guardarYa();
  render();
  if (rechazados.length) {
    const aviso = rechazados.slice(0, 2).map((r) => `${r.nombre}: ${textoMotivoDrp(r.motivo)}`).join('. ');
    toast(`${ok.length ? `${ok.length} añadido(s). ` : ''}No se ha añadido ${rechazados.length}: ${aviso}.`, 7000);
  } else if (ok.length) {
    toast(ok.length === 1 ? 'Archivo añadido' : `${ok.length} archivos añadidos`);
  }
}

export async function quitarDrp(id) {
  const p = estado.parte;
  const x = (p.drp || []).find((f) => f.id === id);
  if (!x || !confirm(`¿Quitar ${x.nombre}?`)) return;
  p.drp = p.drp.filter((f) => f.id !== id);
  await db.borrarFoto(id);
  await guardarYa();
  render();
}
