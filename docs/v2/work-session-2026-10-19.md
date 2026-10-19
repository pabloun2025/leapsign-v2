# Trabajo autónomo v2 — 19 de octubre de 2026

Instrucción vigente: avanzar implementación y pruebas sin nuevas instrucciones,
**sin publicar nada de Firmador/LeapSign**. No desplegar la vista previa, no tocar
v1, dominios, permisos o proveedores y no enviar main. Trabajar en la rama actual
`feature/leapsign-firmador-v2`, con commits locales recuperables.

La ejecución depende de que la sesión cloud permanezca activa. No existe en esta
sesión una herramienta de tareas recurrentes/nocturnas; no se debe prometer un
agente activo tras suspenderse el entorno ni simular trabajo con esperas.

## Orden de trabajo

1. Preservar el estado de la vista previa estática sin publicarla.
2. Implementar el transporte v2 de datos públicos, límites de respuesta,
   cancelación y errores normalizados; ningún certificado en peticiones.
3. Mejorar la revisión real del PDF y la integración local con controles de
   memoria, secuencia y validación independiente.
4. Pruebas sintéticas y de regresión. Documentar los casos no ejecutables aquí
   (FirmaEC/Adobe reales, confianza operativa y publicación).
5. Guardar checkpoints y un informe de resultados comprobados.

La solicitud previa de acceso Cloudflare permanece como borrador sin activar;
no es requisito para el desarrollo ni autoriza ninguna publicación.
