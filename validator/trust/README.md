# Política de confianza de producción v2

Esta carpeta es una entrada de seguridad revisable, no una colección de
certificados aportados por firmantes. `policy.json` fija cada byte por SHA-256.
Los certificados se extrajeron de código fuente público del proyecto oficial
FirmaEC/MINTEL en el commit indicado y se convirtieron de PEM a DER sin cambiar
el certificado. La CRL se descargó directamente de la URL HTTPS publicada en la
intermedia BCE y su firma se verificó contra la raíz fijada.

Fecha de incorporación: 2026-10-21 UTC. Comandos de revisión:

```sh
sha256sum validator/trust/bce/*.der
openssl verify -CAfile root.pem intermediate.pem
openssl crl -inform DER -in validator/trust/bce/root-crl-2026.der \
  -CAfile root.pem -verify -noout
```

## Alcance inicial

Solo BCE está habilitada inicialmente: raíz 2011–2031 e intermedia 2019–2029.
Esto significa compatibilidad técnica limitada, no acreditación ni conclusión
jurídica. Una firma solo puede aceptarse si además hay evidencia vigente y
firmada sobre la revocación del certificado final. La CRL incluida acredita el
estado de la intermedia; no sustituye la CRL/OCSP correspondiente a cada
certificado final. Para los certificados finales se incorpora además la CRL
combinada que el código oficial FirmaEC identifica como `BCE_CRL`; su vigencia
es diaria. El servicio consulta únicamente las dos URL HTTPS BCE fijadas en la
política, sin redirecciones, con timeout y límite de 2 MiB. Cada reemplazo se
analiza y su firma se verifica contra el emisor cuyo certificado y hash están
fijados aquí; después se publica atómicamente en una caché local. La copia del
repositorio solo se usa mientras siga vigente. Un disparador gratuito del
Worker solicita renovación cada seis horas y `/ready` también anticipa la
renovación al acercarse `nextUpdate`. Si ninguna evidencia aplicable está
vigente, readiness y validación fallan cerrados.

FirmaEC también contiene adaptadores/material para `alphatechnologies`, `anfac`,
`appfirmas`, `argosdata`, `cj`, `corpnewbest`, `darkcam`, `datil`, `digercic`,
`eclipsoft`, `firmasegura`, `lazzate`, `letmi`, `primecorelat`, `securitydata` y
`uanataca`. No se incorporan todavía porque en esta revisión no se completó para
cada una el conjunto raíz-intermedias-evidencia de revocación vigente desde una
fuente oficial. Omitirlas mantiene el fallo cerrado; no implica que sean
inválidas o que no estén acreditadas.

## Semántica

El software informa por separado integridad criptográfica, cadena/confianza,
vigencia y revocación. `accepted` requiere todas. El resultado jurídico queda
expresamente fuera del software. Fixtures y autoridades sintéticas pertenecen
solo a tests y nunca se copian a esta carpeta.
