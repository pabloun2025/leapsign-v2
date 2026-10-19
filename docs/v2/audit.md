# Auditoría inicial — LeapSign Firmador v2

Base: commit `2f80482`. Destino propuesto: `https://leapsign.app`.
Estado: desarrollo aislado, NO publicado ni habilitado.

## Arquitectura encontrada

- React + TypeScript + Vite, SPA estática en Cloudflare Worker `firmador`.
  `src/main.tsx` reúne autenticación, cola, carga externa y seguimiento.
- Supabase Auth para propietarios; los participantes de v1 usan una capacidad
  aleatoria de sesión, no una identidad autenticada verificable.
- Edge Functions Deno; PostgreSQL serializa turnos y aceptación mediante RPC.
  Bucket privado, versiones binarias y SHA-256, URLs de descarga de 60 segundos.
- `submit-signed-version` solo inspecciona PDF, tamaño, nombre y dimensiones;
  `validation_summary.mode = structural_profile`. **No prueba CMS, confianza,
  identidad, revocación ni conservación criptográfica de firmas anteriores**.
- `validator/app.py` es un servicio FastAPI pendiente que respondía 503.
  No existe integración activa con dicho validador.
- `server/domain.ts` es un modelo operativo de referencia, no el backend
  desplegado. Sus tests con `valid:true` no demuestran firma criptográfica.
- `economic-guard.ts` y las RPC de presupuesto limitan peticiones, cargas,
  descargas y correos. No deben saltarse al conectar nuevos endpoints.
- Retención v1: históricas hasta 48 horas y final 5 días. No se modifica.
- CI: Vitest, build, análisis de secretos, pruebas SQL y parsing PDF con Deno.
  Línea base ejecutada: 110 tests correctos; build correcto, aviso de chunk >500 kB.
- El cliente Supabase y algunos correos apuntan a recursos/dominio de v1.
  Cambiar solamente DNS **no aísla** datos, correos ni permisos.

## Decisiones de aislamiento

No cambiar `main`, DNS, Worker `firmador`, Auth ni RPC de v1 para esta prueba.
Trabajar en `feature/leapsign-firmador-v2`. Las migraciones de v2 se guardan
fuera de `supabase/migrations` para que el workflow de v1 no las aplique.
La futura publicación requiere Worker y configuración de backend propios;
el origen permitido de producción de v2 es exclusivamente `leapsign.app`.
Los firmantes v2 deben tener identidad autenticada vinculada a una etapa,
no confiar en un nombre/correo escrito por el navegador.

## Investigación criptográfica y licencias

Inspección del paquete publicado `@libpdf/core@0.5.3`, licencia MIT (Lucas Smith,
2026): P12Signer usa WebCrypto/PKIjs; `buildChain:false` evita AIA en navegador;
`PDF.sign` usa `ETSI.CAdES.detached` y guardado incremental.
Sin embargo `prepareSignatureField` elimina widgets y fija Rect `[0,0,0,0]`
y página inicial. No satisface la apariencia QR/última página autorizada.
No incorporar ese motor al producto ni prometer soporte completo por su README.
No se han instalado sus dependencias en la aplicación de v1.

El proxy devolvió 403 al acceder a minka.gob.ec. No se pudo comprobar la
inconsistencia GPL/AGPL de los archivos de FirmaEC. **No se copia código,
logotipo ni apariencia institucional**. La comprobación con FirmaEC y Adobe
reales sigue pendiente. No se dispone de aplicación gráfica FirmaEC en este
entorno ni se simula ese resultado.

El hash del PDF firmado NO puede ser igual al del original: una firma añade
bytes. La intención fija el hash de la base canónica; el servidor comprueba
ese hash, continuidad incremental exacta y un hash distinto del resultado.
El resultado del navegador no constituye evidencia de validación.
