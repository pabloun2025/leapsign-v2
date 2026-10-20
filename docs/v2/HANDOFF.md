# Continuidad: LeapSign Firmador v2

## Identidad y separación

Repositorio: https://github.com/pabloun2025/leapsign-v2
Origen: historia completa de firmador hasta 48402d61ec8a4607b10d741b762569e496173906.
Se conservan historial, LICENSE AGPLv3, NOTICE y atribuciones de terceros.
Este repositorio no tiene conexión automática de despliegue y no contiene
secretos ni documentos de usuarios. Las guías no versionadas del antiguo
workspace no se han copiado. Tampoco se copian archivos .env ni node_modules.

Dominio futuro: https://leapsign.app. Pruebas: https://pruebas.leapsign.app.
V1 debe conservarse intacta en firma.veryfacil.org y repositorio firmador.
No basta este checkout para completar la separación: falta crear un entorno
Codex nuevo que monte solo este repositorio y solo credenciales de v2.

## Lo que realmente funciona y lo que falta

Hay UI aislada con PDF.js, coordinador, contratos HTTP, handlers de preparación,
adaptadores privados Auth/SQL/Storage, intenciones con caducidad y nonce hash,
validador Python criptográfico estricto y laboratorio de firmas sintéticas.
No hay todavía login/sesión integrado, recepción completa del PDF y persistencia
validada, recibo de resultado incierto ni un flujo público end-to-end.
El motor visible experimental aún necesita integración mantenible de producción.
FirmaEC/Adobe reales y concurrencia con varias conexiones siguen pendientes.
No describir pruebas sintéticas como evidencia de interoperabilidad real.

Estado verificado antes de separar: 212 tests TypeScript, build correcto y
32 comprobaciones SQL aisladas (12 preparación + 20 intenciones). Repetir para
informar resultados actuales. Python con laboratorio completo: 89 en ejecución
anterior; no están verificados automáticamente por npm test.

## Backend v2 YA provisionado (20 octubre 2026)

Proyecto lbreydchhskrrmpzniem, LeapSign v2, Frankfurt. Management verificado con
SUPABASE_V2_ACCESS_TOKEN; no usar la credencial Management como sesión de usuario.
Aplicadas 001_intents.sql y 002_document_filename.sql: NO repetirlas.
SHA256 001: d9a97b10b6471a2a140e32597899d6895d87e7cbeb484c5f689cfa1c5546c9eb
SHA256 002: 096bcc64f578a013b771a636489723d7fd99e36ecdb66e12caf259bf85ab8f69
Seis tablas signing_v2 con RLS; roles anon/authenticated sin USAGE sobre esquema
ni permisos de funciones privadas. Sin usuarios ni documentos creados.
Bucket v2-pdfs privado, application/pdf, máximo 10485760 bytes.
Flags direct/external/profile false. Auth Site URL/redirect exactos a pruebas;
disable_signup true, mailer_autoconfirm false. No SMTP configurado para v2.
No planes de pago activados; no Worker ni validador desplegados.

## Próximo trabajo

1. Crear entorno Codex independiente y verificar sus accesos sin secretos v1.
2. Completar sesión __Host-leapsign-v2 con Secure/HttpOnly/SameSite=Strict,
   cuotas compartidas que fallen cerrado y driver privado de privilegios mínimos.
3. Recepción de PDF, validador privado, commit/CAS inmutable y recibo recuperable.
4. Recorrido de varios firmantes con certificados sintéticos, retención y fallos.
5. Elegir alojamiento del validador y confianza/revocación operativa; revisar
   costes antes de contratar. No aceptar cualquier raíz aportada por un usuario.
6. Preparar Worker exclusivo y entorno de pruebas restringido. No publicar
   el laboratorio ni activar firma real antes de cumplir puertas técnicas.

El archivo docs/v2/delivery-status.md contiene historia de avances: sus frases
sobre ausencia de recursos remotos son anteriores a esta provisión; este
documento precisa el estado actual. Documentación legacy no autoriza cambios v1.
