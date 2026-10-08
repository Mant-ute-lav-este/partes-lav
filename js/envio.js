// Prepara el correo del parte: 3 adjuntos (PDF, datos y fotos) que se envían con
// el menú «Compartir» del móvil (Gmail). Power Automate los recoge en la oficina.
//
// Se mandan siempre 3 archivos, porque Android puede fallar al compartir muchos de
// golpe. Las fotos van dentro de un .txt en JSON (base64) y Power Automate las vuelve
// a separar en .jpg. Se usa .txt y no .json porque Android no deja compartir .json.

import { generarPDF, textoReferencia, sinFechaOriginal } from './pdf.js';
import { blobABase64, fmtFecha, isoLocal, slug, FORMATO1 } from './util.js';

export function nombreBase(p) {
  return `${p.fecha}_${p.tipo}_${p.ref}${p.rev > 1 ? `_v${p.rev}` : ''}_${slug(p.capataz)}`;
}

/** Carpeta dentro de "General/Partes" donde lo guarda Power Automate. */
const CARPETA_TIPO = { INFRA: 'Infra', SUPER: 'Super', MAQUINARIA: 'Maquinaria' };

export function carpetaDestino(p) {
  return `${p.fecha}/${CARPETA_TIPO[p.tipo] || p.tipo}/${p.ref}_${slug(p.capataz)}`;
}

export async function prepararEnvio(parte, config, leerFoto, versionApp) {
  const base = nombreBase(parte);
  const sufijo = parte.rev > 1 ? `_v${parte.rev}` : '';
  const pdf = await generarPDF(parte, config, versionApp, leerFoto);

  const datos = structuredClone(parte);
  const fotos = [];
  for (const [i, t] of datos.trabajos.entries()) {
    const cuenta = {};
    for (const f of t.fotos) {
      cuenta[f.fase] = (cuenta[f.fase] || 0) + 1;
      f.archivo = `T${i + 1}_${f.fase}_${cuenta[f.fase]}${sufijo}.jpg`;
      const blob = await leerFoto(f.id);
      if (!blob) throw new Error(`Falta una foto del trabajo ${i + 1}. Ábrelo y revisa sus fotos.`);
      fotos.push({ archivo: f.archivo, trabajo: i + 1, fase: f.fase, base64: await blobABase64(blob) });
    }
  }
  // Formato 1 (solo SUPER): sus fotos van con las demás, en la misma carpeta, como Formato1_n.jpg
  for (const [k, f] of (datos.formato1 || []).entries()) {
    f.archivo = `Formato1_${k + 1}${sufijo}.jpg`;
    const blob = await leerFoto(f.id);
    if (!blob) throw new Error(`Falta una foto del ${FORMATO1.toLowerCase()}. Ábrelo y revisa sus fotos.`);
    fotos.push({ archivo: f.archivo, trabajo: 0, fase: 'formato', base64: await blobABase64(blob) });
  }
  datos.carpeta = carpetaDestino(parte);
  datos.archivos = {
    pdf: `Parte_${base}.pdf`,
    datos: `datos${sufijo}.json`,
    fotos: fotos.map((f) => f.archivo),
  };
  datos.preparado = isoLocal();
  delete datos.envios;

  const archivos = [
    new File([pdf], datos.archivos.pdf, { type: 'application/pdf' }),
    new File([JSON.stringify(datos, null, 1)], `Datos_${base}.txt`, { type: 'text/plain' }),
    new File([JSON.stringify({ formato: 'fotos-parte-lav', version: 1, parteId: parte.id, carpeta: datos.carpeta, fotos })],
      `Fotos_${base}.txt`, { type: 'text/plain' }),
  ];
  const asunto = `PARTE LAV · ${parte.tipo} · ${fmtFecha(parte.fecha)} · ${parte.ref}` +
    `${parte.rev > 1 ? ` rev. ${parte.rev}` : ''} · ${parte.capataz}`;
  // Aviso para la oficina (no para el operario): fotos de galería sin fecha original.
  const sinFecha = [
    ...parte.trabajos.map((t, i) => ({ nombre: `trabajo ${i + 1}`, n: t.fotos.filter(sinFechaOriginal).length, de: t.fotos.length })),
    { nombre: FORMATO1.toLowerCase(), n: (parte.formato1 || []).filter(sinFechaOriginal).length, de: (parte.formato1 || []).length },
  ].filter((x) => x.n);
  const cuerpo = [
    `Parte ${parte.tipo} de la jornada ${fmtFecha(parte.fecha)}${parte.nocturna ? ' (nocturna)' : ''}.`,
    parte.tipo === 'MAQUINARIA' && parte.subtipo && parte.subtipo !== 'via'
      ? `Lo rellena: ${parte.capataz}. ${parte.subtipo === 'locomotora' ? 'Locomotora' : 'Dresina'}: ${parte.maquina.descripcion}` +
        `${parte.maquina.uic ? ` (UIC ${parte.maquina.uic})` : ''}. Nº acta: ${parte.acta}. ` +
        `Trabajos: ${(parte.realizados || []).map((r) => `vía ${r.via} PK ${r.pkInicio}-${r.pkFin} ${r.trabajo}`).join('; ')}.`
      : parte.tipo === 'MAQUINARIA'
      ? `Lo rellena: ${parte.capataz}. Máquinas: ${(parte.maquinasVia || []).filter((m) => m.descripcion).map((m) => `${m.descripcion} (${m.horas} h)`).join('; ')}. ` +
        `Tajos: ${(parte.tajos || []).map((t) => `vía ${t.via} PK ${t.pkInicio}-${t.pkFin}`).join('; ')}.`
      : `Capataz: ${parte.capataz}. Trabajos: ${parte.trabajos.map((t) => textoReferencia(t) + (t.tipoCoste ? ` [${t.tipoCoste}]` : '')).join('; ')}.`,
    ...(sinFecha.length ? [`AVISO: fotos de galería sin fecha original (se ha usado la fecha del archivo): ${
      sinFecha.map((x) => `${x.nombre} (${x.n} de ${x.de})`).join(', ')}.`] : []),
    ...((parte.formato1 || []).length ? [`${FORMATO1} adjunto: ${parte.formato1.length} foto(s).`] : []),
    'Enviado desde la app Partes LAV. No cambies los adjuntos.',
  ].join('\n');
  return { pdf, archivos, asunto, cuerpo };
}

/** Abre el menú Compartir del móvil. Si no se puede (p. ej. en el PC), descarga los archivos. */
export async function compartir({ archivos, asunto, cuerpo }) {
  if (navigator.canShare && navigator.canShare({ files: archivos })) {
    await navigator.share({ files: archivos, title: asunto, text: cuerpo });
    return 'compartido';
  }
  for (const f of archivos) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  return 'descargado';
}
