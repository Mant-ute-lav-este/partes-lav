# Historial de versiones

La versión que ve el capataz está en Ajustes («Versión de la app»). Al publicar hay que subirla en `sw.js` y en `js/app.js` (lo hace `publicar.ps1`).

## 0.19.2 · 2026-10-27
- **Envío en segundo plano igual que el de la app**: el service worker (`sw.js`) hacía 3 intentos sin tiempo máximo y no apuntaba los fallos; ahora hace los mismos 5 intentos, con las mismas esperas (2, 4, 5 y 5 s) y 240 s máximo por intento, y apunta los rechazos del servidor para la hoja «Errores». Una prueba nueva carga el `sw.js` real y avisa si se separa de `js/salida.js`.
- Pruebas del servidor nuevas: PIN erróneo (bloqueo a los 5 fallos) y parte de más de 24 MB.

## 0.19.1 · 2026-10-27
- Guía rápida de capataces al día: botón «Enviar por Gmail (emergencia)», registro por nombre y apellidos (ya no se elige de una lista) y fotos borradas a los 30 días. «No realizado» y «No se han podido hacer fotos» ya estaban.

## 0.19.0 · 2026-10-27
- **«Enviar por Gmail (emergencia)»**: si un parte lleva más de 12 horas en la cola sin llegar a la oficina, la pantalla del parte lo avisa y ofrece ese botón. Al usarlo, el parte sale de la cola (para que no llegue dos veces cuando vuelva el servidor) y queda como «Enviado por Gmail» (`porGmail`). Antes de quitarlo de la cola, la app mira si ya ha llegado mientras tanto.
- Campo nuevo en el parte: `enCola` (fecha en que entró en la cola). Los partes que ya estaban en la cola antes de esta versión no la tienen y no muestran el botón (siguen con el enlace pequeño de Gmail).

## 0.18.2 · 2026-10-27
- **Fotos de partes antiguos fuera del móvil**: al abrir la app se borran las fotos de los partes enviados hace más de 30 días (la oficina ya las tiene). El parte se queda con todos sus datos, para repetirlo o rectificarlo, y se marca con `fotosBorradas` (fecha). Nunca se tocan borradores, partes cerrados ni nada que esté en la cola de envío; si la fecha del envío no se entiende, tampoco.
- En un parte así, la pantalla dice cuándo se borraron las fotos y «Ver el PDF» lo saca sin el anexo de fotos. Sin servidor (envío por Gmail) ya no se ofrece volver a mandarlo.
- «Corregir el parte» copia las fotos que sigan en el móvil y quita las borradas: la app pide fotos nuevas al cerrarlo, con un aviso al abrir la corrección.
- **Espacio usado en el Menú**: «Espacio usado: X MB». Si quedan menos de 300 MB, sale en rojo con «Queda poco sitio».

## 0.18.1 · 2026-10-27
- **Aviso de peso al cerrar el parte**: se calcula lo que pesará el correo (las fotos viajan dos veces en base64 más el PDF, unas 2,4 veces su peso). Por encima de 20 MB (Gmail admite 25) sale un aviso con «quita unas N fotos»: Cancelar vuelve al parte; Aceptar lo cierra igualmente. Si no se puede medir, el parte se cierra como siempre.
- **Anexo del PDF más ligero**: las fotos del anexo pasan de 1100 px y calidad 0,72 a 900 px y 0,65. Las fotos originales del Fotos_ y las del formato de protección de la vía (SUPER) no cambian.

## 0.18.0 · 2026-10-26 (con el servidor versión 13)
- **Registro sin la lista de trabajadores**: en el paso «¿Quién eres?» ya no sale la lista para elegir. Se escribe el nombre y al menos un apellido («Tu nombre y apellidos» → «Buscarme») y el servidor busca a esa persona (da igual el orden, las tildes y las mayúsculas). En el paso del PIN sale el nombre encontrado con «Si no eres tú, pulsa «Atrás»». Antes, cualquiera con un Gmail podía ver los nombres de todos.
- Servidor v13 (sin cambios para el capataz): abre la hoja de Google una sola vez por petición; los últimos números de cada capataz se guardan aparte en vez de leer la hoja Envios entera; un parte ya enviado no se puede mandar dos veces aunque falle su apunte en Envios; los envíos de más de 12 meses pasan solos cada lunes a la hoja «EnviosArchivo». La copia a ivandesvios la manda ahora Power Automate desde Outlook (el servidor gasta 1 correo por parte en vez de 2).
- Necesita el servidor versión 13: con el 12 el paso «Buscarme» da «Acción desconocida».

## 0.17.1 · 2026-10-26
- Los aparatos de dilatación se llaman ahora por el viaducto, el estribo y el PK («Sobre Río Magro E1 · 322+013») y siguen saliendo juntos en el grupo «Aparatos de dilatación».
- Lista de la oficina (servidor): 17 aparatos de dilatación con esos nombres (el del distribuidor Sur A-7 queda uno solo, con el PK 384+684); 86 aparatos en total.

## 0.17.0 · 2026-10-26
- **Varios aparatos en un mismo trabajo** (INFRA y SUPER): debajo del desplegable «Aparato» sale «+ Añadir otro aparato», y cada aparato lleva una ✕ para quitarlo (también «Otro (escribirlo)» en cada uno). Con uno, los PK se rellenan como siempre; con varios, del PK más bajo al más alto de todos (se pueden cambiar).
- Se guardan como texto («S2 MIN 2, S1 MIN 2»), así los partes de antes se abren igual y el Datos_ no cambia de formato. En el PDF, la columna APARATO pone uno por línea.
- Campo nuevo en el trabajo: `filasAparato` (las filas mientras se edita, también las vacías y las escritas a mano). Lo que vale es `aparato`.

## 0.16.4 · 2026-10-26
- **Aparatos de dilatación**: los aparatos cuyo nombre empieza por «AD» (p. ej. «AD V2 287+641») salen en el desplegable en su propio grupo, «Aparatos de dilatación», en vez de agruparse por el segundo trozo del nombre. Al elegir uno se rellenan solos los PK, como con los desvíos.
- Lista de la oficina (servidor, 2026-10-26): 18 aparatos de dilatación de la vía 2, Madrid-Valencia, del 287+641 al 393+818 (el del distribuidor Sur A-7 va con los dos nombres, 384+684 y 384+868, por una errata del listado en papel). Los PK de todos los aparatos se guardan como «km+mmm».

## 0.16.3 · 2026-10-21
- **Vías 1 a 5 también en maquinaria**: el tajo de maquinaria de vía y el trabajo de locomotora/dresina, que solo tenían Vía 1 y Vía 2, ahora ofrecen las cinco (se pueden marcar varias). El aviso de «falta la vía» dice «elige al menos una vía».

## 0.16.2 · 2026-10-21
- **Varias vías en un mismo trabajo** (SUPER, tajo de maquinaria de vía y trabajo de locomotora/dresina): la vía pasa de botones «elegir una» a casillas que se pueden marcar varias. Se guardan como texto ordenado («1, 2»), así los partes de antes se abren igual y el PDF y el correo lo escriben tal cual. INFRA sigue con una sola vía. La columna VÍA del PDF es algo más ancha en SUPER y en la tabla de tajos.
- Arreglo: en el parte de dresina, el aviso de máquina sin escribir decía «Escribe qué locomotora es»; ahora dice «Escribe qué dresina es». La locomotora no cambia.

## 0.16.1 · 2026-10-19
- **Papelera en los borradores**: cada borrador de la lista de inicio lleva una papelera a la derecha para borrarlo sin abrirlo (pide confirmación y borra también sus fotos). Solo en borradores: los cerrados, en cola y enviados no la llevan.

## 0.16.0 · 2026-10-19
- **Numeración tras reinstalar**: al descargar la lista de la oficina, el servidor dice el número más alto que ese capataz ya ha enviado de cada tipo (INF, SUP, MAQ, LOC, DRE) y el móvil sigue desde ahí. Antes, al reinstalar la app, volvía a la 0001 y podía pisar carpetas en Teams. Necesita el servidor versión 12; con el anterior la app funciona igual que antes.
- **Cerrar sesión con partes sin enviar**: ya no se deja (sale «Tienes N partes sin enviar. Envíalos antes de cerrar sesión.»), porque saldrían con la cuenta del siguiente que entre. Si hay borradores, avisa de que quien entre después los verá.

## 0.15.0 · 2026-10-16
- **EVB (entrega de vía bloqueada)** en los partes de maquinaria de vía y de dresina: pregunta obligatoria en «Jornada», «¿Va en entrega de vía bloqueada (EVB)?» Sí / No, una por parte.
- Puestos obligatorios según la EVB (en «Personal» salen marcados como OBLIGATORIO). Vía: con EVB, Encargado de trabajo y OMI; sin EVB, Maquinista tipo A. Dresina: con EVB, «ET / al amparo de» (el encargado) y OMI; sin EVB, Maquinista. El Piloto y los operarios, siempre opcionales. La locomotora no cambia: sin pregunta y con el maquinista obligatorio.
- La dresina tiene dos puestos nuevos: **Piloto** (opcional) y **OMI**. Orden: Maquinista · ET / al amparo de · Piloto · OMI · Operario/s.
- PDF: «EVB SÍ / NO» en la cabecera de vía y de dresina; el personal de la dresina incluye Piloto y OMI.
- Arreglo: en locomotora y dresina los avisos decían «Maquinista tipo A»; ahora dicen «Maquinista» (en vía sigue «Maquinista tipo A»).
- Campo nuevo en el parte: `evb` (true/false; sin contestar = vacío). Los partes enviados no cambian; los borradores antiguos de vía o dresina piden contestar la EVB al cerrar.

## 0.14.0 · 2026-10-16
- **Repetir el parte anterior** (INFRA y SUPER): al crear un parte, si hay uno anterior del mismo tipo, sale «¿Empezar igual que el último parte?» con casillas (todas marcadas) para copiar el personal, la maquinaria, los vehículos y las medidas antiincendios (también «Otras»). «No, empezar en blanco» lo crea como siempre; tocar fuera cancela sin gastar número.
- No se copian los trabajos, las horas extra, las fotos, el formato 1 ni las observaciones; la fecha y la jornada nocturna salen como en cualquier parte nuevo. Las medidas que ya no estén en la lista de la oficina no se copian.
- El parte copiado muestra arriba «Copiado del REF (fecha). Revisa quién ha venido hoy y los equipos.». Sigue el botón «Copiar el personal del último parte».
- Sin campos nuevos en los partes guardados. Maquinaria de vía, locomotora y dresina, sin cambios (más adelante).

## 0.13.1 · 2026-10-16
- **Guía rápida (PDF)**: explica «No realizado» (con su motivo, sin horas de vía, PK ni fotos) y la casilla «No se han podido hacer fotos» (con motivo; sale en rojo para la oficina).

## 0.13.0 · 2026-10-16
- **Trabajo no realizado** (INFRA y SUPER): «¿Trabajo finalizado?» tiene tres botones: Sí / No, sin terminar / No realizado. Con «No realizado» hay que elegir por qué (lluvia, sin corte de vía, falta de material, falta de personal o maquinaria, u otro escrito), y ya no se piden horas de vía, PK ni fotos. Se siguen pidiendo la referencia, la línea y el motivo de actuación. En el PDF, ¿FIN? pone «NO REALIZADO» y el motivo va en la descripción; en el correo, «[NO REALIZADO: motivo]».
- **No se han podido hacer fotos**: casilla en las fotos de cada trabajo, con motivo obligatorio (prohibido fotografiar, móvil sin batería o sin cámara, sin luz, u otro escrito). Permite cerrar el parte sin esas fotos, pero sale **en rojo** en el PDF y como aviso en el correo para la oficina.
- La columna ¿FIN? del PDF de INFRA/SUPER es algo más ancha (la descripción, algo más estrecha).
- Campos nuevos en cada trabajo: `noRealizado`, `motivoNoRealizado`, `sinFotos`, `motivoSinFotos` (y `noRealizadoOtro`, `sinFotosOtro`). Los partes anteriores se leen como siempre.

## 0.12.0 · 2026-10-16
- **Orden interno, sin cambios para el capataz**: `js/app.js` (unas 2750 líneas) se reparte en módulos por tema (estado, validaciones, modelo, campos, una vista por pantalla y eventos). Las pantallas, los textos y el formato de los partes guardados son los mismos.
- **Pruebas automáticas**: de 31 a 50. Se prueban las validaciones de los 5 tipos de parte con sus textos exactos, se pintan todas las pantallas y se crea un parte nuevo de cada tipo.

## Servidor · 2026-10-15
- **Copia de cada parte** a otros correos: fila `copia` en la pestaña Ajustes de la hoja (uno o varios correos separados por comas; se ignoran los mal escritos). Se cambia editando la hoja, sin tocar la app.
  - La copia es un **correo aparte** con el PDF y las **fotos sueltas en .jpg** con nombre completo (p. ej. `INF-0012_2026-10-15_T1_SIOS-12345_antes_1.jpg`). El correo de la oficina, el que lee Power Automate, no cambia.
  - Si la copia falla, el parte se da por enviado igualmente y el fallo se apunta en la hoja Errores (tipo «copia»).
- El contador de correos diarios cuenta **destinatarios** (como Google): un parte con una copia gasta 2 de los ~100 diarios.
- Desplegado como versión nueva de la implementación de siempre (la URL no cambia).

## 0.11.3 · 2026-10-14
- **Guía rápida** para capataces (1 página, PDF) en el Menú, con el permiso de cámara de Chrome, las fotos HEIC y qué hacer si algo falla. Queda guardada en el móvil y se abre sin cobertura.

## 0.11.2 · 2026-10-14
- **Registro de fallos de campo**: los errores de la app, las fotos que no se pueden usar y los envíos rechazados se mandan solos a la hoja «Errores» del servidor (sin nombre ni correo; se tachan correos, números largos y enlaces). Sin cobertura se guardan en el móvil (hasta 20) y salen después.
- Servidor desplegado como **versión 9** (la 8 se creó sin el código nuevo):
  - Cuenta los correos del día y avisa una vez al llegar a 70 (límite de Gmail gratuito ~100).
  - Envío de partes sin bloquear al resto de móviles mientras sale el correo; los reintentos no duplican correos.
  - Limpieza diaria de sesiones (180 días sin uso o cuentas dadas de baja).
  - El resumen de las 16:00 añade fallos del día, sesiones borradas y correos enviados.
  - Incluye las listas MaquinasVia (con columna Parte) y PersonalMaquinaria (aún vacías en la hoja).

## 0.11.1 · 2026-10-14
- **Fotos HEIC** (el formato de cámara de muchos móviles): si el navegador no puede abrirlas, la app las convierte a JPG en el propio móvil y se usan como cualquier otra foto. También se lee su fecha original. El convertidor (heic2any) se descarga solo cuando hace falta y queda guardado para funcionar sin cobertura.

## 0.11.0 · 2026-10-08
- **MAQUINARIA: primero se elige la máquina** y según cuál se abre su parte. Solo una máquina por parte.
  - Bateadora, Perfiladora o Estabilizador → parte de maquinaria de vía (el de la 0.10.0, ahora con una sola máquina). Referencias MAQ-.
  - Locomotora → **parte de trabajos con locomotora** (LOC-): nº de acta, salida y apartado, vagones (tolva o plataforma, últimos 4 dígitos del UIC, m³; aviso si una tolva pasa de 35 m³), procedencia del balasto, trabajo realizado (vía, PK, horas, trabajo, m³), combustible, kilómetros, observaciones, personal (maquinista, responsable de trabajos, operarios) y horas extra. De momento la locomotora se escribe a mano: la lista llegará más adelante.
  - Dresina → **parte de trabajos con dresina** (DRE-): UIC de la plataforma, telefonemas de entrada y de salida, y el resto como el de locomotora sin vagones (personal: maquinista, ET / al amparo de, operarios).
  - La semana se calcula sola a partir de la fecha. Todos se guardan en la carpeta Maquinaria de Teams.
- Servidor (`Code.gs`, pendiente de desplegar): la lista «MaquinasVia» lleva la columna «Parte» (via, locomotora o dresina).

## 0.10.0 · 2026-10-08
- Nuevo **parte de MAQUINARIA** de vía (tercer botón en la portada, para todos). Referencias MAQ-0001…
  - Jornada (fecha y horario), máquinas con sus horas (de momento Bateadora, Perfiladora y Estabilizador; se pueden poner varias o escribir otra), viaje (horas y lugares de salida y llegada).
  - Tajos sin límite: horas de llegada, inicio, fin y salida, vía 1 o 2, PK inicio y final, desvío/AD opcional; Nivelado, Alineado, Estabilizado, Registro y Perfilado con Sí/No obligatorio y sus detalles obligatorios cuando es Sí (método; Lev./Rip. máx. y PK si es calculado; ¿programada?; antes/después/ambos; cepillado).
  - Observaciones, personal por puesto (encargado, maquinista tipo A, piloto, OMI, operarios; pueden quedar vacíos) y horas extra como en INFRA y SUPER.
  - PDF sencillo y completo (el aspecto del papel llegará en la siguiente versión). Se guarda en Teams en `Partes/AAAA-MM-DD/Maquinaria/MAQ-0001_…` sin cambiar el flujo.
- Servidor (`Code.gs`, pendiente de desplegar): listas «MaquinasVia» y «PersonalMaquinaria» de la hoja. Mientras no estén, la app usa las tres máquinas de siempre y la lista general de trabajadores.

## 0.9.8 · 2026-10-08
- Parte SUPER: apartado opcional «Adjuntar formato 1» después de las medidas antiincendios. Foto de cámara o de galería (hasta 6, de una hoja cada una) con el impreso de cómo se protege la vía. Se guardan a 2400 px, con sello «FORMATO 1».
- PDF: «ANEXO FORMATO 1» después del anexo fotográfico, con el mismo diseño (dos fotos por página). Teams: archivos `Formato1_1.jpg`… en la carpeta del parte. Si falta la fecha original, se avisa a la oficina como en las demás fotos. El nombre «Formato 1» está en `js/util.js` (`FORMATO1`).

## 0.9.7 · 2026-10-08
- Aviso para la oficina (no para el operario) cuando una foto de galería no trae su fecha original y se usa la fecha del archivo: línea «N sin fecha original» en la tabla de trabajos del PDF, pie en rojo «SIN FECHA ORIGINAL» en el anexo y línea de AVISO en el texto del correo. El dato `fuenteFecha` (exif, captura o archivo) ya iba en los datos de cada foto.

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

- **v7** · 2026-10-08 · resumen diario de partes recibidos (todos los días a las 16:00, al correo de destino de los ajustes).
- **v6** · 2026-10-07 · copia de seguridad semanal de la hoja (lunes 3:00, carpeta «Partes LAV · Copias», 8 copias).
- **v5** · 2026-10-06 · aparatos con PK.
- Versiones anteriores (v1–v4): ver el historial de implementaciones en Apps Script.
