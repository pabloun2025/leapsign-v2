# Matriz de interoperabilidad — estado real

No hay evidencia de compatibilidad con una instalación real de FirmaEC o Adobe.
Se ha probado una variante experimental de LibPDF 0.5.3 con certificados
sintéticos en Node y Chromium, contrastada contra pyHanko. No es todavía una
función conectada a la aplicación ni demuestra compatibilidad con visores reales.

| Cadena / caso | Estado | Evidencia |
|---|---|---|
| PDF canónico preparado → firma pyHanko → validador LeapSign v2 | Correcto | Test `test_real_pades_signature` |
| Dos / tres firmas pyHanko → validador v2 | Correcto | Tests secuenciales, firmas anteriores incluidas |
| Servicio HTTP privado → subproceso → validación real | Correcto | `test_real_http_worker_validation` |
| Certificado vencido, revocado, sin capacidad de firma | Rechazado | Tests con CA/CRL sintéticas |
| PDF modificado, hash distinto, cola sin nueva firma válida | Rechazado | Python, contratos TS y SQL |
| Primera firma con contenido de página sustituido en revisión incremental | Rechazado | Test `test_first_signature_cannot_replace_page_content` |
| P12 → LibPDF experimental en Chromium → validador v2 | Correcto en laboratorio | Tres firmas visibles, CA sintéticas EC/ES; worker separado |
| Local LibPDF → externo pyHanko → local LibPDF | Correcto en laboratorio | Las tres firmas verificadas, sin sustituir FirmaEC/Adobe reales |
| Firma LeapSign local P12/PFX → FirmaEC actual | No ejecutado | Falta prueba con instalación real |
| Firma FirmaEC → LeapSign local → FirmaEC | No ejecutado | Faltan motor y fixture real |
| Firma LeapSign local → Adobe → LeapSign | No ejecutado | Faltan motor y Adobe real |
| Contraseña P12 incorrecta / archivo inválido | Rechazado en laboratorio | Motor Node y contraseña incorrecta también en Chromium |
| Contenedor CMS insuficiente | Rechazado en laboratorio | Reserva de 16 bytes insuficiente |
| Certificado local vencido / sin uso de firma | Rechazado por validador independiente | El motor puede firmar matemáticamente; no confundir con aceptación |
| QR decodificado desde PDF firmado renderizado | Correcto en laboratorio | Poppler + jsQR; identificador URN ficticio, no servicio de verificación |
| Rotaciones 90/180/270, conservación y posición PDF | Correcto en laboratorio | No demuestra aún orientación del sello en la futura vista previa |
| Worker sin subidas HTTP ni Web Storage | Correcto en ejecuciones observadas | CSP connect-src none; sólo 2 GET estáticos; no es garantía universal |
| Concurrencia de dos conexiones PostgreSQL independientes | No ejecutado | PGlite usa una conexión serializada |
| Flujo completo de usuario en navegador v2 | No ejecutado | Sin interfaz/endpoints públicos conectados |

## Procedimiento obligatorio antes de declarar compatibilidad

1. Generar un PDF sin datos personales y certificados **de prueba**, no privados
   de producción. Nunca adjuntar contenedores ni contraseñas al repositorio.
2. Registrar versión exacta y plataforma de FirmaEC y Adobe, motor y política.
3. Firmar desde navegador; comprobar PDF, cadena incluida, nombre, fecha, motivo,
   ubicación, QR y posición. Guardar SHA-256, no secretos ni capturas con claves.
4. Abrirlo en FirmaEC actual y registrar el resultado de validación de todas las
   firmas. Añadir otra firma en FirmaEC y volver a comprobar en los tres sistemas.
5. Repetir en sentido inverso, y con Adobe como firmador externo. Incluir dos y
   tres firmas, tamaños/orientaciones/rotaciones distintos y PDF multipágina.
6. Probar rechazo de bytes modificados, ByteRange incorrecto y revisión posterior
   no firmada. Si un visor alerta sobre cambios o confianza, no marcar el caso OK.
7. Registrar hashes de cada revisión, informes y capturas de validación sin
   secretos en un directorio de evidencia. Separar validez matemática, confianza
   de CA, revocación y ausencia de modificaciones no permitidas.

Una apariencia parecida a FirmaEC o la presencia de `/Sig` no prueban compatibilidad.
