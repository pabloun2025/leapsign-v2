# LeapSign v2: paridad funcional de v1 con firma local

Fecha: 22 de octubre de 2026  
Rama objetivo: `v2-staging`  
Ámbito: repositorio, Worker, Supabase y validador exclusivos de LeapSign v2

## Propósito

LeapSign v2 debe presentarse y comportarse como una evolución completa de
LeapSign v1. Mantendrá las opciones de coordinación documental de v1 y añadirá
la firma local en el navegador como alternativa al recorrido existente de
descargar el PDF, firmarlo con una aplicación externa y volver a subirlo.

No se migrarán usuarios, documentos, contactos, rankings ni ningún otro dato de
v1. No se reutilizarán sus tablas, funciones, dominios, credenciales o recursos.
Las capacidades se reimplementarán sobre el modelo privado y validado de v2.

## Principios invariables

- Una sola versión del PDF está vigente en cada momento.
- Cada nueva versión aceptada deriva de la versión vigente y conserva las firmas
  anteriores.
- Solo el servidor decide quién puede descargar, firmar, subir, avanzar turnos,
  recuperar versiones o cerrar un proceso.
- Los PDF permanecen en Storage privado y se entregan mediante autorización
  temporal.
- P12/PFX y contraseña nunca salen del navegador ni se guardan en almacenamiento,
  telemetría o logs.
- Tanto la firma local como la firma externa terminan en la misma recepción,
  validación estricta, idempotencia y persistencia de v2.
- Producción confía únicamente en autoridades incorporadas a la política pública
  de v2. Una cadena desconocida o una revocación indeterminada falla cerrada.
- Integridad criptográfica, confianza, vigencia y revocación se presentan como
  resultados separados. El software no declara por sí solo validez jurídica.
- Toda operación con coste conserva los guardas económicos, cuotas y reservas
  atómicas de v2.

## Modos de proceso

### Proceso dirigido

El propietario define una secuencia de hasta veinte participantes. Cada
participante recibe una invitación individual y solo puede actuar durante su
etapa. Es la evolución directa del flujo dirigido de v1 y del flujo secuencial
que ya existe en v2.

### Ronda abierta

El propietario comparte un enlace de ronda. Las personas pueden solicitar turno,
consultar su posición y recibir un turno exclusivo con vencimiento. Una ronda
puede aceptar un número definido de firmas o permanecer abierta hasta que el
propietario decida cerrarla.

Cuando una persona obtiene el turno, el servidor crea o activa una etapa v2
asociada a su identidad de invitado. La cola no puede modificar documentos,
versiones ni intenciones directamente.

La protección opcional de una ronda se implementará con un secreto almacenado
únicamente como derivación resistente y con comparación constante. No se copiará
el mecanismo heredado de v1.

## Formas de firmar durante un turno

La pantalla de la persona firmante ofrece dos opciones equivalentes:

1. **Firmar aquí.** Descarga la versión vigente al contexto autorizado, abre el
   P12/PFX localmente, aplica la firma visible en un Web Worker y envía únicamente
   el PDF resultante.
2. **Firmar con otra aplicación.** Descarga la versión vigente, permite firmarla
   con FirmaEC, Adobe u otra herramienta y recibe después el PDF firmado.

Ambas opciones usan una intención de firma de corta duración ligada a documento,
versión, etapa, actor y nonce. La recepción exige continuidad con el PDF canónico,
rechaza bytes alterados fuera de las revisiones permitidas, llama al validador
autenticado y realiza el avance mediante compare-and-swap. Repetir la misma
entrega devuelve el recibo existente y no crea otra versión.

## Capacidades de paridad

### Cuenta y acceso

- Registro, confirmación de correo, login, recuperación y cambio de contraseña.
- Requisitos de contraseña visibles, confirmación de contraseña y control para
  mostrar u ocultar el valor.
- Perfil del propietario y cierre de sesión.
- Enlaces de invitado de un solo intercambio y cookie HTTP-only.

### Creación y seguimiento

- Título, mensaje opcional, PDF inicial y modo dirigido o abierto.
- Número esperado de firmas o cantidad abierta cuando el modo lo permita.
- Acceso opcional protegido para rondas abiertas.
- Recorrido guiado: crear, compartir e inspeccionar seguimiento.
- Copiar enlace y compartir mediante WhatsApp; el correo se envía por el sistema
  transaccional cuando corresponde.
- Lista de procesos en curso y anteriores, con estados de carga, vacío y error.
- Vista del PDF vigente, progreso, turno actual, agenda/cola, invitaciones y
  participantes.
- Historial de versiones con autor, fecha y resultado técnico.

### Contactos frecuentes e invitaciones

- Agenda privada por propietario con nombre, correo, uso reciente y frecuencia.
- Buscar, ordenar, paginar, editar y eliminar contactos.
- Elegir contactos existentes o introducir participantes nuevos.
- Guardar como contacto solo mediante consentimiento explícito del propietario.
- Detectar duplicados dentro del proceso y respetar la capacidad restante.
- Invitación, reenvío, recordatorio, entrega, rebote y supresión.

### Controles del proceso

- Pausar y reanudar.
- Liberar un turno activo.
- Cancelar o cerrar el proceso.
- Recuperar una versión anterior sin borrar el historial de auditoría. La
  recuperación crea un nuevo evento canónico y deja inaccesibles las ramas
  descartadas.
- Confirmar la versión final aun cuando exista una advertencia explícita por
  firmas esperadas pendientes.
- Eliminar o purgar según la política de retención, con trabajos reintentables.
- Registrar incidencias del firmante sin incluir el PDF ni secretos en el texto
  de auditoría.

### Documento final

- El propietario puede generar un enlace limitado para el PDF final.
- El destinatario no necesita cuenta y no ve participantes, historial o controles.
- El enlace usa una capacidad independiente, expira con la retención del archivo
  y nunca expone una URL permanente de Storage.
- Acciones de copiar, WhatsApp y `mailto:`. Resend no se usa para destinatarios
  arbitrarios introducidos en esta pantalla.

### Correo

- Outbox idempotente para confirmaciones propias, invitaciones, turno disponible,
  recordatorios, firma recibida, bloqueo, revisión final, recibo y descarga final.
- Separación mínima de un minuto por destinatario, reintentos acotados, webhook
  firmado y supresión por rebote permanente o queja.
- Plantillas editables únicamente por administración y con variables en lista
  cerrada. No se admite HTML o URL arbitraria sin sanitización.
- La promoción de turno y los avisos funcionan mediante tareas programadas, sin
  depender de un navegador abierto.

### Minijuego de espera

- El juego aparece solo en la sala de espera de una ronda abierta y nunca bloquea
  la actualización de la cola.
- Controles de teclado, táctiles y visibles; pausa manual, automática al ocultar
  la pestaña y soporte para movimiento reducido.
- Partidas autorizadas por tickets aleatorios de un solo uso, caducidad de diez
  minutos y simulación determinista validada en el servidor.
- El servidor calcula la puntuación; no confía en un marcador enviado.
- El podio público contiene como máximo tres alias consentidos. No publica nombre,
  correo, usuario, proceso o documento.
- Alias de 2 a 24 caracteres con alfabeto limitado, cuotas globales y por origen,
  límite de entradas y duración máxima.

### Administración y operación

- Usuarios, estados de acceso, invitación, recuperación, suspensión y reactivación.
- Métricas de cuentas, procesos, turnos, versiones, correos, validaciones y purgas.
- Pausa, reanudación, liberación, cancelación y purga administrativas con motivo.
- Configuración de comunicaciones y mantenimiento.
- Plantillas de correo y reprocesamiento de trabajos fallidos.
- Auditoría administrativa separada y sin acceso al contenido de los PDF.
- Los permisos se verifican en servidor. Las operaciones sensibles requieren un
  rol v2 explícito; se preparará soporte AAL2 antes de exponer mutaciones críticas.

## Modelo de datos

Se conservarán las tablas actuales de `signing_v2` para documentos, versiones,
etapas, intenciones, auditoría, invitaciones, sesiones de invitados, outbox y
cuotas. Las migraciones nuevas añadirán módulos aislados:

- `process_access`: modo, protección de ronda y capacidad esperada.
- `queue_entries` y `turn_leases`: espera y exclusividad temporal.
- `owner_contacts`: agenda privada del propietario.
- `process_incidents`: incidencias sanitizadas.
- `final_shares`: capacidades revocables y caducidad, guardando solo huellas.
- `arcade_runs` y `arcade_records`: tickets y podio mínimo.
- `email_templates`: plantillas versionadas de variables cerradas.
- `lifecycle_jobs`: promoción, retención, purga y reintentos.
- `admin_roles`, `admin_settings` y `admin_audit`: control operativo de v2.

Todas tendrán RLS habilitado. `anon` y `authenticated` no recibirán acceso directo
al esquema privado ni a RPC internas. El Worker usará únicamente RPC específicas
con entradas validadas y privilegios mínimos.

## API del Worker

Los contratos existentes de sesión, procesos, preparación, recepción y
verificación permanecen compatibles. Se incorporarán grupos de rutas v2:

- `/api/v2/processes/:id/participants`
- `/api/v2/processes/:id/contacts`
- `/api/v2/processes/:id/actions`
- `/api/v2/processes/:id/versions`
- `/api/v2/processes/:id/incidents`
- `/api/v2/processes/:id/final-share`
- `/api/v2/rounds/:id/access`
- `/api/v2/rounds/:id/queue`
- `/api/v2/rounds/:id/turn`
- `/api/v2/arcade/*`
- `/api/v2/admin/*`

Cada grupo tendrá autenticación explícita, origen estricto, límites de cuerpo,
timeouts, cuotas, respuestas estructuradas y pruebas de autorización. No habrá
acceso del navegador a la service role ni a RPC privadas.

## Experiencia e identidad visual

La interfaz recuperará la dirección de “mesa documental” de la versión final de
v1: verde tinta, marfil cálido, acento dorado, bordes precisos, sombras contenidas,
tipografía funcional Avenir y la rana saltando entre PDF. Se eliminan los títulos
en Georgia que hacen que v2 parezca otro producto.

Las pantallas serán:

- acceso, registro, recuperación y confirmación;
- espacio del propietario con creación y procesos;
- composición de invitados y agenda de contactos;
- seguimiento completo y controles;
- acceso de ronda, sala de espera y minijuego;
- turno de firma con selector “Firmar aquí” o “Firmar con otra aplicación”;
- revisión, recibo técnico y documento final;
- perfil, páginas legales y administración.

La advertencia BCE se mostrará junto a la elección de certificado y en los
resultados técnicos, no como una franja dominante en todas las pantallas. Los
errores `UNSUPPORTED_ISSUER`, `CHAIN_NOT_TRUSTED`, alteración y revocación se
traducirán a lenguaje claro conservando el código técnico y el emisor detectado.

## Estados, concurrencia y fallos

- Las mutaciones usan claves idempotentes y compare-and-swap.
- La cola y la promoción usan bloqueo transaccional y `skip locked` cuando
  corresponda.
- El sondeo se serializa, se pausa sin conexión o con la pestaña oculta y conserva
  el último estado válido ante un fallo posterior.
- Si correo o minijuego fallan, la firma y la cola siguen funcionando.
- Si Storage, base de datos o validador fallan, no se avanza turno ni se marca una
  firma como aceptada.
- Si la revocación no está lista, la recepción falla cerrada y conserva un recibo
  recuperable de estado incierto o rechazado.
- Las acciones destructivas exigen confirmación específica y muestran alcance y
  efecto antes de ejecutarse.

## Estrategia de entrega

La implementación se dividirá en incrementos que permanecen desactivados hasta
completar sus puertas de seguridad:

1. Sistema visual y experiencia de cuenta.
2. Panel, creación, contactos e invitaciones.
3. Seguimiento, historial y controles del proceso.
4. Rondas abiertas, cola y turnos.
5. Firma dual local/externa y recibos integrados.
6. Documento final compartible.
7. Minijuego y podio.
8. Administración, plantillas y mantenimiento.
9. Prueba integral, activación y despliegue.

No se publicarán controles simulados. Una función solo aparecerá cuando su API,
persistencia, autorización, estados de error y pruebas estén operativos.

## Verificación obligatoria

- Pruebas unitarias de cliente, dominio, contratos y renderizado de correos.
- Pruebas SQL de permisos, concurrencia, idempotencia, cola, rollback, podio y
  mantenimiento.
- Pruebas del Worker con owner, invitado, anónimo, administrador y orígenes no
  autorizados.
- Pruebas Python de política, cadena, vigencia, revocación, alteración y
  conservación de firmas.
- Navegador a 1440, 768 y 390 píxeles, teclado, foco, movimiento reducido y
  comprobación de consola.
- Recorrido publicado de cuenta, proceso dirigido, ronda abierta, contactos,
  dos firmantes, las dos formas de firma, recibo, versión final y reintento.
- Inspección de red y almacenamiento para demostrar que P12/PFX y contraseña no
  salen del navegador.
- Prueba de fallos de correo, validador, CRL, Storage y concurrencia sin avance
  incorrecto.
- `npm test`, `npm run build`, pruebas Python y comprobación de worktree limpio.

## Criterio de publicación

Cloudflare y Render deben ejecutar el mismo commit de `v2-staging`. Las nuevas
migraciones se aplicarán únicamente al proyecto Supabase v2. Los secretos se
mantendrán cifrados. La publicación no tocará `firmador`, `firma.veryfacil.org`,
el proyecto Supabase de v1 ni recursos asociados.
