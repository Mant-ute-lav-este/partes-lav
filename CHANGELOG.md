# Historial de versiones

La versión que ve el capataz está en Ajustes («Versión de la app»). Al publicar hay que subirla en `sw.js` y en `js/app.js` (lo hace `publicar.ps1`).

## 0.9.6 · 2026-10-08
- Las casillas RREE y POI salen una al lado de la otra.

## 0.9.5 · 2026-10-08
- Las casillas RREE/POI del trabajo se llaman «Tipo de trabajo».

## 0.9.4 · 2026-10-08
- Parte INFRA: se quita «Jornada nocturna» y la fecha automática de madrugada (SUPER sigue igual).
- Parte INFRA: en cada trabajo, casillas opcionales RREE o POI (solo una o ninguna), para los trabajos de coste directo que se facturan aparte. Salen en una columna nueva del PDF entre REFERENCIA y Nº PIDAME (guion si no se marca ninguna), en los datos del parte y en el texto del correo.

## 0.9.3 · 2026-10-07
- Fotos de la galería: el aviso dice la causa real (formato no compatible, HEIC, foto vacía, demasiado grande o sin espacio) y el nombre de la foto, en vez de culpar siempre al formato.

## 0.9.2 · 2026-10-07
- Aviso en la portada: «Tienes N partes sin enviar» con botón «Enviar ahora» (o «Abrir» si el parte está cerrado pero sin pulsar Enviar).

## 0.9.1 · 2026-10-06
- Telefonema de entrada y de salida: dos números.

## 0.9.0 · 2026-10-06
- Aparatos con desplegable agrupado por estación; rellena solos los PK de inicio y fin.
- «Sin referencia»: se escribe la referencia (campo obligatorio) y el botón sigue diciendo «Sin referencia».

## 0.8.7 · 2026-10-06
- Horas con el teclado numérico en vez del reloj.

## 0.8.6 · 2026-10-05
- La app se actualiza sola; si se está editando un parte, avisa con «Hay una versión nueva».

## 0.8.5 · 2026-10-05
- Motivo de la actuación obligatorio; descripción opcional.

## 0.8.4 · 2026-10-05
- Motivo de la actuación con desplegable vertical y opción «Otro».

## 0.8.3 · 2026-10-05
- Hora de inicio y de fin en los trabajos que no ocupan la vía.

## 0.8.2 · 2026-10-05
- Botón «Guardar y salir» junto a «Cerrar parte».

## 0.8.1 · 2026-10-04
- Más reintentos con aviso «Intento N de 5» cuando Google tarda.

## 0.8.0 · 2026-10-04
- Horas extra por persona al cerrar el parte (normales, nocturnas o festivas; motivo opcional).

## 0.7.0 · 2026-10-04
- Medidas antiincendios con casillas, más de una a la vez y «Otras».

## 0.6.1 · 2026-10-04
- Línea 040 o 038 también en los partes de Super.

## 0.6.0 · 2026-10-03
- Maquinaria y vehículos por separado, línea y vía con botones, PK en km + m y aparato.

## 0.5.0 · 2026-10-03
- Varios trabajos por parte, con la interfaz más clara.

## 0.4.0 · 2026-10-02
- La app usa el servidor y el registro es obligatorio.

## 0.3.x · 2026-10-02
- Registro con Gmail y envío automático por el servidor (0.3.0).
- Service worker clásico para que se actualicen los móviles ya instalados (0.3.1).

## 0.2.x · 2026-10-02
- Anexo fotográfico en el PDF y maquinaria obligatoria (0.2.0).
- Opción «Cambiar de capataz» (0.2.1).

## 0.1.0 · 2026-10-02
- Primera versión.

---

## Servidor (Apps Script)

Las versiones del servidor se numeran en Google («Gestionar implementaciones»); la URL no cambia.

- **v6** · 2026-10-07 · copia de seguridad semanal de la hoja (lunes 3:00, carpeta «Partes LAV · Copias», 8 copias).
- **v5** · 2026-10-06 · aparatos con PK.
- Versiones anteriores (v1–v4): ver el historial de implementaciones en Apps Script.
- **Sin desplegar (2026-10-07):** `servidor/Code.gs` incluye además `resumenDiario` y `activarResumenDiario` (correo diario a las 16:00 con los partes recibidos). El activador funciona con el código guardado en el editor; la implementación publicada sigue siendo la v6. Se desplegará como v7 con el próximo cambio del servidor.
