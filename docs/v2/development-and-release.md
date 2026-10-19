# Desarrollo, publicación y recuperación de v2

**No está lista para publicar.** No hay UI v2, motor local visible ni endpoints
públicos conectados. El dominio reservado es `https://leapsign.app`.
`firma.veryfacil.org`, su Worker y Supabase permanecen sin cambios.

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
configuración VITE. Sólo cambiar `EXTERNAL_SIGNATURE_ENABLED` en el entorno de
pruebas habilita el validador, no el flujo completo ni la compatibilidad visual.

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
