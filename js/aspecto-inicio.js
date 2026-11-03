// Aspecto elegido en el Menú (tema y letra): se pone antes de pintar para que no parpadee. Ver js/aspecto.js.
// Script clásico y aparte (no en línea en index.html) porque la política de seguridad no admite scripts en línea.
try {
  var a = JSON.parse(localStorage.getItem('partes-lav-aspecto') || '{}');
  if (a.tema === 'claro' || a.tema === 'oscuro') document.documentElement.dataset.tema = a.tema;
  if (a.letra === 'grande') document.documentElement.dataset.letra = 'grande';
} catch (e) { /* sin almacenamiento: aspecto por defecto */ }
