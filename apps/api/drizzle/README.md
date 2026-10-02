# Migraciones

Esta carpeta son las migraciones de OrbitHub, en orden. El **SQL es la verdad**:
`apps/api/test/helpers.ts` aplica esta carpeta committeada y nada mas, asi que
las pruebas son evidencia sobre el SQL y nunca sobre las instantaneas de
`meta/`. Cambiar `meta/` no cambia lo que ve la base de datos de las pruebas;
cambiar un `.sql`, si.

En `apps/api/package.json` hay tres scripts de drizzle: `db:generate`, que
escribe una migracion nueva; `db:migrate`, que aplica las que ya estan; y
`db:studio`, que mira la base de datos viva. Los dos primeros tocan esta
carpeta. En ninguno de los tres esta **`drizzle-kit up`**.

## `generate` estuvo roto, y ya esta arreglado

Para que nadie lo "arregle" otra vez:

* Las instantaneas `0014`, `0015` y `0016` llevaban una clave `autoincrement` que
  el formato de instantanea `version: 7` —el mismo que dice el
  `_journal.json`— rechaza: el objeto columna es `strict()` y no admite esa
  clave. La herramienta imprimia `0014_snapshot.json data is malformed`, **no
  escribia ningun fichero y salia con codigo 0**, que es exactamente como
  parece un `generate` que no tenia nada que hacer.
* `0017`, `0018` y `0019` no tenian instantanea ninguna, y la ultima era `0016`:
  generar desde ahi volvia a emitir `notes`, `attachments`, `note_templates` y
  `people_follows` desde cero.

Lo que se hizo: quitar la clave que el formato no admite —el esquema que
describen `0014` a `0016` no cambia ni un bit— y producir las cuatro
instantaneas que faltaban (`0017`, `0018`, `0019` y `0020`) con la propia
herramienta, ejecutada contra el esquema del commit al que pertenece cada una y
encadenada por `prevId`: `0016` → `0017` → `0018` → `0019` → `0020`. Desde `0020`
la cadena vuelve a describir el esquema real.

## Las dos desviaciones que quedan, y por que hoy no muerden

1. **`0018_snapshot.json` contiene `people_follows`, y `0019_people_follows.sql`
   es la que la crea.** No es un error de la reconstruccion: `a21b642` metio la
   tabla en `content-schema.ts` cinco commits antes de que `72501ac` escribiera su
   migracion. Una instantanea registra el esquema del codigo y nunca el de la
   base de datos, asi que esto es lo que la herramienta habria escrito si la
   cadena se hubiera mantenido.
2. **La cadena se rompio en `0012`, no en `0014`.** `0012_snapshot.json` y
   `0013_snapshot.json` son instantaneas de verdad, con uuid de verdad y
   committeadas con su SQL, y ninguna de las dos registra la tabla que su propia
   migracion crea: el salto de `0011` a `0012` esta vacio, y
   `0012_notes_and_attachments.sql` crea `notes` y `attachments` mientras
   `0013_note_templates.sql` crea `note_templates`. `0014`, `0015` y `0016` solo
   heredan ese hueco, asi que el salto de `0016` a `0017` trae tres `CREATE
   TABLE` de sobra (las tres tablas, con sus claves foraneas e indices) y dos
   `DROP COLUMN` de sobra (`lists.favorite` y `list_items.favorite`): un error de
   hace seis migraciones que sale a flote aqui. Se reconoce porque `0014` a `0016`
   llevan ids escritos a pulso (`a1b2c3d4-...-000000000014` y siguientes), pero
   los ids no son la causa: la causa esta dos migraciones antes.

Las dos solo aparecen bajo **`drizzle-kit up`**, que recorre la cadena
comparando instantanea con instantanea. No esta en ningun script de este repo, y
ni `db:generate` ni `db:migrate` miran esos deltas. Si alguien engancha `up`,
esto hay que arreglarlo antes: produciria SQL que borra y recrea tablas que ya
estan.

## Por que no se reescribio la historia

Porque lo otro era editar instantaneas ya committeadas, y eso deja una cadena de
aspecto limpio escondiendo justo lo que esta etiqueta tiene que mostrar. El SQL
es la verdad; una instantanea es una foto del dia, este equivocada o no, y una
foto equivocada anotada vale mas que una foto borrada.
