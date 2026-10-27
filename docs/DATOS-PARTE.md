# Datos_.txt · contrato de los datos del parte

`Datos_<fecha>_<tipo>_<ref>_<capataz>.txt` es el parte tal como lo guarda la app, en JSON, más unos campos que añade al enviar. Lo leen:

- **Power Automate** (solo `carpeta`, para saber dónde guardar).
- **El portal de la UTE** (Supabase): el servidor le manda este mismo JSON, sin fotos, más `servidor{email, nombre, recibido, envioId}`.
- **El Excel histórico** (fase 6.1) y el «cerebro» de la empresa, que leerán **todos** los campos.

Por eso los nombres de los campos son un contrato: no se renombran ni se quitan sin avisar.

## Versión

- `formato`: siempre `"parte-lav"`.
- `version`: número entero, hoy `1`. Se **sube** cuando se quita o renombra un campo, o cambia su significado. Añadir campos nuevos **no** sube la versión: quien lee tiene que ignorar los campos que no conoce. Quien lea `version` mayor de la que conoce, debe avisar en lugar de rellenar a ciegas.
- Una versión más de la app (0.20.x) **no** cambia `version`; esa es solo del formato de los datos. La versión de la app va en `app.version`.

## La prueba que lo vigila

`pruebas/contrato-datos.json` guarda la forma (campos y tipos, sin valores) del Datos_ de los 5 partes de ejemplo. La prueba «contrato: la forma del Datos_…» falla si un cambio añade, quita o cambia el tipo de un campo.

Si falla, hay que decidir:

1. **Era un error** → corregir el código.
2. **Es a propósito** → (a) avisar a Juan (portal) y a quien lea el Excel; (b) apuntarlo en este archivo y en el `CHANGELOG`; (c) si se quita o renombra algo, subir `version` (en `vista-inicio.js`, `crearParte`) y escribir el paso de migración; (d) copiar `privado/herramientas/salida/contrato-datos-actual.json` (lo deja la prueba al fallar) sobre `pruebas/contrato-datos.json`.

Limitación: la prueba solo ve los campos que tienen los partes de `pruebas/ejemplos.js`. Los campos que solo aparecen en casos concretos (abajo, «Campos opcionales») no están vigilados: si se añade uno, añadirlo también a un ejemplo.

## Campos comunes (todos los tipos)

| Campo | Significado |
|---|---|
| `formato`, `version` | Ver arriba. |
| `id` | Identificador único del parte (uuid). Una revisión (rectificativo) tiene `id` nuevo. |
| `ref` | Referencia: `INF-0001`, `SUP-0001`, `MAQ-0001`, `LOC-0001`, `DRE-0001`. |
| `rev` | Revisión: 1 la original, 2+ los rectificativos. |
| `rectificaA` | `null`, o `{ id, rev, cierre }` del parte al que sustituye. |
| `tipo` | `INFRA`, `SUPER` o `MAQUINARIA`. En maquinaria, `subtipo`: `via`, `locomotora` o `dresina`. |
| `fecha` | Fecha de la jornada, `AAAA-MM-DD`. Es la que manda para la carpeta, no la de llegada. |
| `nocturna` | Jornada nocturna (solo tiene sentido en SUPER y maquinaria). |
| `capataz` | Quién rellena el parte. |
| `personal[]` | `nombre`, `empresa`, `habilitacion`, `categoria`, `otro` (true si no estaba en la lista de la oficina). En maquinaria, además `puesto`. |
| `usaVehiculos`, `vehiculos[]` | `descripcion`, `matricula`, `otro`. |
| `usaExtras`, `extras[]` | Horas extra: `nombre`, `horas` (número), `tipo`, `motivo`. |
| `medidas[]`, `medidasOtrasSi`, `medidasOtras`, `antiincendios` | Medidas antiincendios marcadas; `antiincendios` es el texto que sale en el PDF. |
| `observaciones` | Texto libre. |
| `estado` | `cerrado` en el Datos_ (la app lo manda al cerrar). |
| `creado`, `modificado`, `cierre` | Fechas con zona horaria. |
| `app.version` | Versión de la app que lo generó. |

Los añade el envío: `carpeta` (ruta en SharePoint), `archivos{pdf, datos, fotos[]}` (nombres de archivo), `preparado` (cuándo se preparó). `envios` se quita.

## INFRA y SUPER

- `trabajos[]`: `id`, `referencia{tipo, codigo, motivo}` (tipo: `SIOS`, `INCIDENCIA`, `SIN_REF`…), `tipoCoste` (RREE/POI/vacío), `pidame` (= nº de acta), `linea`, `via` (texto, `"1, 2"` si son varias en SUPER), `aparato` (texto; varios separados por coma), `pkInicio`, `pkFin` (`km+mmm`), `metrosLineales`, `sinVia`, `telefonema{numero, salida}`, `entradaVia`, `salidaVia`, `horaInicio`, `horaFin` (si no se ocupa la vía), `motivoActuacion`, `descripcion`, `finalizado`, `fotos[]`.
- `trabajos[].fotos[]`: `id`, `fase` (`antes`/`durante`/`despues`), `archivo` (nombre del `.jpg` en `Fotos_`), `fechaFoto`, `fuenteFecha` (`exif`/`captura`/`archivo`), `origen`, `ancho`, `alto`, `etiqueta`, `anadida`. Las imágenes **no** van en el Datos_; van en `Fotos_`.
- SUPER: `usaMaquinaria`, `maquinas[]` (`descripcion`, `otro`) y `formato1[]` (fotos del formato de protección, con la misma forma que las fotos de trabajo).

## MAQUINARIA

- Vía: `evb`, `horaInicio`, `horaFin`, `maquinasVia[]` (`descripcion`, `uic`, `trabajo`, `horas`, `otro`), `viaje{horaSalida, lugarSalida, horaLlegada, lugarLlegada}`, `tajos[]` (`id`, `llegada`, `inicio`, `fin`, `salida`, `via`, `pkInicio`, `pkFin`, `desvio`, y los bloques `nivelado`, `alineado`, `estabilizado`, `registro`, `perfilado`, cada uno con `si` y sus datos).
- Locomotora y dresina: `acta`, `maquina{descripcion, uic, otro}`, `salida{hora, lugar}`, `apartado{hora, lugar}`, `realizados[]` (`id`, `via`, `pkInicio`, `pkFin`, `horaInicio`, `horaFin`, `trabajo`, `m3`), `combustible{salida, llegada}`, `km{salida, llegada}`. Locomotora: `vagones[]` (`tipo`, `uic`, `m3`) y `procedencia`. Dresina: `evb`, `uicPlataforma` y `telefonemas{entrada{numero, hora}, salida{numero, hora}}`.

## Campos opcionales (solo aparecen en casos concretos; no vigilados por la prueba)

- Jornada sin trabajos: `sinTrabajos` (true), `motivoSinTrabajos`, `sinTrabajosOtro`. En ese caso `trabajos`, `formato1`, `tajos`, `realizados`, `vagones` y `drp` viajan vacíos.
- Registros DRP (maquinaria de vía con bateadora; desde la versión de la app que los adjunta, con el servidor v18): `drp[]` (`id`, `nombre` original, `tam` en bytes, `anadido`, `archivo` con el que va adjunto, ya limpio como lo deja el servidor: `495_940_al_495_840_via2_reg1.drp`) y `archivos.drp[]` con esos nombres. Solo aparecen si se ha añadido alguno; los archivos van como adjuntos `.drp` aparte, tal cual salen de la máquina.
- Trabajo no realizado: `noRealizado`, `motivoNoRealizado`, `noRealizadoOtro` dentro del trabajo. Trabajo sin fotos: `sinFotos`, `motivoSinFotos`, `sinFotosOtro`.
- Revisión: `rectificaA` con datos; `rev` mayor que 1.
- Envío por Gmail de emergencia: `porGmail`, `enCola` (los apunta la app en el móvil; pueden aparecer si se envía así).
- `fotosBorradas`: fecha en que el móvil quitó las fotos (a los 30 días de enviado).

Los textos de horas y PK se guardan como texto (`"08:00"`, `"481+045"`); las horas extra, como número.
