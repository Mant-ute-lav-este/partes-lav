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

Google a veces pierde la respuesta aunque haya hecho la acción (llega una página HTML en lugar de JSON). **Si la respuesta no es JSON, repite la misma petición con el mismo `peticion`**: el servidor la reconoce durante 30 minutos y devuelve la respuesta guardada, sin volver a mandar el correo ni registrar dos veces. Partes LAV reintenta hasta 5 veces con 45 s de espera cada una.

## Acciones para el registro y la entrada

| Acción | Datos | Devuelve | Notas |
|---|---|---|---|
| `codigo` | `email`; `para: 'pin'` si es para recuperar el PIN | `{}` | Envía un código de 6 cifras al correo (caduca en 10 min). Máximo 3 por correo y hora. |
| `verificar` | `email`, `codigo` | `nombres[]` | Comprueba el código y devuelve los nombres de la lista de trabajadores que aún no tienen cuenta. |
| `registro` | `email`, `codigo`, `nombre`, `pin` (4–6 cifras) | `token`, `estado: 'pendiente'`, `nombre` | Crea la cuenta como **pendiente**; la oficina la aprueba desde un enlace que le llega por correo. |
| `login` | `email`, `pin` | `token`, `estado`, `nombre` | 5 PIN erróneos bloquean 15 minutos. |
| `estado` | `token` | `estado`, `nombre` | Para saber si ya la han aprobado. |
| `nuevoPin` | `email`, `codigo`, `pin` | `token`, `estado`, `nombre` | «He olvidado el PIN». Antes hay que pedir `codigo` con `para: 'pin'`. |

`estado` puede ser `pendiente`, `activo` o `rechazado`.

El `token` es un secreto de sesión: guárdalo solo en el dispositivo y mándalo en cada petición que lo pida.

## Acciones propias de Partes LAV

`config`, `enviar`, `pin` y `cargarLista` pertenecen a Partes LAV (lista de la oficina, envío de partes, cambio de PIN y carga de listas). **Otra app no debe usarlas.** `cargarLista` además exige una clave de administración que no se comparte.

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
