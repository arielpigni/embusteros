# Mostrar fotos de auto en `index.html`

## Contexto

`carga.html` (sub-proyecto 2, ver `2026-07-30-carga-backoffice-design.md`) ya sube fotos a Supabase Storage (bucket `auto-fotos`) con metadata en la tabla `auto_fotos` (`id, auto_id, url, created_at`) al cargar una Compra. Ese documento dejaba explícitamente "mostrar fotos en `index.html`" como paso siguiente, acotado y validado aparte — este es ese paso.

`index.html` ya lee de Supabase en producción (`movimientos` + `autos`), pero no consulta `auto_fotos` ni renderiza imágenes en ningún lado.

## Objetivo

Que la app de solo-lectura (`index.html`) muestre las fotos ya cargadas de cada auto: una miniatura en las listas de Stock/Vendidos, y todas las fotos en el detalle del auto.

## No-objetivos

- Subir o borrar fotos desde `index.html` (eso vive en `carga.html`).
- Lightbox/zoom, indicadores de página (dots) en el carrusel.
- Cambios en `carga.html` o en el schema de Supabase.

## Diseño

### 1. Carga de datos (`loadData()`)

- Sumar `id` al join de `autos` en la query existente de `movimientos` (`autos(id, patente, marca, modelo)`), para poder mapear `patente → auto_id`.
- Agregar una query paralela a `auto_fotos` (mismo patrón que `carga.html`: `select('id, auto_id, url, created_at').order('created_at')`).
- Después de `buildCars()`, adjuntar `c.fotos = [...]` (array de URLs ordenadas por `created_at`) a cada auto en `CARS`, usando el `auto_id` capturado vía el join de movimientos. Autos sin fotos quedan con `fotos: []`.

### 2. Thumbnail en car-card (Stock/Vendidos)

- Si `c.fotos.length`, agregar una miniatura cuadrada (~64px, `object-fit:cover`, mismo `--radius` que el resto de la UI) en `.car-header`, junto al bloque marca/modelo/patente, usando `c.fotos[0]`.
- Si no hay fotos, no se agrega el elemento — layout idéntico al actual.

### 3. Carrusel en detalle de auto (`renderDetail`)

- Si `c.fotos.length`, insertar una fila arriba del bloque financiero: `overflow-x:auto; scroll-snap-type:x mandatory`, cada `<img>` con `scroll-snap-align:start`, altura fija (~220px), ancho completo por foto. Swipe nativo del navegador, sin JS de carrusel ni librerías.
- Si no hay fotos, no se renderiza la sección.

### 4. QA antes de producción

Los 14 autos migrados no tienen fotos todavía, así que para validar el render hay que:
1. Implementar en el working tree local, sin pushear.
2. Subir 2-3 fotos de prueba a un auto vía `carga.html` (contra el Supabase real — RLS `select` ya es público).
3. Servir `index.html` localmente (`python -m http.server` o similar) y abrirlo desde el celu apuntando a la IP local de la notebook, para confirmar thumbnail + carrusel en un dispositivo real.
4. Recién ahí, con el ok de Ariel, commit + push a `main` (dispara el deploy de GitHub Pages a producción).

No se arma una rama/entorno QA aparte en GitHub Pages — se valida local contra la misma base de datos real.

## Testing

No hay test suite en el proyecto (archivo único sin build tools). Validación manual: pasos de QA de la sección 4, cubriendo un auto con fotos y uno sin fotos (para confirmar que el fallback sin espacio reservado funciona en ambos lugares).
