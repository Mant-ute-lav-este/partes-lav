// Aspecto de la app: tema (automático, claro u oscuro) y tamaño de letra (normal o grande).
// Se guarda en este móvil, en localStorage, para poder aplicarlo antes de pintar nada
// (el script de index.html hace lo mismo y evita el parpadeo en claro al abrir de noche).

const CLAVE = 'partes-lav-aspecto';
export const TEMAS = ['auto', 'claro', 'oscuro'];
export const LETRAS = ['normal', 'grande'];

export function leerAspecto() {
  try {
    const a = JSON.parse(localStorage.getItem(CLAVE) || '{}');
    return { tema: TEMAS.includes(a.tema) ? a.tema : 'auto', letra: LETRAS.includes(a.letra) ? a.letra : 'normal' };
  } catch {
    return { tema: 'auto', letra: 'normal' };   // sin almacenamiento o dato roto: como siempre
  }
}

/** «auto» y «normal» no ponen atributo: la hoja de estilos ya los trae por defecto. */
export function aplicarAspecto(a = leerAspecto(), raiz = document.documentElement) {
  if (a.tema === 'auto') delete raiz.dataset.tema; else raiz.dataset.tema = a.tema;
  if (a.letra === 'normal') delete raiz.dataset.letra; else raiz.dataset.letra = a.letra;
}

/** Cambia uno o los dos ajustes, los guarda y los aplica al momento. */
export function guardarAspecto(cambio, raiz = document.documentElement) {
  const a = { ...leerAspecto(), ...cambio };
  try { localStorage.setItem(CLAVE, JSON.stringify(a)); } catch { /* se aplica igual, solo esta vez */ }
  aplicarAspecto(a, raiz);
  return a;
}
