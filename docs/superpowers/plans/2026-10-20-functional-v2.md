# LeapSign v2 Functional Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar y verificar el recorrido v2 completo en el entorno independiente de pruebas.

**Architecture:** Worker v2 same-origin con cookie HTTP-only; Supabase v2 mediante RPC privadas `service_role`; Storage privado; motor local en Web Worker; validador privado; commit SQL atómico y recibos recuperables.

**Tech Stack:** TypeScript, React, Cloudflare Workers, Supabase Auth/Postgres/Storage, Python/pyHanko, PDF.js, @libpdf/core.

**Spec:** `docs/superpowers/specs/2026-10-20-functional-v2-design.md`

## Global Constraints

- No tocar v1, `firma.veryfacil.org` ni `lgsdoutarthfymbjgdrj`.
- Certificado y contraseña nunca salen del navegador.
- Solo PDFs validados avanzan turno; versiones aceptadas son inmutables.
- Banderas apagadas por defecto y publicación solo en `pruebas.leapsign.app`.
- TDD, certificados sintéticos, sin debilitar TLS, permisos ni cuotas.

## Review Focus

- Corte de red después del commit devuelve el mismo recibo al consultar.
- Dos envíos concurrentes no crean dos versiones ni consumen dos turnos.
- PDF alterado o con más/menos de una firma nueva no avanza.
- Actor distinto no puede leer ni firmar un proceso.
- Objeto huérfano no aparece como versión aceptada y es purgable.

---

### Task 1: API de procesos, seguimiento y recibos

**Files:** crear `server/v2/process-api.ts`, `server/v2/receipts-api.ts`; modificar contratos; crear pruebas.

- [ ] Escribir pruebas fallidas para creación, autorización, seguimiento y recibo idempotente.
- [ ] Implementar handlers estrictos y puertos privados mínimos.
- [ ] Ejecutar pruebas, suite y commit.

### Task 2: RPC SQL y repositorio de envío

**Files:** crear `v2/migrations/003_private_api.sql`, `server/v2/postgres-submission.ts`; crear pruebas SQL/TS.

- [ ] Escribir pruebas fallidas de dos firmantes, CAS, replay y concurrencia.
- [ ] Implementar funciones privadas con grants solo a `service_role` y adaptador.
- [ ] Ejecutar SQL aislado, suite y commit.

### Task 3: Storage privado y composición del Worker

**Files:** modificar `server/v2/supabase-private.ts`, `v2/preview/src/worker.ts`, configuración y pruebas.

- [ ] Escribir pruebas fallidas para upload inmutable, cleanup y montaje de rutas.
- [ ] Implementar adaptadores, cuotas cerradas y composición de endpoints.
- [ ] Ejecutar suite/build y commit.

### Task 4: Motor local de navegador

**Files:** crear worker mantenible bajo `src/v2/local-engine/`; integrar `local-session.ts`; pruebas Chromium/Python.

- [ ] Escribir pruebas fallidas de P12/PFX, QR, tres firmas y aislamiento de red.
- [ ] Integrar el motor fijado y apariencia basada en sujeto del certificado.
- [ ] Ejecutar laboratorio completo, suite/build y commit.

### Task 5: Aplicación funcional

**Files:** crear entrada v2 real, vistas de login/propietario/firmante/seguimiento y CSS; pruebas de UI.

- [ ] Escribir pruebas fallidas de recorridos y estados de recuperación.
- [ ] Implementar UI responsive con secciones secuenciales y errores locales.
- [ ] Ejecutar Chromium 1440/768/390, axe, suite/build y commit.

### Task 6: Integración y publicación de pruebas

**Files:** actualizar continuidad y configuración v2.

- [ ] Ejecutar recorrido sintético end-to-end y revisión de seguridad de diff.
- [ ] Aplicar solo migración 003 al proyecto v2, configurar secretos v2 y desplegar Worker v2.
- [ ] Verificar `pruebas.leapsign.app`, rollback y documentar resultados reales.
