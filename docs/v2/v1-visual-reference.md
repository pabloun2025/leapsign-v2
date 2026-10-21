# Inventario visual y funcional aprobado de LeapSign v1

Referencia inmutable: commit de separación `48402d61ec8a4607b10d741b762569e496173906`.
Los archivos se reutilizan únicamente dentro del repositorio v2; no se cargan
desde el dominio ni la infraestructura de v1.

## Marca y recursos

| Recurso | Uso aprobado | SHA-256 |
| --- | --- | --- |
| `public/frog-brand.webp` | isotipo de marca, 128×128 | `d4aff3911f42858f642d25d22068f91510844e7167cd7481f3623b85094edcd4` |
| `public/frog-signing.webp` | rana del salto entre PDF, 400×267 | `2d96e084497a7feaad07b4ed094dccbb955b84111f82f968805c3aa6e15e8824` |
| `public/frog-favicon.png` | favicon 48×48 | `3351462b7da1058665a214d41525fba22a3f6c137eaf69f4a2f544d890088f25` |
| `public/frog-mark.svg` | isotipo vectorial | `40d4b6c01850e30551f9e16ef297a2cf601d3ed0da30ec1d3493c34e4d77148b` |
| `public/leapsign-secure-flow.png` | explicación visual del recorrido | `5249d682e4ba510c028aa4830f1c9e5e99b28d706074eaef3616e9bc0d34b3b4` |

Los recursos proceden del repositorio y producto LeapSign original, conservan
su nombre y están cubiertos por la licencia y atribución del repositorio.

## Sistema visual

- Tipografía: `Avenir Next`, Avenir, `Segoe UI`, system-ui y sans-serif.
- Texto: `#17342c`; texto secundario: `#52665c`.
- Verde principal: `#145845`; verde secundario: `#28715d`.
- Marfil: `#f8f9f6`; salvia: `#edf5f0`; superficie: `#ffffff`.
- Línea: `#dce6e0`; acento dorado: `#cfae64`; peligro: `#a33f37`.
- Sombra de tarjetas: `0 18px 48px rgba(24,61,49,.08)`.
- Campos: alto mínimo 46 px, radio 9 px y borde `#cad8d0`.
- Botón principal: verde, radio 10 px, alto mínimo 42 px, peso 680.
- Tarjetas principales: radio 20 px, borde salvia y superficie blanca.
- Foco: contorno verde secundario de 3 px con separación de 3 px.
- Fondo: marfil con gradiente radial verde muy tenue en la esquina superior.

## Estructura y comportamiento

- Cabecera de marca con isotipo, “LeapSign” y “Firma secuencial de PDF”.
- Acceso en dos columnas: relato/recorrido del PDF a la izquierda y una sola
  tarjeta de acción a la derecha; en móvil se convierte en una columna.
- Textos aprobados: “Organiza la firma de un PDF”, “Accede a LeapSign”,
  “Crea tu cuenta”, “Espacio privado”, “Nuevo documento para firmar”,
  “Documentos para firmar” y “Salir”.
- Registro, acceso y recuperación comparten una tarjeta; nunca hay formularios
  duplicados. Los errores aparecen junto a la acción y no revelan si existe una
  cuenta.
- El espacio de trabajo prioriza documento vigente, firmas completadas, turno
  actual y siguiente acción. Las áreas auxiliares se presentan en `details`.
- Estados: spinner y verbo de la operación durante carga; aviso marfil/dorado
  para información, verde para éxito y rojo contenido para error.
- Responsive aprobado: 1120 px de ancho máximo, punto de cambio principal en
  760–800 px, controles de 42–46 px y ausencia de desplazamiento horizontal.
- Navegación completa por teclado, etiquetas visibles, mensajes con `status` o
  `alert` y foco visible.

## Correos

La voz de v1 es directa y prudente: nombre de la acción, contexto mínimo,
botón principal único y pie de seguridad. V2 conserva marca, verdes, marfil,
tipografía de sistema compatible con correo y la rana como recurso alojado por
v2. No adjunta PDF ni incluye secretos o tokens completos en texto auxiliar.

## Adaptaciones necesarias de v2

Se mantienen estructura, recursos y textos salvo para explicar firma digital
real, separar integridad/confianza/vigencia/revocación, evitar conclusiones
jurídicas y declarar la compatibilidad inicial limitada a BCE. Toda URL pasa a
`https://pruebas.leapsign.app`; no se conservan configuraciones, credenciales,
sesiones ni código de infraestructura de v1.
