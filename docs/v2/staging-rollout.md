# Despliegue independiente de v2

## Alcance aprobado el 20 de octubre de 2026

Preparar el despliegue de pruebas en `https://pruebas.leapsign.app` antes de
habilitar `https://leapsign.app`. V1, `firma.veryfacil.org`, Worker `firmador`,
su dominio y proyecto Supabase permanecen intactos. No activar planes de pago
sin aprobación. La autorización del plan no sustituye las puertas técnicas.

## Estado observado

- Consulta de solo lectura a Supabase Management: un proyecto, `Firmador`,
  referencia `lgsdoutarthfymbjgdrj`, activo. No hay backend dedicado v2 disponible
  para conectar; no crear tablas ni buckets v2 en ese proyecto.
- El entorno no tiene `CLOUDFLARE_API_TOKEN`. Existe un requisito guardado de ese
  nombre en el borrador del entorno, aún sin valor. La política activa tampoco
  permite `api.cloudflare.com`; el borrador sí lo incluye. Guardar un borrador
  no equivale a activar acceso ni publicar una aplicación.
- No hay configuración de backend v2 disponible en este entorno. No se han
  solicitado ni mostrado claves privadas, claves de base ni contraseñas.
- El servicio privado Python necesita alojamiento y política de confianza
  operativos. No se ha elegido ni contratado un proveedor para él.

## Secuencia

1. Completar sesión, cuotas compartidas, recepción/validación/persistencia del
   PDF, recibo recuperable y recorrido de varios firmantes. Mantener flags
   apagados mientras falten esas piezas.
2. Disponer de proyecto Supabase dedicado v2, con plan/coste confirmado antes
   de crearlo. Configurar acceso privado, grants mínimos, límites y retención.
   Las migraciones están fuera de las migraciones automáticas de v1.
3. Preparar el servicio de validación privado y confianza/revocación, con
   presupuesto reservado antes de invocarlo. No publicar el laboratorio
   sintético ni aceptar certificados de prueba como confianza de producción.
4. Crear Worker exclusivo `leapsign-v2-staging` y conectar únicamente
   `pruebas.leapsign.app`. No usar `wrangler.jsonc` de la raíz ni interpretar el
   preview estático como una aplicación funcional. Configuración dinámica y
   credenciales privadas no son variables VITE.
5. Restringir el acceso de pruebas y probar autenticación, caducidad, fallos de
   red, idempotencia, firma secuencial y navegadores. Repetir concurrencia con
   PostgreSQL de varias conexiones. Completar compatibilidad real FirmaEC/Adobe.
6. Habilitar dominio definitivo únicamente tras pasar esas pruebas. Mantener
   configuración de origen exacta por entorno, no aceptar ambos orígenes como
   autorización de una misma petición. La cookie __Host no comparte subdominios.
7. Recuperación: apagar nuevas firmas, conservar descargas y documentos válidos,
   restaurar únicamente código v2. No hacer rollback destructivo de tablas.

## Lo que puede hacer el propietario

Completar `CLOUDFLARE_API_TOKEN` en la configuración segura del entorno, nunca en
el chat. Debe estar limitado a la cuenta/zona correspondientes; no cambiar el
token de producción. Para backend v2, confirmar si existe otro proyecto o crear
uno en un plan sin coste disponible, sin aceptar una ampliación de pago.

No se ha publicado nada como parte de esta preparación. El soporte de los dos
dominios en código solo permite configurar el destino; no crea DNS ni servicio.
