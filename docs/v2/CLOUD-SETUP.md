# Nuevo entorno cloud exclusivo de v2

Crear un entorno NUEVO en Codex para pabloun2025/leapsign-v2, rama main.
No sustituir el repositorio del entorno Firmador y no duplicar todos sus secretos.
Esta carpeta local de preparación aún está en la máquina antigua: no es por sí
misma un entorno cloud aislado.

Instalación mínima (Node 24, npm compatible con lock):

```sh
npm ci --ignore-scripts
npm test
npm run build
```

Desde la carpeta del repositorio, sin asumir /workspace/firmador. Usar el checkout
existente del nuevo entorno, no crear worktrees. npm run dev sirve únicamente el
laboratorio de interfaz; comprobarlo internamente por HTTP, no prometer firma real
ni fabricar enlaces públicos localhost. No requiere procesos persistentes para
tests/build. No hace falta ninguna credencial para estas verificaciones.

Configuración pública futura:

- V2_SUPABASE_URL=https://lbreydchhskrrmpzniem.supabase.co
- V2_STORAGE_BUCKET=v2-pdfs

Secretos a autorizar en el NUEVO entorno únicamente cuando sean necesarios:

- SUPABASE_V2_ACCESS_TOKEN, destino api.supabase.com, para gestión autorizada.
- CLOUDFLARE_API_TOKEN, destino api.cloudflare.com, limitado a cuenta/zona v2.
- Las credenciales de runtime v2 siguen pendientes; no inventarlas ni copiar
  SUPABASE_SECRET_KEY o variables VITE_SUPABASE_* del proyecto v1.

La credencial Management de Supabase puede abarcar ambas aplicaciones; no es
aislamiento absoluto. Preferir permisos restringidos por organización cuando el
proveedor lo permita. Workers Scripts de Cloudflare puede abarcar toda la cuenta:
no afirmar que el token queda limitado a un único Worker.

Mantener Git y gestores de paquetes permitidos. Añadir destinos de proveedores
solo con el mecanismo del entorno y mantener TLS/proxy. No instalar servicios
de pago ni cambiar seguridad para superar fallos de red. No hay que publicar
la aplicación para publicar/guardar la configuración del entorno Codex.

Para pruebas criptográficas instalar el venv desde validator/v2-development.lock
y dependencias de laboratorio desde v2/lab/package-lock.json usando los scripts
existentes y leyendo sus instrucciones. Chromium y pdftoppm son prerrequisitos.
No contar tests opcionales omitidos como aprobados. Ver desarrollo y release.
