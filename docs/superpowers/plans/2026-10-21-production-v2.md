# LeapSign v2 Production Trial Implementation Plan

> **Execution:** use `superpowers:executing-plans` inline, with TDD and a final
> whole-branch review.

**Goal:** completar, desplegar y verificar el recorrido funcional v2 publicado
con una política de confianza ecuatoriana estricta y revisable.

**Architecture:** Worker same-origin con cookies HTTP-only y service role
privado; firma P12 local sin red; validador Render autenticado con política
fijada; Storage privado y RPC/CAS atómicos.

**Spec:** `docs/superpowers/specs/2026-10-21-production-v2-design.md`

## Global Constraints

- No modificar v1, firmador, sus dominios, proyectos, datos ni secretos.
- Solo `v2-staging`, Render v2, Supabase `lbreydchhskrrmpzniem` y Worker
  `leapsign-v2-ui-preview`.
- Las tres credenciales indicadas permanecen secretos Cloudflare cifrados.
- Toda aceptación requiere confianza, vigencia y revocación verificable.
- Tests sintéticos usan una política aislada; producción nunca confía su CA.
- Cada cambio de comportamiento sigue RED→GREEN y cada despliegue se verifica.

## Interfaces compartidas

- El manifiesto de Task 1 alimenta readiness y validación de Tasks 2–3.
- El informe estructurado de Task 3 alimenta contratos, persistencia, recibos,
  QR y UI de Tasks 4–6.
- El cierre SQL de Task 4 alimenta API/Worker/UI de Tasks 5–6.
- El artefacto y configuración verificados localmente alimentan Task 7.

## Review Focus

- Aceptación imposible con cadena sintética, revocación desconocida o política
  manipulada.
- Ninguna ruta transporta P12/PFX o contraseña.
- Replay/concurrencia no duplica versiones ni turnos.
- `final_review` no equivale a `completed`.
- Despliegue no convierte los tres secretos exigidos en variables visibles.

### Task 1: material oficial y manifiesto determinista

**Files:** `validator/trust/**`, documentación y tests de política.

- [ ] Escribir tests fallidos de esquema, hashes, X.509, cadena, vigencia,
  provenance y separación de fixtures sintéticos.
- [ ] Incorporar el subconjunto oficial verificable y sus atribuciones.
- [ ] Ejecutar tests y registrar fuentes/artefactos que aún falten.
- [ ] Commit.

### Task 2: readiness y carga estricta de política

**Files:** `validator/v2_policy.py`, `validator/v2_app.py`, `validator/v2_worker.py`, tests.

- [ ] Escribir tests fallidos para manifiesto ausente, hash alterado e
  inicialización correcta de `/ready`.
- [ ] Implementar un único cargador estricto usado por HTTP y subprocess.
- [ ] Ejecutar suite Python y commit.

### Task 3: informe estructurado y revocación cerrada

**Files:** motor/worker Python, fixtures y tests del motor.

- [ ] Escribir tests fallidos para informe por dimensiones y códigos estables:
  válida, alterada, ByteRange/CMS, dos firmas nuevas, firma anterior, fechas,
  cadena, revocada, evidencia inválida y no disponible.
- [ ] Implementar el informe sin aceptar si una dimensión obligatoria falla.
- [ ] Probar 1/2/3 firmas y rechazo sintético con política de producción.
- [ ] Ejecutar suite Python y commit.

### Task 4: contratos y persistencia del informe

**Files:** contratos TypeScript, adaptadores, migración v2 nueva y tests TS/SQL.

- [ ] Escribir tests fallidos de parseo, persistencia, recibo y replay del
  informe estructurado.
- [ ] Implementar compatibilidad estricta y migración solo en Supabase v2.
- [ ] Ejecutar suites TS/SQL y commit.

### Task 5: cierre explícito del propietario

**Files:** API de procesos, repositorio, migración v2, Worker y tests.

- [ ] Escribir tests fallidos de autorización, estado, idempotencia y
  concurrencia de finalización.
- [ ] Implementar RPC y endpoint owner-only; conservar descarga privada.
- [ ] Ejecutar suites TS/SQL y commit.

### Task 6: experiencia funcional, QR y aislamiento local

**Files:** UI funcional, cliente, motor/apariencia local, CSP y tests.

- [ ] Escribir tests fallidos para `final_review`, acción de cierre, página de
  verificación y texto/QR LeapSign.
- [ ] Escribir tests de ausencia de capacidades de red y secretos persistidos.
- [ ] Implementar cambios mínimos y accesibles sobre la aplicación funcional.
- [ ] Ejecutar tests, build y commit.

### Task 7: verificación local integral y publicación

- [ ] Ejecutar suites completas Python/TS/SQL, build y pruebas E2E sintéticas.
- [ ] Revisar el diff completo; corregir hallazgos importantes con TDD.
- [ ] Commit final y push únicamente a `v2-staging`.
- [ ] Esperar y verificar Render `/health`, `/ready`, auth, alteración,
  no-confianza y conservación de firmas.
- [ ] Aplicar solo migraciones v2 pendientes en Supabase v2.
- [ ] Confirmar `secret list`; configurar URL/flags; desplegar solo el Worker.

### Task 8: prueba publicada y entrega

- [ ] Verificar flags, login/recuperación, PDF privado, múltiples firmantes,
  firma local, validación, CAS, recibo/replay, finalización y descarga.
- [ ] Verificar retención/purga y que v1/firmador permanecieron intactos.
- [ ] Registrar commits, despliegues, URLs, resultados, compatibilidad y límites.
- [ ] Entregar únicamente los pasos seguros de la prueba manual real.
