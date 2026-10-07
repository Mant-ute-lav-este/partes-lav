# Historial de versiones

La versión que ve el capataz está en Ajustes («Versión de la app»). Al publicar hay que subirla en `sw.js` y en `js/app.js` (lo hace `publicar.ps1`).

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

- **v5** · 2026-10-06 · aparatos con PK.
- Versiones anteriores (v1–v4): ver el historial de implementaciones en Apps Script.
- **Sin desplegar (2026-10-07):** `servidor/Code.gs` incluye la copia de seguridad semanal de la hoja (`copiaSeguridad`, `activarCopiaSemanal`). El código está guardado en el editor y el activador funciona, pero la implementación publicada sigue siendo la v5. Se desplegará como v6 con el próximo cambio del servidor.
