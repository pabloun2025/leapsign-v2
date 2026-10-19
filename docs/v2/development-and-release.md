# Desarrollo, publicación y recuperación de v2

**No está lista para publicar.** El motor visible existe como laboratorio
sintético; hay componentes UI y coordinador, pero no endpoints públicos conectados.
El dominio reservado es `https://leapsign.app`.
`firma.veryfacil.org`, su Worker y Supabase permanecen sin cambios.
Toda publicación está suspendida por el propietario. Las instrucciones de
publicación siguientes son una guía futura, no autorización para ejecutarla.

## Verificaciones locales reproducibles

```bash
npm ci --ignore-scripts
npm test
npm run build
python3 -m venv /tmp/leapsign-v2-dev
/tmp/leapsign-v2-dev/bin/pip install -r validator/v2-development.lock
/tmp/leapsign-v2-dev/bin/python -m pytest validator/tests -q
npm install --ignore-scripts --prefix /tmp/leapsign-v2-sql @electric-sql/pglite@0.3.14
PGLITE_MODULE=/tmp/leapsign-v2-sql/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-v2-intents-db.mjs
```

El lock Python fija el **entorno de desarrollo completo**, incluidos tests.
El inventario se reproduce con `scripts/v2-python-inventory.py` dentro del venv.
No se requieren certificados reales, cuentas ni servicios de producción.
El esquema SQL de pruebas vive sólo en memoria; NO aplicar ese archivo en v1.
Antes de publicar, repetir concurrencia con dos conexiones PostgreSQL reales.

## Laboratorio local P12/QR en Chromium

Sólo Linux de desarrollo con `/usr/bin/chromium`, `pdftoppm` y el venv anterior.
No introducir certificados reales. Los procesos Node son instrumentos de tests,
no endpoints para recibir certificados ni una alternativa a la firma en navegador.

```bash
npm ci --ignore-scripts --prefix v2/lab --cache /tmp/leapsign-npm-cache
V2_LAB_PYTHON=/tmp/leapsign-v2-dev/bin/python bash scripts/test-v2-local-lab.sh
```

El comando verifica el hash del motor original, genera una variante experimental
adyacente dentro de `node_modules` (no modifica el original), compila un worker
temporal fuera de la aplicación y lo borra al terminar. Ejecuta **89 tests Python**
con el laboratorio configurado. Sin esas variables, el comando pytest habitual
omite explícitamente los 30 casos del laboratorio; no contarlos como aprobados.

El servidor HTTP efímero del laboratorio sólo sirve la página vacía y el worker:
dos GET, sin endpoint de subida. El P12 sintético viaja a Chromium mediante IPC
y al worker por `postMessage`, no por HTTP. Se comprueban ausencia de solicitudes
adicionales y entradas Web Storage; el worker tiene CSP sin conexiones.
No hay trazas de claves ni archivos de claves. El QR de prueba contiene un URN
ficticio, no afirma que exista una página de verificación pública.

Se han probado firmas 1/2/3, cadena local–externo sintético–local, claves incorrectas,
P12 malformado, CMS sin espacio, certificados vencidos/no aptos, posición, rotación
y decodificación del QR renderizado. No sustituyen pruebas manuales con FirmaEC,
Adobe, navegadores distintos ni un flujo con autenticación y persistencia reales.

## Pantalla de firma: prototipo aislado

`SigningPanel` se conecta al coordinador `SigningWorkflow`. No se importa desde
`src/main.tsx` ni modifica el bundle de v1. El host futuro debe proporcionar un
puerto API autenticado y un firmador local aprobado; los flags están apagados por
defecto. El origen v1 se rechaza. No hay autenticación implícita por pasar un
`actorId`: el backend pendiente debe verificarla de forma independiente.

```bash
node scripts/check-v2-signing-ui.mjs
# Con axe instalado en el entorno, añadir AXE_SCRIPT_PATH=<ruta a axe.min.js>.
```

El script sirve únicamente la ruta local `/v2/lab/ui/`, abre Chromium, comprueba
1440/768/390 px, descarga explícita, revisión, diálogo, mostrar/ocultar contraseña,
fallo del motor ficticio y limpieza de campos. Guarda capturas sintéticas en
`/tmp/leapsign-v2-signing-<ancho>.png`. El diálogo pasó axe en los tres anchos.
No ofrece un enlace público ni envía datos a Supabase/Resend.

La pantalla usa PDF.js 6.4.299 (Apache-2.0) para renderizar una copia del PDF real
en canvas: páginas, zoom, giro, texto accesible y marcador de firma. No usa
iframes, no ejecuta acciones del PDF, desactiva XFA y recursos externos, y no
modifica ni transfiere el buffer canónico. Acota tamaño, páginas, geometría,
área de canvas y tiempos. Si Worker está bloqueado, conserva la descarga como
alternativa. El checkbox no prueba firma ni autorización para el servidor.

El coordinador verifica hash e intención antes de leer el certificado, envía
los buffers al puerto local y sólo entrega al API PDF firmado/ID/nonce/hash.
No guarda contraseña en su estado. Al iniciar el envío, se desactiva cancelar:
una conexión interrumpida puede dejar un commit confirmado en el servidor.
En ese caso se muestra resultado incierto y se bloquea la repetición hasta que
el futuro host consulte el recibo/seguimiento. No hay reintentos automáticos.

`V2HttpSigningApi` prepara el contrato del API, no lo despliega: sólo origen
`https://leapsign.app`, credenciales same-origin, sin redirects, JSON hasta 16 KiB
y PDF hasta 10 MiB. Rechaza rutas ajenas a la intención y campos extra. Sólo
sube PDF/ID/nonce/hash, nunca certificado ni contraseña. Los handlers de
Auth/CSRF/cuotas/SQL/Storage siguen pendientes; el cliente no los sustituye.

## Servicio privado de pruebas

Linux: el worker limita CPU a 15 s y memoria virtual a 512 MiB; la API limita
cuerpo a 29 MiB, lectura a 15 s, validación a 20 s y una operación simultánea por
proceso. No usar múltiples procesos/réplicas para eludir las cuotas agregadas.
La integración futura debe reservar presupuesto atómico de Edge antes de llamar
al servicio y antes de Storage. El límite del proceso no es un tope de factura.

El servicio arranca desactivado. Para pruebas propias, configurar fuera del repo:

```text
EXTERNAL_SIGNATURE_ENABLED=false
DIRECT_P12_SIGNING_ENABLED=false
FIRMAEC_COMPATIBILITY_PROFILE_ENABLED=false
V2_TRUST_POLICY_FILE=<ruta local a un manifiesto de confianza público aprobado>
V2_VALIDATOR_TOKEN=<secreto de servicio generado y guardado fuera del repositorio>
```

No pegar el secreto en chats, comandos compartidos, archivos versionados ni la
configuración VITE. Se requieren el perfil y al menos un modo directo/externo,
además de credencial de servicio y política de confianza. Habilitar el servicio
no habilita el flujo completo ni demuestra compatibilidad visual.

El manifiesto de confianza versión 1 contiene listas de nombres de archivo
locales, sin rutas: `trust_roots`, `crls` y `ocsps`. El material es DER público,
de entidades explícitamente aprobadas. No añadir una CA porque venga dentro de
un PDF de usuario. CRL/OCSP ausentes, no confiables o vencidos bloquean la firma.
No hay consultas de red desde el worker; la actualización de revocación operativa
y la selección de entidades aceptadas siguen pendientes.

Ejecutar el servicio sólo en loopback, sin access logs:

```bash
/tmp/leapsign-v2-dev/bin/uvicorn validator.v2_app:app --host 127.0.0.1 --port 8091 --no-access-log
```

No crear una vista previa pública de este servicio. En una futura red privada,
usar TLS y autenticación de servicio y una política de egress denegada por defecto.
La API no usa multipart: no crea ficheros temporales de PDF al parsear subidas.
Los PDF se procesan en memoria y el subproceso termina después de cada petición.
No se garantiza zeroización física de páginas de memoria o copias del intérprete.

## Puertas de publicación en leapsign.app

1. Resolver motor local + apariencia QR; revisar su licencia y fijar versión.
2. Preparar un catálogo mantenido de autoridades de confianza de distintos países
   y actualización de revocación. El propietario confirmó alcance internacional,
   sin filtro por país. No hay entidades reales configuradas en este cambio.
3. Conectar los adaptadores Auth, cuotas, SQL y Storage y probar idempotencia,
   huérfanos, retención, recuperación y concurrencia real. Los esquemas privados
   no deben exponerse a clientes. Nunca aceptar un informe del navegador.
4. Implementar vista previa/modal/worker y flujo externo sobre esos endpoints,
   con pruebas de escritorio, tablet y móvil. No añadir un formulario que recoja
   certificados antes de poder mantenerlos exclusivamente locales.
5. Completar la matriz con FirmaEC y Adobe reales; sólo entonces autorizar flags.
6. Crear configuración de publicación y Worker **separados** para v2. El
   `wrangler.jsonc` de la raíz apunta a v1 y NO debe usarse para publicar v2.
7. Preparar backend, bucket y Auth dedicados; revisar límites/coste antes de crear
   recursos. Configurar Site URL/redirects/correos para leapsign.app sin editar v1.
8. Añadir enlace visible al código fuente de la revisión desplegada (AGPLv3),
   conectar dominio/TLS, probar un proceso sintético y habilitar gradualmente.

No se han cambiado DNS, proveedores, credenciales, permisos, planes ni servicios
de pago. No hay un comando de publicación v2 listo ni se ha ejecutado despliegue.

## Rollback

- Punto base local: `restore/leapsign-before-v2-20261019`, commit `2f80482`.
- Los cambios v2 no se han mezclado con `main` ni enviado al servidor.
- Ante un fallo futuro, apagar los tres flags y detener la aceptación de nuevos
  intentos, conservando las versiones válidas y su acceso de descarga.
- Reponer únicamente la versión anterior del Worker v2. No revertir ni borrar
  tablas con documentos reales como mecanismo de rollback.
- La retirada de un motor de firma no debe bloquear la descarga de PDF ya válidos.
