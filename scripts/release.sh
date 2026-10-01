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
# Lo lee Expo CLI, no este script. Si exportamos aqui, Metro lo inlinea en el
# bundle y es lo que acaba en el AAB.
RELEASE_ENV="$MOBILE/.env.release"
ANDROID_PACKAGE="com.jrzlabs.orbithub"
GRADLE_DIR="$MOBILE/android"
BUNDLE_DIR="$GRADLE_DIR/app/build/outputs/bundle/release"
AAB="$BUNDLE_DIR/app-release.aab"

DRY_RUN=0
ALLOW_DIRTY=0
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
  --allow-dirty          No exige árbol limpio ni HEAD pusheado. Para probar la
                         subida con cambios sin commitear; el AAB pasa a
                         corresponder a un estado que no está en git.
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
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
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

# Las dos contraseñas de la clave se buscan en el llavero antes de complainar,
# para que publicarse sea exportar tres variables y no cinco. El entorno manda
# sobre el llavero: si algo está en los dos, gana el entorno.
# El nombre del servicio es el mismo que en la instrucción de abajo del
# mensaje de error: orbit-hub-upload, con guion y no sin él.
KEYCHAIN_SERVICE_PREFIX="orbit-hub-upload"
for pair in \
  "ORBIT_HUB_UPLOAD_STORE_PASSWORD:store" \
  "ORBIT_HUB_UPLOAD_KEY_PASSWORD:key"
do
  VAR="${pair%%:*}"
  ITEM="${pair##*:}"
  if [ -z "${!VAR:-}" ] && command -v security >/dev/null 2>&1; then
    FROM_KEYCHAIN="$(security find-generic-password -a "${USER:-$(id -un)}" -s "$KEYCHAIN_SERVICE_PREFIX-$ITEM" -w 2>/dev/null || true)"
    if [ -n "$FROM_KEYCHAIN" ]; then
      export "${VAR}=${FROM_KEYCHAIN}"
      ok "$VAR desde el llavero"
    fi
  fi
done

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

    Para las dos contraseñas de la clave, el script las busca en el llavero si no
    están en el entorno. Guarda las tuyas una vez con:

      security add-generic-password -a \"\$USER\" -s orbit-hub-upload-store -w
      security add-generic-password -a \"\$USER\" -s orbit-hub-upload-key   -w

    (Las dos órdenes piden la contraseña sin hacer eco, así que no queda en el
    historial del shell.)

    Y luego solo hace falta exportar las otras tres:

      export ORBIT_HUB_UPLOAD_KEYSTORE=\"\$PWD/apps/mobile/keys/orbit-hub-upload.jks\"
      export ORBIT_HUB_UPLOAD_KEY_ALIAS=\"orbit-hub-upload\"
      export SUPPLY_JSON_KEY_PATH=\"\$HOME/keys/play-service-account.json\""
fi

if [ -n "${ORBIT_HUB_UPLOAD_KEYSTORE:-}" ] && [ ! -f "$ORBIT_HUB_UPLOAD_KEYSTORE" ]; then
  fail "ORBIT_HUB_UPLOAD_KEYSTORE apunta a '$ORBIT_HUB_UPLOAD_KEYSTORE' y ese fichero no existe."
fi
if [ -n "${SUPPLY_JSON_KEY_PATH:-}" ] && [ ! -f "$SUPPLY_JSON_KEY_PATH" ]; then
  fail "SUPPLY_JSON_KEY_PATH apunta a '$SUPPLY_JSON_KEY_PATH' y ese fichero no existe."
fi
ok "credenciales presentes"

# ------------------------------------------------------------ API destino ----

# Expo lee apps/mobile/.env (desarrollo, localhost) y .env.local. Ninguno de los
# dos sirve para una release: el bundle lleva la URL compilada dentro y Metro no
# la resuelve en runtime. Asi que la URL de produccion entra en el entorno justo
# antes de compilar, y por encima de lo que lea Expo.
#
# Sin esto, el AAB llama a http://localhost:4000 desde el movil del usuario: la
# app abre, funciona offline y no sincroniza nada. No hay error visible, porque
# una conexion rechazada parece una red mala.
RELEASE_ENV_EXAMPLE="$MOBILE/.env.release.example"

if [ ! -f "$RELEASE_ENV" ]; then
  fail "No existe $RELEASE_ENV.

    Es el fichero que dice contra que API se compila el AAB. Sin el, el bundle
    lleva http://localhost:4000 compilado dentro y la app instalada no
    sincroniza, sin ningun error visible.

    Crealo a partir del ejemplo:

      cp $RELEASE_ENV_EXAMPLE $RELEASE_ENV

    y pon dentro la URL real de tu API."
fi

# Se lee el fichero y se exporta. El orden importa: esto va DESPUES de lo que
# Expo cargue, para ganar.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    EXPO_PUBLIC_*)
      export "$key=$value"
      ;;
  esac
done < "$RELEASE_ENV"

# El prefijo /api/v1 no es opcional: la app une rutas sobre la base, y sin el
# pediria https://orbithub-api.jrz-labs.com/auth/login, que responde 404. En una
# pantalla de login eso se lee como "contrasena incorrecta".
if [ -z "${EXPO_PUBLIC_API_URL:-}" ]; then
  fail "EXPO_PUBLIC_API_URL esta vacio en $RELEASE_ENV."
fi

API_HOST="$(node -e 'try { console.log(new URL(process.argv[1]).host) } catch { process.exit(1) }' "$EXPO_PUBLIC_API_URL" 2>/dev/null || echo "")"
[ -n "$API_HOST" ] || fail "EXPO_PUBLIC_API_URL no es una URL valida: '$EXPO_PUBLIC_API_URL'"
case "$API_HOST" in
  localhost|127.0.0.1|10.0.2.2)
    fail "EXPO_PUBLIC_API_URL apunta a $API_HOST, que es la maquina que compila.

    El bundle llevaria la direccion de tu portatil y la app no tendria donde
    llamar. Pon la URL de la API desplegada."
    ;;
esac
ok "API: $EXPO_PUBLIC_API_URL"
ok "web: ${EXPO_PUBLIC_WEB_ORIGIN:-<sin valor, los enlaces de correo saldran mal>}"

if [ -z "${EXPO_PUBLIC_WEB_ORIGIN:-}" ]; then
  fail "EXPO_PUBLIC_WEB_ORIGIN esta vacio en $RELEASE_ENV.

    Es de donde se sirve la app, y se usa en el correo de verificacion y en las
    invitaciones. Si falta, los enlaces que salen en el correo no llevan a
    ninguna parte. No es un aviso: la app se instala igual."
fi

# -------------------------------------------------------------- git ----

step "2/10  Git"

# Un worktree de git tiene .git como fichero, no como directorio, y esta
# comprobación tiene que_valer para los dos.
git rev-parse --git-dir >/dev/null 2>&1 || fail "Esto no es un repositorio git."

# Los guards de árbol limpio y de HEAD pusheado protegen la publicación, no al
# que escribe. Con --allow-dirty se saltan y el AAB pasa a corresponder a un
# estado de trabajo que no está en ningún commit. Para probar el mecanismo de
# subida; no para publicar de verdad.
if [ "$ALLOW_DIRTY" -eq 1 ]; then
  ok "AVISO: --allow-dirty, los guards de git no se comprueban"
  hint "$(git status --short | wc -l | tr -d ' ') ficheros sin commitear"
else
if [ -n "$(git status --porcelain)" ]; then
  git status --short
  fail "El árbol tiene cambios sin commitear.

    Un AAB no corresponde a ningún commit si hay cambios sin commitear: no
    podrías reproducir ni revertir la publicación. Commitea o guarda los
    cambios antes de seguir, o pasa --allow-dirty si solo estás probando."
fi
ok "árbol limpio"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" = "HEAD" ]; then
  fail "Estás en un checkout desligado (detached HEAD). No hay rama a la que publicar."
fi

if [ "$ALLOW_DIRTY" -eq 1 ]; then
  ok "AVISO: HEAD sin comprobar, rama $BRANCH"
elif git rev-parse --verify --quiet "@{u}" >/dev/null; then
  LOCAL_SHA="$(git rev-parse HEAD)"
  REMOTE_SHA="$(git rev-parse '@{u}')"
  if [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    git log --oneline "@{u}..HEAD"
    fail "HEAD no está subido a $BRANCH.

    Publicar commits que nadie más tiene no sirve de nada y rompe el historial
    cuando alguien haga pull. Push primero, o pasa --allow-dirty si solo estás
    probando."
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

# El bundle es lo que se instala. Comprobar que la API quedó dentro del JS es
# distinto de comprobar que la variable estaba puesta: Metro la inlinea durante
# el export, y hay un modo de fallo en el que el build la ve y el bundler no.
node scripts/assert-export-env.mjs >/dev/null 2>&1 \
  || fail "El entorno publico no pasa assert-export-env.

    Correlo suelto para ver que variable falla:

      node scripts/assert-export-env.mjs"
ok "entorno publico validado"

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
step "7/10  Prebuild"

if [ -d "$GRADLE_DIR" ]; then
  hint "borrando $GRADLE_DIR (generada por expo prebuild)"
  rm -rf "$GRADLE_DIR"
fi

# El prebuild tiene que correr dentro de apps/mobile: app.json vive ahí y, desde
# la raíz, expo genera ./android para el paquete que adivine del directorio.
# No es un fallo ruidoso: crea el árbol entero y solo se nota al buscar
# después el build.gradle, en otro sitio.
( cd "$MOBILE" && npx expo prebuild --platform android --clean --no-install )
# Un prebuild que se-ha-equivocado-de-directorio deja ./android en la raíz.
# Pasa si el árbol se generó donde el script espera; si no, este es el aviso.
if [ -d "android/app" ] && [ ! -d "$GRADLE_DIR" ]; then
  rm -rf "android"
  fail "El prebuild generó android/ en la raíz del repo y no en $GRADLE_DIR.

    Eso pasa si app.json no se encuentra donde expo lo busca. Se ha borrado el
    árbol mal generado; no he tocado nada más."
fi

ok "$GRADLE_DIR regenerado"

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

grep -q "applicationId '$ANDROID_PACKAGE'" "$GRADLE_DIR/app/build.gradle" \
  || fail "El applicationId generado no es $ANDROID_PACKAGE.

    Si es otro, el AAB pertenece a otra app y Play lo rechaza."
ok "applicationId $ANDROID_PACKAGE"

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

# `supply` no lleva --upload_to_play: el subcomando `run`, que es el que
# existe, ya sube. Los flags de upload llevan guion corto y el JSON de la
# cuenta de servicio va con --json_key.
SUPPLY_ARGS=(
  supply
  --json_key "$SUPPLY_JSON_KEY_PATH"
  --aab "$AAB"
  --track "$TRACK"
  --version_name "$NEXT_NAME"
  --version_code "$NEXT_CODE"
  --package_name "$ANDROID_PACKAGE"
  --release_status completed
  --skip_upload_metadata
  --skip_upload_changelogs
  --timeout 600
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