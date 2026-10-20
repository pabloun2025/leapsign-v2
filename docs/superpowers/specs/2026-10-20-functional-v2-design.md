# LeapSign v2 funcional — diseño

## Objetivo

Entregar en `pruebas.leapsign.app` un recorrido real e independiente de v2:
sesión, creación de proceso con PDF privado, varios firmantes secuenciales,
firma P12/PFX exclusivamente en el navegador, validación independiente,
versiones inmutables, recibos idempotentes, seguimiento y descarga final.

## Arquitectura

El navegador autentica contra Supabase Auth v2 y cambia el token por una cookie
HTTP-only del Worker v2. El Worker accede con `service_role` a funciones RPC
privadas del proyecto v2 y a su bucket privado; ninguna tabla `signing_v2` se
expone al navegador. El motor P12/PFX se ejecuta en un Web Worker sin red. Solo
el PDF firmado se entrega al Worker, que lo envía al validador independiente y
persiste una nueva versión mediante compare-and-swap.

La escritura de Storage usa el patrón `reserva SQL -> objeto inmutable -> commit
SQL`; los candidatos huérfanos se pueden purgar y nunca avanzan el turno. Cada
envío usa intención, nonce y hash; repetir exactamente la operación devuelve el
mismo recibo, mientras que otro candidato o firmante se rechaza.

## Recorridos

- Propietario: login/recuperación, carga PDF, define 1–20 firmantes, comparte
  enlaces, consulta estado, revisa y descarga la versión final.
- Firmante: abre invitación, inicia sesión con el correo autorizado, revisa el
  PDF vigente, elige P12/PFX local, firma con QR visible, envía solo el PDF y
  recupera el recibo ante una desconexión.
- Sistema: verifica exactamente una firma nueva, continuidad incremental,
  firmas anteriores, cadena/trust policy y revocación; después avanza al
  siguiente firmante de forma atómica.

## Límites de la primera prueba funcional

Solo se habilita en `pruebas.leapsign.app`. Los certificados permanecen locales.
La confianza se limita a raíces configuradas expresamente; una cadena incrustada
no se confía automáticamente. La aplicación distingue integridad criptográfica,
confianza, revocación y validez jurídica. No se toca v1 ni se activan servicios
de pago.

## Verificación

Pruebas sintéticas cubren dos y tres firmantes, alteración, expiración,
concurrencia, repetición, corte tras commit, fallo del validador, firmas previas,
QR renderizado, autorización y descarga final. Antes de desplegar: Vitest,
Python completo con laboratorio, SQL aislado, build y smoke HTTP del Worker.
