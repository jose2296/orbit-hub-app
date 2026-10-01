# Publicar OrbitHub en Google Play

Un comando. Todo local, sin coste de build y sin que el binario salga de tu
máquina:

```bash
npm run release -- --dry-run              # comprueba y para
npm run release -- --track internal       # sube a internal testing
npm run release -- --track production     # sube a producción
```

- **App**: `com.jrzlabs.orbithub`
- **Build**: `./gradlew bundleRelease` sobre `apps/mobile/android`, que se
  genera con `expo prebuild`
- **Subida**: `fastlane supply` → API de Google Play Developer, directo desde tu
  máquina. Ni EAS Build ni `eas submit`: no se paga nada y no interviene Expo.

Antes del primer `npm run release` hay tres cosas que hacer. Son de una vez.

---

## 1. La clave de subida

Es la clave con la que se firman los AABs que tú subes. **No es la clave con la
que sale la app en la tienda.** Google guarda esa, la suya, y es la que la
app usa en los dispositivos de los usuarios. Si pierdes la tuya, la tuya, Google
tiene forma de recuperarlo; si pierdes la de Google, la app queda sin
actualizar para siempre.

```bash
mkdir -p apps/mobile/keys

keytool -genkeypair -v \
  -keystore apps/mobile/keys/orbit-hub-upload.jks \
  -alias orbit-hub-upload \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype JKS
```

`apps/mobile/keys/` está en `.gitignore`. **No la commitees ni la subas a ningún
sitio.** Quien tenga ese fichero puede subir una versión firmada como tú.

Guarda la contraseña en el llavero de macOS, no en un fichero:

```bash
security add-generic-password -a "$USER" -s orbit-hub-upload-store -w
security add-generic-password -a "$USER" -s orbit-hub-upload-key   -w
```

Sácalas cuando quieras publicar:

```bash
export ORBIT_HUB_UPLOAD_KEYSTORE="$PWD/apps/mobile/keys/orbit-hub-upload.jks"
export ORBIT_HUB_UPLOAD_STORE_PASSWORD="$(security find-generic-password -a "$USER" -s orbit-hub-upload-store -w)"
export ORBIT_HUB_UPLOAD_KEY_ALIAS="orbit-hub-upload"
export ORBIT_HUB_UPLOAD_KEY_PASSWORD="$(security find-generic-password -a "$USER" -s orbit-hub-upload-key -w)"
```

### Qué hace el plugin, y por qué existe

`apps/mobile/android/app/build.gradle` trae de fábrica el build `release`
firmado con `debug.keystore`. Un AAB así lo rechaza Play sin un mensaje que
digas por qué. El plugin `plugins/with-upload-signing.js` inyecta la firma
correcta en cada `expo prebuild`:

```groovy
release {
    if (System.getenv('ORBIT_HUB_UPLOAD_KEYSTORE')) {
        signingConfig signingConfigs.upload
    } else {
        signingConfig signingConfigs.debug
    }
}
```

Por eso `npm run release` exige las variables: sin ellas se firmaría con debug.
Si no están, el script para y te dice cuáles faltan.

Para firmar en local sin el script (por ejemplo un APK para probar en un
dispositivo):

```bash
ORBIT_HUB_UPLOAD_KEYSTORE=... ORBIT_HUB_UPLOAD_STORE_PASSWORD=... \
ORBIT_HUB_UPLOAD_KEY_ALIAS=... ORBIT_HUB_UPLOAD_KEY_PASSWORD=... \
npx expo run:android --variant release
```

---

## 2. La cuenta de servicio ya está; falta el JSON

`orbit-hub-play-uploader@orbithub-509713.iam.gserviceaccount.com` ya existe en
Google Cloud. Lo que falta es **la clave JSON**: es un fichero que solo se
descarga una vez y que no se puede volver a recuperar.

1. [console.cloud.google.com](https://console.cloud.google.com) → proyecto
   **`orbithub-509713`**
2. *IAM & Admin* → *Service Accounts* → `orbit-hub-play-uploader`
3. Pestaña *Keys* → *Add key* → *Create new key* → tipo **JSON** → *Create*
4. Se descarga solo. Ponlo **fuera del repo**:

```bash
mkdir -p ~/keys
mv ~/Downloads/<el-fichero>.json ~/keys/play-service-account.json
chmod 600 ~/keys/play-service-account.json

export SUPPLY_JSON_KEY_PATH="$HOME/keys/play-service-account.json"
```

`~/keys/` no lo cubre el `.gitignore` del repo porque está fuera. Si en algún
momento lo mueves dentro del proyecto, `*service-account*.json` ya está
ignorado.

### Si la API no está habilitada

Si la primera subida falla con `SERVICE_DISABLED` o `403`, habilítala en
[APIs & Services → Library](https://console.cloud.google.com/apis/library) →
busca **Google Play Android Developer API** → *Enable*.

### Permisos en Play Console

La cuenta de servicio ya está invitada. Comprueba que en
*Users and permissions* su fila tiene la app `com.jrzlabs.orbithub` con:

- **Release to production** — para subir a cualquier pista
- **View app information** — Play lo pide junto a lo anterior

Con *Admin* también funciona, pero no hace falta.

---

## 3. La app en Play Console

`https://play.google.com/apps/publish/`

- **Crear app**: nombre, idioma por defecto, **App o juego** → *App*, gratis
- **Declaraciones de la app**: completes
- **Público objetivo y contenido**: la ficha de la tienda y los �‑sintetizadores
  de clasificación parental. Sin esto, Play no publica nada
- **Política de privacidad**: URL pública. En `apps/mobile` hay
  `src/app/legal/privacy.tsx`; falta publicarla en un dominio

Para una cuenta **personal** creada después de noviembre de 2023, Google pide
además **12 testers en internal testing durante 14 días** antes de permitir un
rollout cerrado o público. Es un requisito de ellos, no del build: entra antes
de contar con publicar a producción hoy.

---

## Qué hace el script

| Paso | Qué pasa | Si falla |
| --- | --- | --- |
| 1 | Node 20+, `node_modules`, credenciales presentes | Para antes de tocar nada |
| 2 | Árbol limpio y `HEAD` pusheado | Para. Un AAB sin commit no se puede reproducir ni revertir |
| 3 | `npm run typecheck` | Para. No hay AAB que subir |
| 4 | `npm run test` | Para |
| 5 | `expo config` | Para |
| 6 | Calcula la versión. `--dry-run` para aquí | — |
| 7 | `expo prebuild --clean`, comprueba el `applicationId` y que el plugin de firma se aplicó | Para |
| 8 | `./gradlew bundleRelease` | Para |
| 9 | Comprueba que el AAB existe y pesa más de 1 MB | Para |
| 10 | `fastlane supply` | Play decide |

Los guards son el motivo de que exista el script y no un `alias`. Publicar en
producción es la clase de acción que no quieres que pase después de un typecheck
rojo.

### Opciones

```
--patch                 0.1.0 -> 0.1.1   (por defecto)
--minor                 0.1.0 -> 0.2.0
--major                 0.1.0 -> 1.0.0
--track internal        por defecto. No necesita datos de la tienda
--track production      con --rollout 0.1 por defecto
--rollout 1             publica al 100% en vez de al 10%
```

`versionCode` sube siempre, uno por release. Play rechaza un AAB con un código
repetido, y el bump lo hace el script porque `apps/mobile/android` se regenera
en cada prebuild y no se versiona: la versión vive en `app.json`.

`internal` no acepta `--rollout`: en internal testing reciben el build el 100%
de los testers de la lista, así que un rollout no significa nada y fastlane
falla con un error poco claro.

### Después de subir

El AAB queda en la pista esperando revisión. Google tarda de unas horas a un
día en procesarlo, y **la publicación a los usuarios no ocurre hasta que lo
apruebes en Play Console**. Para internal testing hay que Promote → *Internal
testing*; para producción, *Promote* y *Start rollout to Production*.

El bump de versión queda sin commitear. Commitéalo:

```bash
git add apps/mobile/app.json && git commit -m "release 0.1.1"
```

---

## Si algo falla

**`adb` no encuentra el dispositivo** — solo afecta a `expo run:android`, no al
build del AAB.

**`Android Gradle plugin requires Java 17`** — `java -version`. Con Android
Studio instalado, apunta `JAVA_HOME` a su JDK.

**`Gradle build failed`** — el error real está más arriba. `cd apps/mobile/android
&& ./gradlew bundleRelease --no-daemon` para verlo sin el ruido del script.

**`403` al subir, y el service account sí está invitado** — los permisos tardan
unos minutos en aplicarse tras invitar. Espera y reintenta. Si persiste, revisa
que la fila tenga la app y *Release to production*.

**`The APK is signed with the debug keystore`** — el plugin no se aplicó.
Comprueba que `./plugins/with-upload-signing` sigue en `app.json` → `plugins`, y
que `apps/mobile/android/app/build.gradle` menciona `signingConfigs.upload`. El
script aborta en ese caso, pero si construiste el AAB por tu cuenta, no pasó por
ahí.

**Cambio de plantilla de Expo** — el plugin busca un bloque concreto de
`build.gradle` (`keyPassword 'android'` y el `release` con firma de debug). Si
Expo lo cambia, el plugin lanza un error que dice exactamente qué no encontró en
vez de parchear a medias.