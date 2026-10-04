# Partes LAV

App web instalable (PWA) para que los capataces de mantenimiento LAV hagan el parte diario desde el móvil Android, con o sin cobertura.

## Cómo funciona

1. La primera vez, el capataz **se registra**: su Gmail, un código que le llega a ese correo, su nombre elegido de la lista de la oficina y un PIN. La oficina aprueba el registro desde un enlace que le llega por correo. Si olvida el PIN, crea otro con un código al correo.
2. Entra con su PIN y pulsa **INFRA** o **SUPER**. La lista de trabajadores ya viene cargada y se actualiza sola.
3. Rellena la jornada, el personal, la maquinaria y los vehículos (hay que contestar Sí o No), los trabajos (con fotos de antes y después) y las medidas antiincendios. Todo se guarda en el móvil según escribe.
4. Al **cerrar** el parte se registra la hora de cierre del móvil y se genera el PDF A4.
5. **Enviar a la oficina** lo manda al servidor, que lo reenvía por correo a la oficina. Sin cobertura, se queda en cola y sale solo cuando vuelve la señal. Si el servidor fallara, queda el botón «Mandarlo por Gmail».
6. En la oficina, un flujo de Power Automate guarda los adjuntos en la carpeta del equipo de Teams «Partes LAV Este»: `General/Partes/AAAA-MM-DD/Infra|Super/REF_Capataz/`.

### Adjuntos del correo

| Archivo | Contenido |
|---|---|
| `Parte_….pdf` | Parte en A4 apaisado, con el aspecto del parte en papel, y al final el anexo fotográfico (dos fotos por página, reducidas) |
| `Datos_….txt` | Todos los datos en JSON. El campo `carpeta` indica dónde guardarlo |
| `Fotos_….txt` | Las fotos en JSON (base64). Power Automate las guarda como `.jpg` |

Siempre son 3 archivos porque Android puede fallar al compartir muchos de golpe. Se usa `.txt` porque Android no deja compartir `.json`.

### Fotos

- Se reducen a 1600 px y se vuelven a generar desde cero, así que salen **sin metadatos: ni GPS ni nada**.
- El sello va en una franja bajo la imagen: fecha y hora, referencia (SIOS / incidencia), fase, cámara o galería, y nº de parte.
- En las fotos de galería se usa la fecha original (EXIF). Si no la tienen, como las de WhatsApp, se usa la fecha del archivo y queda indicado.

## Lista de la oficina (no va en este repositorio)

El repositorio es **público**: aquí solo hay código y datos inventados. Los nombres reales están en la hoja del servidor (ver más abajo) y la app los descarga al entrar. Para subir una lista completa de golpe se usa un JSON con el formato de [`ejemplo/config-ejemplo.json`](ejemplo/config-ejemplo.json):

- `destinatario`: correo al que se envían los partes.
- `cabecera`: textos de la cabecera del PDF (jefatura, ámbito, empresa, líneas).
- `capataces`, `trabajadores` (nombre, empresa, habilitación, categoría), `maquinas` (descripción), `vehiculos` (descripción y matrícula) y `motivos`. Para cambiar solo una parte, basta con subir esa lista: lo que no venga no se toca.

## Servidor de envío (Google Apps Script)

`servidor/Code.gs` vive en la cuenta de Gmail de la UTE. Hace tres cosas:

- **Registra a los capataces:** Gmail, código por correo, nombre elegido de la lista y PIN. Cada registro queda **pendiente** hasta que la oficina lo aprueba desde el enlace que le llega por correo.
- **Sirve a la app la lista de la oficina:** trabajadores, máquinas, vehículos (con matrícula), motivos y cabecera del PDF.
- **Recibe los partes y los manda por correo a la oficina** con el asunto «PARTE LAV …» y los 3 adjuntos de siempre. El flujo de Power Automate los guarda en la carpeta de Teams.

En la app, cuando el capataz pulsa **Enviar**, el parte entra en una cola. Si no hay cobertura, sale solo en cuanto vuelve la señal (en Android, aunque la app esté cerrada). El servidor no repite un envío que ya recibió.

Google a veces pierde la respuesta de una petición aunque la haya hecho (la app recibe una página de error). Por eso cada petición lleva un identificador: la app la repite sola con el mismo identificador y el servidor devuelve la respuesta que guardó, sin mandar otra vez el código, registrar dos veces ni enviar el parte repetido.

Sin servidor configurado (`SERVIDOR_URL` vacío, para copias de prueba), la app funciona como al principio: la lista se carga desde un archivo y el parte se manda con Gmail.

Los datos están en la hoja «Partes LAV · Datos» de esa cuenta: usuarios, sesiones, envíos, trabajadores, máquinas, vehículos, motivos y ajustes. **Las listas de trabajadores, máquinas y vehículos se mantienen editando esa hoja**; la app las descarga sola. En los trabajos, la línea se elige con botones: 040 o 038.

Instalación (una vez):
1. En script.google.com, con la cuenta de la UTE, crear un proyecto y pegar `Code.gs`.
2. Ejecutar `configurar()` y dar permisos. El registro muestra la URL de la hoja y la clave de administración.
3. *Implementar → Nueva implementación → Aplicación web*, con «Ejecutar como: yo» y «Quién tiene acceso: cualquier usuario». Copiar la URL en `SERVIDOR_URL` (`js/servidor.js`).
4. Subir la lista con la acción `cargarLista` y la clave de administración.

Para publicar cambios en `Code.gs` sin cambiar la URL: pegar el código, guardar y *Implementar → Gestionar implementaciones → editar (lápiz) → Versión: nueva versión → Implementar*.

## Publicar cambios

La app se publica con GitHub Pages desde la rama `main`. **Al publicar cambios hay que subir `VERSION` en `sw.js`**; si no, los móviles seguirán usando la copia guardada.

Para probar en el PC hace falta un servidor local (por ejemplo, uno de PowerShell con `HttpListener`). El navegador integrado no activa el modo sin conexión en `localhost`; en la web publicada sí.
