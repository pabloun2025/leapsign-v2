# Seguridad de LeapSign

## Repositorio exclusivo de v2

Este es pabloun2025/leapsign-v2, NO firmador. Leer primero
docs/v2/HANDOFF.md y docs/v2/CLOUD-SETUP.md. No configurar acceso ni desplegar
contra firma.veryfacil.org, Worker firmador o Supabase lgsdoutarthfymbjgdrj.
Solo usar el backend v2 lbreydchhskrrmpzniem y credenciales dedicadas.
El código heredado de v1 permanece para trazabilidad/regresión: no es el
entrypoint de v2. Sus configuraciones están archivadas en legacy/v1 y no se
deben ejecutar. No restaurar un workflow automático de despliegue de v1.
npm run dev/build sirve/compila SOLO el laboratorio UI de v2, no un producto
funcional: no introducir certificados reales. No desplegar este laboratorio
como una aplicación completa. No aplicar otra vez las migraciones 001/002.
No crear worktrees, cambiar rama ni importar secretos del entorno de v1.

Preservar firma secuencial, documentos binarios, autorización por propietario y
plazos publicados. Revisar `docs/security-audit.md` para límites y pendientes.
Las operaciones facturables de Edge pasan por `_shared/economic-guard.ts` y la
reserva atómica `reserve_security_budget`; no introducir rutas de correo/carga
que eviten estos controles. Los límites internos no garantizan un tope de factura.
Ejecutar `npm test` y `npm run build` para cambios de seguridad. Las migraciones,
despliegues y recursos reales requieren autorización expresa; no realizar pruebas
masivas contra producción. No habilitar CadenaPDF contra este backend.
