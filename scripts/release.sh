#!/usr/bin/env bash
#
# Publicar OrbitHub en Google Play.
#
# El build es local (gradle sobre `apps/mobile/android`) y la subida va a la
# API de Google directamente desde esta máquina, con `fastlane supply`. Nada
# sale a servidores de Expo ni a ningún servicio de pago.
#
#   npm run release -- --dry-run                 # comprueba y para
#   npm run release -- --track internal          # sube a internal testing
#   npm run release -- --track production        # sube a producción
#   npm run release -- --minor --track production
#
# Señales de salida distintas para cada fallo, porque "el AAB se rejected" y
# "el typecheck falló" necesitan arreglos opuestos.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MOBILE="apps/mobile"
APP_JSON="$MOBILE/app.json"
GRADLE_DIR="$MOBILE/android"
BUNDLE_DIR="$GRADLE_DIR/app/build/outputs/bundle/release"
AAB="$BUNDLE_DIR/app-release.aab"

DRY_RUN=0
BUMP="patch"
TRACK="internal"
ROLLOUT=""

# ---------------------------------------------------------------- salida ----

step()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok()    { printf '\033[32m    %s\033[0m\n' "$1"; }
fail()  { printf '\n\033[31mError: %s\033[0m\n\n' "$1" >&2; exit 1; }
hint()  { printf '    \033[2m%s\033[0m\n' "$1"; }

usage() {
  cat <<'EOF'
Uso: npm run release -- [opciones]

  --dry-run              Corre los pasos 1-6 y para antes de compilar.
  --patch                versionName 0.1.0 -> 0.1.1   (por defecto)
  --minor                versionName 0.1.0 -> 0.2.0
  --major                versionName 0.1.0 -> 1.0.0
  --track <internal|production>
                         Pista de subida. internal por defecto.
  --rollout <0..1>       Fracción de usuarios en production. Por defecto
                         0.1, que es un rollout cautious; 1 lo publica entero.
  -h, --help             Esto.

Variables de entorno obligatorias para compilar y subir:
  ORBIT_HUB_UPLOAD_KEYSTORE          Ruta al .jks de subida
  ORBIT_HUB_UPLOAD_STORE_PASSWORD    Contraseña del almacén
  ORBIT_HUB_UPLOAD_KEY_ALIAS         Alias de la clave
  ORBIT_HUB_UPLOAD_KEY_PASSWORD      Contraseña de la clave
  SUPPLY_JSON_KEY_PATH               Ruta al JSON de la cuenta de servicio

Ver docs/deploy-play.md para el setup completo.
EOF
}

# --------------------------------------------------------------- flags ----

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  DRY_RUN=1; shift ;;
    --patch)    BUMP="patch"; shift ;;
    --minor)    BUMP="minor"; shift ;;
    --major)    BUMP="major"; shift ;;
    --track)    [ $# -ge 2 ] || fail "--track necesita un valor"; TRACK="$2"; shift 2 ;;
    --rollout)  [ $# -ge 2 ] || fail "--rollout necesita un valor"; ROLLOUT="$2"; shift 2 ;;
    -h|--help)  usage; exit 0 ;;
    *)          usage; fail "Opción desconocida: $1" ;;
  esac
done

case "$TRACK" in
  internal|production) ;;
  *) fail "--track solo admite internal o production (recibido: $TRACK)" ;;
esac

if [ -z "$ROLLOUT" ]; then
  if [ "$TRACK" = "production" ]; then ROLLOUT="0.1"; else ROLLOUT="1"; fi
fi

# 1 --------------------------------------------------------------- entorno --

step "1/10  Entorno"

command -v node >/dev/null || fail "node no está en el PATH."
command -v npm  >/dev/null || fail "npm no está en el PATH."
[ -d node_modules ] || fail "Faltan las dependencias. Corre: npm install"
[ -f "$APP_JSON" ] || fail "No encuentro $APP_JSON."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node $NODE_MAJOR es demasiado antiguo. Expo SDK 53 pide Node 20 o superior."
fi
ok "node $(node -v)"

MISSING=()
[ -n "${ORBIT_HUB_UPLOAD_KEYSTORE:-}" ] || MISSING+=("ORBIT_HUB_UPLOAD_KEYSTORE")
[ -n "${ORBIT_HUB_UPLOAD_STORE_PASSWORD:-}" ] || MISSING+=("ORBIT_HUB_UPLOAD_STORE_PASSWORD")
[ -n "${ORBIT_HUB_UPLOAD_KEY_ALIAS:-}" ] || MISSING+=("ORBIT_HUB_UPLOAD_KEY_ALIAS")
[ -n "${ORBIT_HUB_UPLOAD_KEY_PASSWORD:-}" ] || MISSING+=("ORBIT_HUB_UPLOAD_KEY_PASSWORD")
[ -n "${SUPPLY_JSON_KEY_PATH:-}" ] || MISSING+=("SUPPLY_JSON_KEY_PATH")

if [ "${#MISSING[@]}" -gt 0 ]; then
  fail "Faltan variables de entorno: ${MISSING[*]}

    Sin la clave de subida el AAB se firmaría con debug.keystore y Play lo
    rechaza sin un mensaje útil. Sin el JSON de la cuenta de servicio no hay
    forma de hablar con la API de Play.

    docs/deploy-play.md tiene el setup. En una línea, en tu shell:

      export ORBIT_HUB_UPLOAD_KEYSTORE=... ORBIT_HUB_UPLOAD_STORE_PASSWORD=...
      export ORBIT_HUB_UPLOAD_KEY_ALIAS=... ORBIT_HUB_UPLOAD_KEY_PASSWORD=...
      export SUPPLY_JSON_KEY_PATH=..."
fi

if [ -n "${ORBIT_HUB_UPLOAD_KEYSTORE:-}" ] && [ ! -f "$ORBIT_HUB_UPLOAD_KEYSTORE" ]; then
  fail "ORBIT_HUB_UPLOAD_KEYSTORE apunta a '$ORBIT_HUB_UPLOAD_KEYSTORE' y ese fichero no existe."
fi
if [ -n "${SUPPLY_JSON_KEY_PATH:-}" ] && [ ! -f "$SUPPLY_JSON_KEY_PATH" ]; then
  fail "SUPPLY_JSON_KEY_PATH apunta a '$SUPPLY_JSON_KEY_PATH' y ese fichero no existe."
fi
ok "credenciales presentes"

# -------------------------------------------------------------- git ----

step "2/10  Git"

# Un worktree de git tiene .git como fichero, no como directorio, y esta
# comprobación tiene que_valer para los dos.
git rev-parse --git-dir >/dev/null 2>&1 || fail "Esto no es un repositorio git."

if [ -n "$(git status --porcelain)" ]; then
  git status --short
  fail "El árbol tiene cambios sin commitear.

    Un AAB no corresponde a ningún commit si hay cambios sin commitear: no
    podrías reproducir ni revertir la publicación. Commitea o guarda los
    cambios antes de seguir."
fi
ok "árbol limpio"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" = "HEAD" ]; then
  fail "Estás en un checkout desligado (detached HEAD). No hay rama a la que publicar."
fi

if git rev-parse --verify --quiet "@{u}" >/dev/null; then
  LOCAL_SHA="$(git rev-parse HEAD)"
  REMOTE_SHA="$(git rev-parse '@{u}')"
  if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    git log --oneline "@{u}..HEAD"
    fail "HEAD no está subido a $BRANCH.

    Publicar commits que nadie más tiene no sirve de nada y rompe el historial
    cuando alguien haga pull. Push primero."
  fi
  ok "$BRANCH al día con $(git rev-parse --abbrev-ref '@{u}')"
else
  fail "La rama $BRANCH no tiene upstream. Push una vez para poder comparar."
fi

# -------------------------------------------------------- comprobaciones ----

step "3/10  Typecheck"
npm run typecheck

step "4/10  Tests"
npm run test

step "5/10  Expo config"
npm run config:check --workspace @orbit-hub/mobile

# ------------------------------------------------------------- version ----

step "6/10  Versión"

CURRENT_NAME="$(node -p 'require("./'"$APP_JSON"'").expo.version')"
CURRENT_CODE="$(node -p 'require("./'"$APP_JSON"'").expo.android.versionCode')"

NEXT_NAME="$CURRENT_NAME"
case "$BUMP" in
  patch) NEXT_NAME="$(node -p 'const v=require("./'"$APP_JSON"'").expo.version.split(".");`${v[0]}.${v[1]}.${Number(v[2])+1}`')" ;;
  minor) NEXT_NAME="$(node -p 'const v=require("./'"$APP_JSON"'").expo.version.split(".");`${v[0]}.${Number(v[1])+1}.0`')" ;;
  major) NEXT_NAME="$(node -p 'const v=require("./'"$APP_JSON"'").expo.version.split(".");`${Number(v[0])+1}.0.0`')" ;;
esac
NEXT_CODE=$(( CURRENT_CODE + 1 ))

ok "versión $CURRENT_NAME (versionCode $CURRENT_CODE)"
ok "pasará a $NEXT_NAME (versionCode $NEXT_CODE)"
ok "pista: $TRACK, rollout: $ROLLOUT"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '\n\033[1m--dry-run: comprobado y sin tocar nada.\033[0m\n'
  printf 'El AAB se firmaría con %s (%s).\n' \
    "$(basename "${ORBIT_HUB_UPLOAD_KEYSTORE}")" "$ORBIT_HUB_UPLOAD_KEY_ALIAS"
  printf 'Siguiente paso real: npm run release -- --track %s\n\n' "$TRACK"
  exit 0
fi

node -e '
  const fs = require("fs");
  const path = process.argv[1];
  const raw = fs.readFileSync(path, "utf8");
  const config = JSON.parse(raw);
  config.expo.version = process.argv[2];
  config.expo.android.versionCode = Number(process.argv[3]);
  // app.json está indentation 2 y cierra con salto de línea; se reescribe entero
  // porque un replace puntual sobre el JSON fácil que se corrompa sin avisar.
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
' "$APP_JSON" "$NEXT_NAME" "$NEXT_CODE"
ok "app.json actualizado a $NEXT_NAME (versionCode $NEXT_CODE)"

# -------------------------------------------------------------- prebuild ----

step "7/10  Prebuild"

# --clean quita android/ entero, que es lo que garantiza que el package, el
# versionCode y el bloque de firma vengan de app.json y no de un arrastre.
#
# expo intenta borrar android/ y falla con ENOTEMPTY cuando hay un build/
# reciente dentro: gradle deja ficheros que rmdir no quita. Se borra antes,
# porque android/ es carpeta generada y está en .gitignore, así que no hay
# nada en ella que se pueda perder.
if [ -d "$GRADLE_DIR" ]; then
  step "7/10  Prebuild"
  hint "borrando $GRADLE_DIR (generada por expo prebuild)"
  rm -rf "$GRADLE_DIR"
else
  step "7/10  Prebuild"
fi

npx expo prebuild --platform android --clean --no-install
ok "apps/mobile/android regenerado"

if [ ! -f "$GRADLE_DIR/app/build.gradle" ]; then
  fail "El prebuild no generó $GRADLE_DIR/app/build.gradle."
fi

# Comprobar que el plugin de firma aplicó. Un AAB firmado con debug.keystore
# lo rechaza Play sin explicar por qué, así que esto tiene que fallar aquí y
# no dos horas después en Play Console.
if ! grep -q "signingConfigs.upload" "$GRADLE_DIR/app/build.gradle"; then
  fail "El plugin de firma no se aplicó: '$GRADLE_DIR/app/build.gradle' no menciona signingConfigs.upload.

    Sin esto el build release se firmaría con debug.keystore y Play rechazaría
    el AAB. Revisa que './plugins/with-upload-signing' siga en app.json plugins."
fi
ok "firma de subida configurada"

grep -q "applicationId 'com.jrzlabs.orbithub'" "$GRADLE_DIR/app/build.gradle" \
  || fail "El applicationId generado no es com.jrzlabs.orbithub.

    Si es otro, el AAB pertenece a otra app y Play lo rechaza."
ok "applicationId com.jrzlabs.orbithub"

# --------------------------------------------------------------- gradle ----

step "8/10  Gradle"

( cd "$GRADLE_DIR" && ./gradlew bundleRelease --no-daemon )
ok "gradlew bundleRelease terminó"

[ -f "$AAB" ] || fail "Gradle terminó pero no está el AAB en $AAB."
AAB_SIZE="$(wc -c < "$AAB" | tr -d ' ')"
[ "$AAB_SIZE" -gt 1000000 ] \
  || fail "El AAB pesa $AAB_SIZE bytes, demasiado poco para una app real.

    Un bundle de este tamaño suele significar que falló el empaquetado o que
    se empaquetó un APK en vez de un AAB."
ok "AAB: $AAB ($(du -h "$AAB" | cut -f1))"

# ---------------------------------------------------------------- supply ----

step "9/10  Google Play"

command -v fastlane >/dev/null \
  || fail "fastlane no está instalado.

    Ruby ya lo trae (ruby -v). Falta la gema:

      gem install fastlane

    o, mejor, fija la versión en un Gemfile con: bundle install"

export SUPPLY_JSON_KEY_PATH

SUPPLY_ARGS=(
  supply
  --upload_to_play
  --aab "$AAB"
  --track "$TRACK"
  --version_name "$NEXT_NAME"
  --version_code "$NEXT_CODE"
  --skip_upload_metadata
  --skip_upload_changelogs
  --non_interactive
)

# supply rechaza --rollout en internal: en internal testing el 100% de los
# testers de la lista la reciben siempre, así que un rollout ahí no significa
# nada y fastlane falla con un error poco claro.
if [ "$TRACK" = "production" ]; then
  SUPPLY_ARGS+=(--rollout "$ROLLOUT")
  ok "rollout gradual: $ROLLOUT de los usuarios"
fi

fastlane "${SUPPLY_ARGS[@]}"
ok "subido a $TRACK"

# ---------------------------------------------------------------- cierre ----

step "10/10  Hecho"

cat <<EOF

    versionName  $NEXT_NAME
    versionCode  $NEXT_CODE
    track        $TRACK

    El AAB ya está en Play Console, en $TRACK, esperando revisión. Google tarda
    entre unas horas y un día en procesarlo; la publicación a los usuarios no
    ocurre hasta que lo apruebes en Play Console.

    Falta commitear el bump de versión:

      git add $APP_JSON && git commit -m "release $NEXT_NAME"
EOF