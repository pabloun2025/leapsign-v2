# Vista previa de interfaz — todavía no publicada

Aplicación estática independiente para revisar la pantalla v2. **No firma ni
valida documentos**, no conecta con Supabase/Resend y no se deben seleccionar
certificados reales. Las operaciones de la demo son ficticias y están señaladas.

La entrada es `v2/lab/ui`, nunca `src/main.tsx`. La CSP de publicación prohíbe
conexiones, workers, iframes y envíos HTML. No hay bindings, backend, bucket ni
servicios de pago asociados a esta configuración. No se garantiza un tope de
facturación del proveedor por configurar una vista previa estática.

## Construir

```bash
npm ci --ignore-scripts --cache /tmp/leapsign-npm-cache
node scripts/build-v2-preview.mjs
```

El script exige una revisión guardada sin cambios tracked pendientes. Genera
`v2/preview/dist` y un ZIP de entrega bajo `v2/preview/artifacts`, sin escribir en
el `dist` de v1. Incluye la revisión, el código fuente correspondiente, AGPLv3 y
las licencias de las dependencias distribuidas. Las carpetas tutoriales sin
versionar y cualquier `.env` sin versionar quedan fuera del archivo fuente.

## Publicación suspendida por el propietario

Destino exclusivo: Worker `leapsign-v2-ui-preview` bajo su URL `workers.dev`.
No usar `wrangler.jsonc` de la raíz, no crear rutas de dominio, no modificar
`firmador` ni el DNS de `leapsign.app` o `firma.veryfacil.org`.

El propietario suspendió toda publicación el 19-10-2026. No desplegar, no enviar
cambios a main y no pedir credenciales como requisito para continuar el trabajo
local. No hay URL publicada de esta vista previa.

El entorno actual no tiene una credencial de Cloudflare. La solicitud previa del
requisito seguro `CLOUDFLARE_API_TOKEN` con destino `api.cloudflare.com` quedó en
un borrador del entorno; no se necesita activar ese borrador para desarrollar.
Sólo si se vuelve a autorizar una publicación, el propietario podrá introducir
la credencial en la configuración del entorno, nunca en chat o en el repo.
El token debe estar restringido a la cuenta correspondiente y a la publicación
de Workers; no necesita DNS, R2, bases de datos, correo ni cambios de facturación.
Confirmar el ID de cuenta mediante el acceso autenticado antes de desplegar.

Después de habilitar el acceso se debe revisar/fijar Wrangler, ejecutar primero
un dry-run con `--config v2/preview/wrangler.jsonc`, verificar el destino exclusivo
y publicar sólo ese Worker. No hay despliegue remoto realizado ni URL confirmada.
La URL real se debe comprobar después de recibirla de Cloudflare, con el aviso de
prueba visible, cabeceras de seguridad y sin solicitudes a servicios de producción.
