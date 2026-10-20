# LeapSign Firmador v2 — desarrollo independiente

Este es el repositorio exclusivo de **v2**, aún sin aplicación pública funcional.
Lee [el resumen de continuidad](docs/v2/HANDOFF.md) y
[la configuración del nuevo entorno Codex](docs/v2/CLOUD-SETUP.md).

`npm run dev` y `npm run build` usan únicamente el **laboratorio de interfaz v2**,
no el frontend heredado de v1. No uses certificados reales en ese laboratorio.
No hay un comando de publicación automática. La configuración de v1 está
archivada en `legacy/v1`; no ejecutarla desde aquí.

El texto siguiente se conserva como descripción histórica de v1, no como
lista de capacidades ya integradas en v2 ni autorización para desplegar v1.

## Descripción histórica de LeapSign v1

LeapSign coordina la firma secuencial de documentos PDF: mantiene una única
versión vigente, ordena el acceso por turnos y permite al creador controlar el
ciclo completo sin recibir certificados privados ni contraseñas de firma.

Producción: [firma.veryfacil.org](https://firma.veryfacil.org)

## Capacidades actuales

- Acceso de creadores mediante Supabase Auth y aislamiento por propietario.
- Rondas privadas con título, mensaje y clave de acceso opcional.
- Cola de participantes, turno exclusivo de diez minutos y aviso por correo.
- Descarga temporal de la versión vigente e incorporación del PDF firmado.
- Controles operativos sobre tipo, tamaño, continuidad y duplicidad del archivo.
- Seguimiento de versiones, incidencias, pausas, reanudación, rollback,
  finalización y purga desde el panel del creador.
- Almacenamiento privado, URLs firmadas de corta duración y credenciales de
  servicio fuera del navegador.
- Despliegue automático de migraciones y funciones Edge mediante GitHub Actions.

## Alcance de seguridad y firma

LeapSign coordina el recorrido del documento, pero no es una autoridad
certificadora ni determina por sí mismo la identidad del firmante o la validez
jurídica de una firma. La persona firmante utiliza FirmaEC, Adobe u otra
herramienta apropiada y las partes deben realizar la comprobación legal o
criptográfica que corresponda.

Los PDF se conservan temporalmente en un bucket privado para que el proceso
pueda funcionar. No se publican ni se usan para publicidad. El acceso se concede
desde funciones de servidor y mediante enlaces con caducidad. Las conexiones
usan HTTPS/TLS y el proveedor aplica cifrado en reposo; esto no equivale a
cifrado de extremo a extremo ni permite prometer riesgo cero.

## Desarrollo

```bash
npm ci
npm run dev
npm test
npm run build
```

La aplicación requiere `VITE_SUPABASE_URL` y
`VITE_SUPABASE_PUBLISHABLE_KEY`. Los secretos de Supabase y Resend se configuran
fuera del repositorio.

## Despliegue

Los cambios bajo `supabase/` se publican con
`.github/workflows/deploy-supabase.yml`. La interfaz está preparada como una SPA
estática mediante `wrangler.jsonc`.

## Titularidad y contacto

Proyecto PSMM, de libre uso. Contacto: pabloun@gmail.com.

Los documentos procesados pertenecen a sus respectivos titulares. Consulta las
páginas `/privacidad`, `/seguridad` y `/condiciones` en la aplicación.

## LeapSign Firmador v2 — desarrollo aislado

La rama v2 prepara intenciones de firma y validación criptográfica independiente.
No está publicada ni habilitada. Su destino previsto es `leapsign.app`, sin
modificar el despliegue actual. Estado y bloqueos: [auditoría](docs/v2/audit.md),
[ADR](docs/v2/ADR-001-signing.md), [pruebas de interoperabilidad](docs/v2/interoperability.md)
y [desarrollo/publicación](docs/v2/development-and-release.md).

Código original bajo [AGPLv3](LICENSE); atribuciones y condiciones en [NOTICE](NOTICE).
