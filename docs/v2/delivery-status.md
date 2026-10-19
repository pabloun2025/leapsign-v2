# Entrega de base v2 — no es un lanzamiento del producto

Esta intervención implementa el núcleo verificable y prepara el modelo de
persistencia. **No está terminada la petición integral de Firmador v2**.
No se ha desplegado en leapsign.app ni modificado firma.veryfacil.org.

## Implementado

- Contratos explícitos del proveedor, estados, intención, metadatos públicos y
  perfil visual extensible. Flags estrictos apagados por defecto.
- Modelo de intención de 5 minutos, autorización por etapa y hash, control de
  posición y continuidad; coordinación externa que falla sin validación.
- Esquema SQL privado e independiente: uso único, transacciones, recibo
  idempotente, auditoría, versiones inmutables y revisión final por propietario.
- Validador CMS/PDF independiente con pyHanko y HTTP privado acotado. Ninguna
  entrada admite contenedores P12/PFX, contraseñas o resultados de confianza
  proporcionados por el navegador.
- Política offline estricta con raíces y revocación explícitas; fingerprint
  opcional vinculado a la etapa. El entorno no contiene raíces de producción.
- AGPLv3, inventario de dependencias, ADR, diagramas, guía y matriz honesta.

## Pendiente / bloqueo para completar

1. Elegir/adaptar un motor local que preserve una apariencia visible autorizada,
   implementar worker, QR, vista previa, modal y limpieza de secretos. No se ha
   añadido una falsa firma basada en una imagen ni una clave en servidor.
2. Conectar Auth, cuotas, almacenamiento y adaptadores SQL a endpoints propios
   de v2. Los contratos de repositorio no constituyen una API desplegada.
3. Configurar confianza y actualización de CRL/OCSP para autoridades de cualquier
   país, conforme al alcance internacional confirmado. No restringir a Ecuador
   ni confiar en raíces adjuntas de forma automática. La política de red impide
   revisar actualmente minka.gob.ec.
4. Confirmar QR, rotaciones y ByteRange del motor elegido y compatibilidad real
   con FirmaEC y Adobe. No se han generado informes ficticios de esos visores.
5. Integración completa y verificación de concurrencia entre procesos reales,
   retención, limpieza de candidatos y límites agregados antes de publicar.

## Verificaciones ejecutadas

- Vitest: **133 correctas**, 18 archivos (110 previas + 23 nuevas).
- Python: **44 correctas**, firmas y CA/CRL sintéticas de países EC y ES, sin claves en disco/repo.
- SQL: **17 aserciones correctas** en PostgreSQL WASM aislado; no demuestra
  concurrencia multi-conexión real, que sigue pendiente.
- TypeScript y build correctos. El bundle servido de v1 mantiene su hash previo;
  sigue el aviso conocido de tamaño >500 kB. No hay nueva UI que probar aún.
- `npm audit`: 0 vulnerabilidades declaradas. Esto no es una garantía universal.
- Python muestra una advertencia de deprecación de Starlette/AnyIO en tests;
  no se han ocultado avisos ni debilitado validaciones para pasar pruebas.

## Archivos y propósito

| Archivo | Motivo |
|---|---|
| `src/v2/contracts.ts` | Separación entre firma local, externa y validación |
| `src/v2/policy.ts` | Flags, origen v2, límites y validación local del selector |
| `server/v2/intents.ts` | Intenciones, vinculación y coordinación externa |
| `server/v2/private-validator.ts` | Frontera HTTP privada, cuota obligatoria y respuesta acotada |
| `v2/migrations/001_intents.sql` | Persistencia privada preparada, fuera de migraciones v1 |
| `validator/v2_engine.py` | Verificación criptográfica real, incremental y de confianza |
| `validator/v2_worker.py` | Proceso aislado, límites CPU/memoria y política pública local |
| `validator/v2_app.py` | HTTP autenticado y desactivado por defecto, sin spooling PDF |
| `validator/tests/test_v2_engine.py` | Certificados sintéticos y validación real |
| `validator/tests/test_v2_http.py` | Desactivación, autenticación, límites y subproceso real |
| `tests/v2-intents.test.ts` | Política y fallos de secuencia/validación |
| `tests/v2-private-validator.test.ts` | Cuotas y frontera pública/privada |
| `scripts/test-v2-intents-db.mjs` | Prueba SQL aislada sin credenciales |
| `scripts/v2-python-inventory.py` | Inventario reproducible de dependencias |
| `validator/requirements-test.txt` | Dependencias de tests |
| `validator/v2-development.lock` | Entorno Python de desarrollo fijado |
| `docs/v2/audit.md` | Arquitectura, investigación y riesgos encontrados |
| `docs/v2/ADR-001-signing.md` | Decisiones, alternativas, límites y dos diagramas |
| `docs/v2/interoperability.md` | Matriz real y procedimiento manual pendiente |
| `docs/v2/development-and-release.md` | Desarrollo, puertas de publicación y rollback |
| `docs/v2/python-inventory.json` | Inventario equivalente a SBOM del entorno aislado |
| `docs/v2/delivery-status.md` | Estado verificable y lista de archivos |
| `LICENSE`, `NOTICE` | AGPLv3 y atribuciones de PSMM/Pablo Martínez |
| `package.json`, `package-lock.json` | Sólo metadato de licencia, sin nuevas dependencias JS |
| `README.md` | Aviso v2 en desarrollo y enlaces a la documentación |
| `.gitignore` | Evitar cachés Python y pytest en el repositorio |

Las carpetas preexistentes `docs/guia-usuario` y `docs/guia-video-movil` se
conservan sin incluirlas en los cambios v2. No hay escrituras externas, cambios
de permisos, secretos nuevos, cuentas de prueba remotas ni PDF reales.
