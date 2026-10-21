# LeapSign v2: cuentas, invitados, administración y correo fiable

La especificación del usuario de 21 de octubre de 2026 es la fuente normativa.
Este documento fija únicamente las decisiones de implementación necesarias.

## Límites

Todo vive en `leapsign-v2`, Supabase `lbreydchhskrrmpzniem`, Worker
`leapsign-v2-ui-preview`, Render `leapsign-v2-validator` y
`pruebas.leapsign.app`. V1 se usa como referencia de solo lectura. No hay planes
de pago ni credenciales en el cliente.

## Arquitectura

Los propietarios usan Supabase Auth con confirmación, recuperación y renovación
en memoria. El access token se intercambia por cookie host-only HTTP-only; nunca
se guarda una service role en el navegador. Los firmantes usan una invitación
aleatoria de un solo uso que se intercambia por una sesión invitada HTTP-only,
expirable y ligada a un único turno. La base conserva solo hashes de ambos
tokens.

La administración se expone bajo `/administracion`; cada operación vuelve a
comprobar en servidor `app_metadata.role === "admin"`. El Worker llama a Auth
Admin con la service role ya cifrada. No existe operación de borrado: suspender
y reactivar cubren el ciclo de vida. Toda mutación administrativa genera una
auditoría privada.

Una migración nueva crea invitaciones, sesiones invitadas, auditoría
administrativa, outbox, intentos de entrega, supresiones y funciones privadas.
Las transacciones funcionales insertan eventos idempotentes. El cron del Worker
reclama lotes, envía por Resend, registra el identificador y aplica backoff o
`dead_letter`; nunca hace depender la firma de la respuesta del proveedor. El
webhook verifica Svix sobre los bytes exactos antes de registrar entrega,
rebote, queja o fallo y suprime rebotes permanentes/quejas.

## Seguridad y privacidad

Los asuntos y plantillas son identificadores cerrados; todo dato de usuario se
escapa antes de HTML. No se aceptan remitentes, asuntos o HTML del cliente. Las
cuotas se aplican por actor, destinatario, proceso e IP anonimizada. Outbox y
auditoría no contienen PDF, P12/PFX, contraseñas ni claves privadas. Los tokens
solo aparecen en el enlace operativo imprescindible y nunca en logs.

## Interfaz

La UI reutiliza los recursos, tipografía, colores, estructura, textos y estados
inventariados en `docs/v2/v1-visual-reference.md`. Registro, confirmación,
login, recuperación y cambio de contraseña comparten la tarjeta aprobada. El
dashboard funcional existente se envuelve, no se sustituye. Perfil y
administración usan el mismo sistema visual. Errores 401/403/404/caducidad/503
tienen una acción primaria inequívoca.

## Despliegue por puertas

El código, las migraciones y las pruebas pueden completarse sin Resend. No se
habilitan registro, SMTP, envío, webhook ni despliegue final hasta disponer de
`RESEND_API_KEY`, verificar el subdominio y guardar los secretos derivados.
