# Arquitectura de Partes LAV

```
Móvil del capataz (PWA)
   │  1. registro / PIN / lista de la oficina
   │  2. «Enviar»: parte en cola (IndexedDB) → servidor
   ▼
Google Apps Script  (cuenta de Gmail de la UTE, hoja «Partes LAV · Datos»)
   │  guarda usuarios y envíos; manda el parte por correo
   ▼
Correo a la oficina, asunto «PARTE LAV …», 3 adjuntos (PDF, Datos_….txt, Fotos_….txt)
   ▼
Power Automate «Guardar partes LAV»  (tarda 1–5 minutos)
   ▼
SharePoint / Teams «Partes LAV Este»: General/Partes/AAAA-MM-DD/Infra|Super/REF_Capataz/
   ▼
Carpeta sincronizada en el OneDrive de quien la tenga sincronizada
```

## Piezas

| Pieza | Dónde | Qué hace |
|---|---|---|
| App | GitHub Pages, repo `Mant-ute-lav-este/partes-lav` (público) | JavaScript sin librerías, instalable. Funciona sin cobertura. |
| Servidor | `servidor/Code.gs`, desplegado en Apps Script | Registro, aprobación, lista de la oficina y envío por correo. |
| Datos | Hoja de Google «Partes LAV · Datos» | Usuarios, sesiones, envíos y las listas (trabajadores, máquinas, vehículos, aparatos, antiincendios, motivos, ajustes). |
| Flujo | Power Automate | Lee el correo y guarda los adjuntos en Teams. |

## Archivos de la app

| Archivo | Contenido |
|---|---|
| `index.html`, `manifest.webmanifest`, `icons/` | Página y datos de instalación |
| `sw.js` | Service worker: caché sin conexión y envío en segundo plano. **Script clásico, sin `import`.** |
| `js/app.js` | Arranque de la app (y `APP_VERSION`) |
| `js/estado.js` | Estado compartido, navegación (`ir`/`render`), guardado del parte, sincronización y lista de la oficina |
| `js/vista-acceso.js`, `vista-inicio.js`, `vista-parte.js`, `vista-maquinaria.js`, `vista-trabajo.js`, `vista-extras.js`, `vista-envio.js` | Pantallas: registro y PIN, inicio y menú, parte INFRA/SUPER y cierre, maquinaria (vía, locomotora, dresina), trabajo y fotos, horas extra, envío |
| `js/campos.js` | Piezas de formulario comunes (horas, PK, Sí/No, lista de faltas) |
| `js/eventos.js` | Botones, campos y formularios |
| `js/validaciones.js` | Lo que falta para cerrar cada tipo de parte (funciones puras, con pruebas) |
| `js/modelo.js` | Listas fijas, apartados nuevos y arreglo de borradores antiguos |
| `js/db.js` | IndexedDB `partes-lav`: kv, partes, fotos, salida |
| `js/servidor.js` | Llamadas al servidor, con reintentos e identificador de petición |
| `js/envio.js`, `js/salida.js` | Cola de envío |
| `js/pdf.js` | PDF A4 del parte |
| `js/fotos.js` | Reducir fotos y ponerles el sello |
| `js/util.js` | Utilidades |
| `css/app.css` | Estilos |
| `ejemplo/config-ejemplo.json` | Formato de la lista de la oficina, con datos inventados |

## Reglas que conviene recordar

- **Nunca datos reales en el repositorio** (es público): nombres, correos, matrículas, claves. Van en la hoja o en `privado/`.
- **Al publicar hay que subir la versión** en `sw.js` y `js/app.js`, o los móviles seguirán con la copia guardada (`privado/herramientas/publicar.ps1` lo hace y lo comprueba).
- **Todo archivo nuevo de `js/` o `css/` hay que añadirlo a `ARCHIVOS` en `sw.js`**, si no, no funciona sin cobertura. `publicar.ps1 -Comprobar` lo avisa.
- **Las vistas y `estado.js` se importan entre sí**: no se puede usar nada de otro módulo al cargarlo, solo dentro de funciones. `privado/herramientas/revisar-imports.ps1` avisa de nombres usados sin importar, y las pruebas «pantallas» pintan cada pantalla de la app real.
- **No usar `<datalist>`**: en Android se ve en horizontal. Usar `<select>`.
- **Horas decimales** en campos de texto con `inputmode="decimal"`: `type=number` rechaza «1,5».
- **El servidor no repite peticiones**: cada una lleva un `peticion` (UUID) y se guarda 30 minutos.

## Desplegar el servidor

1. Pegar `Code.gs` en el editor de Apps Script y guardar.
2. *Implementar → Gestionar implementaciones → lápiz → Versión nueva → Implementar*. La URL no cambia.
3. Probar un envío y comprobar que el flujo lo guarda.

Para volver atrás: en «Gestionar implementaciones», elegir la versión anterior.

## Cuotas

Apps Script en una cuenta Gmail gratuita permite unos 100 correos al día (cada parte, código y aviso cuenta uno) y tiene tiempo máximo de ejecución. Para el uso actual sobra; hay que vigilarlo si se suman más apps o usuarios.
