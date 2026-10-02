# Migraciones

Esta carpeta son las migraciones de OrbitHub, en orden. El **SQL es la verdad**:
`apps/api/test/helpers.ts` aplica esta carpeta committeada y nada mas, asi que
las pruebas son evidencia sobre el SQL y nunca sobre las instantaneas de
`meta/`. Cambiar `meta/` no cambia lo que ve la base de datos de las pruebas;
cambiar un `.sql`, si.

Los dos comandos que se usan aqui son `npm run db:generate --workspace
@orbit-hub/api`, que escribe una migracion nueva, y `npm run db:migrate
--workspace @orbit-hub/api`, que aplica las que ya estan. Y en particular:
**`drizzle-kit up` no se usa en este repo**.

## `generate` estuvo roto, y ya esta arreglado

Para que nadie lo "arregle" otra vez:

* Las instantaneas `0014`, `0015` y `0016` llevaban una clave `autoincrement` que
  el validador de postgres de drizzle v7 rechaza —el objeto columna es
  `strict()` y no admite esa clave—. La herramienta imprimia
  `0014_snapshot.json data is malformed`, **no escribia ningun fichero, y salia
  con codigo 0**: un `generate` que no hace nada parece un `generate` que no
  tenia nada que hacer.
* `0017`, `0018` y `0019` no tenian instantanea ninguna. La ultima era `0016`,
  de modo que generar desde ahi volvia a emitir `notes`, `attachments`,
  `note_templates` y `people_follows` desde cero.

Lo que se hizo: quitar la clave que el formato no admite —el esquema que
describen `0014` a `0016` no cambia ni un bit— y producir las cuatro
instantaneas que faltaban (`0017`, `0018`, `0019` y `0020`) con la propia
herramienta, ejecutada contra el esquema del commit al que pertenece cada una y
encadenada por `prevId`: `0016` → `0017` → `0018` → `0019` → `0020`. Desde `0020`
la cadena vuelve a describir el esquema real.

## Las dos desviaciones que quedan, y por que hoy no muerden

1. **`0018_snapshot.json` contiene `people_follows`, y `0019_people_follows.sql`
   es la que la crea.** No es un error de quien reconstruyo la cadena: el commit
   `a21b642` metio la tabla en `content-schema.ts` un commit antes de que
   `72501ac` escribiera su migracion. Una instantanea registra el esquema del
   codigo y nunca el de la base de datos, asi que esto es justo lo que la
   herramienta habria escrito si la cadena se hubiera mantenido.
2. **El salto de `0016` a `0017` trae tres `CREATE TABLE` de sobra** —`notes`,
   `attachments` y `note_templates`, con sus claves foraneas e indices— **y dos
   `DROP COLUMN` de sobra** (`lists.favorite` y `list_items.favorite`). La causa
   es vieja: `0014`, `0015` y `0016` se forjaron a mano con ids escritos a
   pulso (`a1b2c3d4-...-000000000014` y siguientes, donde `0000` a `0013`
   tienen uuid de verdad, los que genera la herramienta) y se les olvidaron tres
   tablas que existen desde `0012_notes_and_attachments.sql` y
   `0013_note_templates.sql`.

Las dos solo aparecen bajo **`drizzle-kit up`**, que compara instantanea con
instantanea. `up` no esta en ningun script de este repo, y ni `db:generate` ni
`db:migrate` miran esos deltas. Si alguien engancha `up`, esto hay que
arreglarlo antes: produciria SQL que borra y recrea tablas que ya estan.

## Por que no se reescribio la historia

Porque lo otro era editar instantaneas ya committeadas, y eso deja una cadena de
aspecto limpio escondiendo justo lo que esta etiqueta tiene que mostrar. El SQL
es la verdad; una instantanea es una foto del dia, este equivocada o no, y una
foto equivocada anotada vale mas que una foto borrada.