-- Seguir a una persona, para tenerla a mano al compartir.
--
-- "Seguir" y no "ser amigo" a proposito, y la razon esta en el nombre: no hay
-- aceptacion, no hay que esperar a nadie y no hay nada que se pueda quedar a medias.
-- Unamicidad necesita que alguien acepte, y hoy no hay bandeja de avisos dentro de
-- la app, asi que una solicitud es una solicitud que nadie ve.
--
-- La fila es unilateral a proposito. Seguir a alguien no dice nada de lo que ese
-- alguien pueda hacer, y no le da ninguna gracias: solo guarda un atajo para no
-- escribir su correo cada vez.
--
-- `check (follower_user_id <> followee_user_id)` porque seguirse a uno mismo no es
-- seguir a nadie y la fila no serviria para nada. Y el indice unico en el par porque
-- volver a seguir a la misma persona tiene que ser un no-op y no una fila mas.

create table if not exists people_follows (
  id uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references users(id) on delete cascade,
  followee_user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint people_follows_not_self check (follower_user_id <> followee_user_id)
);--> statement-breakpoint
create unique index if not exists people_follows_pair_unique
  on people_follows (follower_user_id, followee_user_id);--> statement-breakpoint
create index if not exists people_follows_follower_idx
  on people_follows (follower_user_id);--> statement-breakpoint
create index if not exists people_follows_followee_idx
  on people_follows (followee_user_id);