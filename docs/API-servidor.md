# API del servidor de Partes LAV

Guía para quien quiera conectar otra aplicación al **registro de usuarios** de Partes LAV (por ejemplo, la app de almacén). No contiene ningún dato privado: ni claves, ni la hoja de datos, ni acceso a la cuenta del servidor.

La URL del servidor está en [`js/servidor.js`](../js/servidor.js) (`SERVIDOR_URL`). Quien conecte otra app **no necesita** acceso a la cuenta de Google, a la hoja ni al editor de Apps Script: solo esta URL y este documento.

## Cómo se llama

- Método **POST** a la URL del servidor.
- Cuerpo: JSON **enviado como `text/plain`** (con `application/json` el navegador hace una comprobación previa que Apps Script no admite).
- Hay que **seguir las redirecciones** (Apps Script responde con una).
- Todas las peticiones llevan `accion` y un `peticion` (UUID nuevo en cada petición).

```js
const r = await fetch(SERVIDOR_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ accion: 'login', peticion: crypto.randomUUID(), email, pin }),
});
const datos = await r.json();   // { ok: true, ... }  o  { ok: false, error: '...' }
```

### Respuestas

- Correcta: `{ "ok": true, ... }`.
- Error: `{ "ok": false, "error": "texto para mostrar al usuario" }`.
- Servidor ocupado: `{ "ok": false, "reintentar": true, ... }` → repetir.

### Reintentos (importante)

Google a veces pierde la respuesta aunque haya hecho la acción (llega una página HTML en lugar de JSON). **Si la respuesta no es JSON, repite la misma petición con el mismo `peticion`**: el servidor la reconoce durante 30 minutos y devuelve la respuesta guardada, sin volver a mandar el correo ni registrar dos veces. Partes LAV hace hasta 5 intentos, con esperas de 2, 4, 5 y 5 s entre ellos, y cada intento espera la respuesta hasta 45 s (240 s al enviar un parte, que lleva fotos).

## Acciones para el registro y la entrada

| Acción | Datos | Devuelve | Notas |
|---|---|---|---|
| `codigo` | `email`; `para: 'pin'` si es para recuperar el PIN | `{}` | Envía un código de 6 cifras al correo (caduca en 30 min; si el anterior aún vale, se reenvía el mismo). Máximo 5 por correo y hora. |
| `verificar` | `email`, `codigo` | `nombres: []` | Solo comprueba el código. **Desde el servidor v13 ya no devuelve la lista de trabajadores** (la lista va siempre vacía); usa `buscarNombre`. |
| `buscarNombre` | `email`, `codigo`, `texto` | `nombre` | (v13) La persona escribe su nombre y al menos un apellido; da igual el orden, las tildes y las mayúsculas, pero van palabras enteras; una inicial suelta (escrita o en la lista) encaja con la palabra que empieza por esa letra (v19). Solo contesta si encaja con **una** persona de la lista que aún no tiene una cuenta **activa** (v21: una solicitud pendiente con ese nombre ya no bloquea), y devuelve el nombre tal como está en la lista (es el que se pasa a `registro`). Máximo 15 intentos por correo y hora; una sola palabra no gasta intento (v19). |
| `registro` | `email`, `codigo`, `nombre`, `pin` (4–6 cifras, no fácil: ver nota) | `token`, `estado: 'pendiente'`, `nombre` | Crea la cuenta como **pendiente**; la oficina la aprueba desde un enlace que le llega por correo (v21: vale 30 días). Si hay otra solicitud pendiente con el mismo nombre, la oficina recibe las dos y, al aprobar una, las demás pasan a `rechazado`. |
| `login` | `email`, `pin` | `token`, `estado`, `nombre` | 5 PIN erróneos seguidos bloquean 15 minutos; desde el 10.º, 1 hora; desde el 15.º, 1 día (v23). Acertar o `nuevoPin` lo pone a cero. |
| `estado` | `token` | `estado`, `nombre` | Para saber si ya la han aprobado. |
| `salir` | `token` | `{}` | (v21) Cierra esa sesión: el token deja de valer. Si ya no existía, también responde `ok`. Llamarla al cerrar sesión en el dispositivo. |
| `nuevoPin` | `email`, `codigo`, `pin` | `token`, `estado`, `nombre` | «He olvidado el PIN». Antes hay que pedir `codigo` con `para: 'pin'`. Cierra **todas** las sesiones de esa cuenta y abre la nueva (v23). |

`estado` puede ser `pendiente`, `activo` o `rechazado`.

**PIN nuevo (v23):** en `registro`, `nuevoPin` y `pin` el servidor rechaza los PIN fáciles (cifras repetidas como 0000, seguidas como 1234 o 4321, parejas como 1212 o 1122, años de 1940 a 2039 y unos pocos típicos como 2580) con el error `Ese PIN es muy fácil de adivinar (cifras repetidas, seguidas o muy usadas). Elige otro.` Basta con enseñar el error y dejar elegir otro; el código del correo no se gasta. Los PIN que ya existen siguen valiendo para `login`, aunque sean fáciles. Cambiar el PIN con `pin` cierra las demás sesiones de esa cuenta (la de ese token sigue).

El `token` es un secreto de sesión: guárdalo solo en el dispositivo y mándalo en cada petición que lo pida. Trátalo como un texto opaco, sin comprobar su forma ni su longitud: desde el servidor v20 los tokens nuevos tienen 128 caracteres (antes, 64; los antiguos siguen valiendo).

## Acciones propias de Partes LAV

`config`, `enviar`, `pin`, `fallo` y `cargarLista` pertenecen a Partes LAV (lista de la oficina, envío de partes, cambio de PIN, registro de fallos de los móviles y carga de listas). **Otra app no debe usarlas.** `cargarLista` además exige una clave de administración que no se comparte.

`enviar` lleva `token`, `envioId` (UUID del envío, para no mandar un parte dos veces), `asunto`, `ref`, `cuerpo` y `archivos` (de 1 a 12; PDF y DRP en `base64`, el resto en `texto`; solo se admiten `.pdf`, `.txt`, `.json`, `.jpg`/`.jpeg` y `.drp`, y el tipo lo pone el servidor según la extensión). Los adjuntos no pueden pasar de 24 MB en total (Gmail admite 25). Responde `recibido` (fecha) y, si el parte ya había llegado, `repetido: true`.

## Pendiente (aún no existe)

Para que dos apps compartan el registro sin mezclar sesiones, falta:

- Una acción **`validar`** (`token` → `nombre`, `email`, `estado`) que la otra app use para comprobar quién es el usuario.
- **Tokens por aplicación**: que un token creado en una app no valga en la otra para acciones propias de esa app.

Hasta que se hagan, **no uses el token de Partes LAV como permiso de nada importante en otra app**: cualquier token válido de una serviría en la otra.

## Reglas para quien conecte otra app

1. No pedir ni guardar el PIN del usuario fuera de la llamada a `login` / `registro` / `nuevoPin`.
2. No leer ni modificar la hoja de datos directamente; todo pasa por esta API.
3. Mostrar al usuario el texto de `error` tal cual: está escrito para él.
4. No hacer pruebas masivas de `codigo`: cada una manda un correo real y hay un límite diario.
