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

## Avances comprobados en la sesión

- Transporte HTTP sin certificados, campos extra, rutas ajenas o redirecciones;
  respuestas limitadas y cancelación de cuerpos que se quedan esperando.
- Esquemas públicos compartidos y rechazo de fechas de intención inválidas,
  contadores fraccionarios/negativos e informes inesperados.
- PDF.js 6.4.299 fijado (Apache-2.0): visor de PDF real, páginas, giro, zoom,
  texto accesible y marcador de firma. Sin iframes, acciones PDF o recursos
  externos. Copia de bytes y worker separado; límites de tamaño/canvas/tiempo.
- Fallback comprobado cuando Worker está bloqueado. UI comprobada a tres anchos,
  incluyendo canvas real y axe. Ningún servicio externo recibió datos de prueba.
- Corrección de los flags: el validador y SQL no exigen activar firma externa
  para validar una firma directa. Pruebas positivas de ambos modos.
- Contenido activo/adjuntos rechazados también en el validador v2, incluidos
  objetos comprimidos/huérfanos y nombres escapados, sin confundir texto normal.
- Las pruebas Deno de inspección PDF v1 también se ejecutaron en aislamiento,
  sin permisos de red ni variables de entorno para el código de test.
- Paquete estático construido y probado sólo en loopback con su CSP real: PDF
  visible, cero POST y cero solicitudes externas. No se publicó ni se subió.
- Carga diferida del visor para reducir la descarga inicial en móvil; el fallo
  de carga se contiene en el visor y conserva la alternativa de descarga.

## Límites que permanecen

No hay publicación, API Auth/cuotas/Storage conectada, ni infraestructura v2
creada. El motor visible sigue como extensión experimental de laboratorio;
faltan la integración final del sello y la matriz FirmaEC/Adobe real. No se
configuraron autoridades de producción ni actualización operativa de revocación.
Las pruebas SQL WASM no prueban concurrencia multi-conexión PostgreSQL real.
