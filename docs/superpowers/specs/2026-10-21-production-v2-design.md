# LeapSign v2 de prueba publicada — diseño de producción

## Objetivo y alcance

Publicar exclusivamente en `pruebas.leapsign.app` el recorrido v2 completo,
manteniendo intactos firmador y v1. La rama de entrega es `v2-staging`, Render
aloja el validador privado y Cloudflare ejecuta el Worker `leapsign-v2-ui-preview`.

## Límite de confianza

La política de producción contiene solo material público obtenido de fuentes
oficiales ecuatorianas y fijado por SHA-256. La primera versión soporta de forma
conservadora las cadenas cuya raíz e intermedia puedan verificarse por completo;
estar distribuido por FirmaEC no se presenta como acreditación jurídica vigente.
Una raíz sintética vive únicamente en fixtures de tests y debe ser rechazada por
la política de producción.

El resultado separa:

- integridad del PDF, ByteRange y CMS;
- correspondencia con la revisión anterior y conservación de firmas;
- construcción y confianza de la cadena;
- vigencia de certificados;
- revocación (`good`, `revoked`, `unknown` o `unavailable`);
- aceptación técnica, sin determinar efecto o validez jurídica.

No existe aceptación si falta una prueba verificable de revocación. Los datos
embebidos DSS/VRI se prefieren; OCSP y CRL solo se admiten con emisor, firma,
vigencia y origen autorizados. Cualquier acceso de red se limita por política,
host, dirección pública, redirecciones, tiempo y tamaño.

## Disponibilidad y despliegue

`/health` demuestra vida del proceso. `/ready` analiza el manifiesto, verifica
archivos y hashes e inicializa el motor; falla cerrado si algo no coincide.
`/validate` requiere Bearer token y devuelve códigos estables sin filtrar errores
internos. Render recibe la política dentro del repositorio y se redespliega solo
desde `v2-staging`.

El Worker usa exactamente
`https://leapsign-v2-validator.onrender.com/validate`. Las tres flags se activan
solo tras verificar el validador. `V2_VALIDATOR_TOKEN`,
`SUPABASE_V2_SERVICE_ROLE_KEY` y `SUPABASE_V2_PUBLISHABLE_KEY` permanecen como
secretos cifrados de Cloudflare antes y después del despliegue.

## Recorrido y consistencia

El propietario inicia sesión, crea un proceso con PDF privado y firmantes en
orden. El firmante autorizado obtiene el PDF vigente mediante una invitación
opaca y expirable, firma localmente en un Web Worker sin red y envía únicamente
el PDF. El servidor valida, persiste una versión inmutable y avanza con CAS. El
mismo envío recupera el mismo recibo; candidatos concurrentes, fuera de turno o
con hash distinto no consumen el turno.

Tras el último firmante el proceso entra en `final_review`. Solo una acción
explícita, autenticada e idempotente del propietario lo cambia a `completed`.
Antes de esa acción no se presenta como completado ni se ofrece el PDF final.

## Firmador local, apariencia y verificación

P12/PFX y contraseña no forman parte de ningún contrato de red, persistencia,
log o telemetría. El worker local no dispone de `fetch`, XHR, WebSocket,
EventSource ni `importScripts`; limpia buffers sensibles razonables y firma de
forma incremental. La CSP limita conexiones al origen v2 y Supabase v2.

La apariencia identifica LeapSign. El QR abre una verificación LeapSign que
muestra proceso, hash, firmante, fecha, integridad, confianza, revocación y
recibo; nunca atribuye la validación a FirmaEC.

## Criterio de terminado

Las suites Python, TypeScript, SQL/integración y build pasan sin omisiones
contadas como éxito. Desde Internet se verifica `/health`, `/ready`, validación
autenticada, alteración, cadena no confiable, firmas previas, flags y el recorrido
publicado. La compatibilidad y las limitaciones reales se documentan. La prueba
manual final utiliza un certificado real seleccionado solo en el navegador.
