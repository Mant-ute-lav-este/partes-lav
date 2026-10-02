# Partes LAV

App web instalable (PWA) para que los capataces de mantenimiento LAV hagan el parte diario desde el móvil Android, con o sin cobertura.

## Cómo funciona

1. El capataz entra con su PIN y pulsa **INFRA** o **SUPER**.
2. Rellena la jornada, el personal, la maquinaria y los vehículos (hay que contestar Sí o No), los trabajos (con fotos de antes y después) y las medidas antiincendios. Todo se guarda en el móvil según escribe.
3. Al **cerrar** el parte se registra la hora de cierre del móvil y se genera el PDF A4.
4. **Enviar por correo** abre el menú Compartir de Android: el capataz elige Gmail y lo manda a la dirección de la oficina. Sin cobertura, Gmail lo envía cuando vuelve la señal.
5. En la oficina, un flujo de Power Automate guarda los adjuntos en la carpeta del equipo de Teams «Partes LAV Este»: `General/Partes/AAAA-MM-DD/Infra|Super/REF_Capataz/`.

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

El repositorio es **público**: aquí solo hay código y datos inventados. Los nombres reales van en un archivo JSON que la oficina pasa a cada capataz y que este carga desde la app con «Cargar archivo de la oficina». Su formato es el de [`ejemplo/config-ejemplo.json`](ejemplo/config-ejemplo.json):

- `destinatario`: correo al que se envían los partes.
- `cabecera`: textos de la cabecera del PDF (jefatura, ámbito, empresa, líneas).
- `capataces`, `trabajadores` (nombre, empresa, habilitación, categoría), `vehiculos` y `motivos`.

## Publicar cambios

La app se publica con GitHub Pages desde la rama `main`. **Al publicar cambios hay que subir `VERSION` en `sw.js`**; si no, los móviles seguirán usando la copia guardada.

Para probar en el PC hace falta un servidor local (por ejemplo, uno de PowerShell con `HttpListener`). El navegador integrado no activa el modo sin conexión en `localhost`; en la web publicada sí.
