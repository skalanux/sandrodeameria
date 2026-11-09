# Avatar con voz clonada

Avatar 2D para una muestra escolar: la cara de un amigo, una boca que se abre y se cierra, y 12 frases con su voz clonada. Se controla desde el celular; el audio suena en la pantalla.

No usa lip-sync fotorrealista ni Whisper. El dictado del micrófono usa la **Web Speech API** del navegador y, si no está disponible, se puede escribir el texto.

## Modos

| Ruta | Uso |
| --- | --- |
| `/` | Pantalla: solo el avatar. Acá suena el audio. |
| `/control` | Control remoto desde el celular: frases, micrófono, texto y Stop. |
| `/local` | Setup y calibración de la boca en la compu. |

El servidor elige una **pantalla primaria**. Si hay más de una pantalla conectada, solo la primaria recibe los comandos; las demás muestran “Pantalla secundaria”. Esto evita el audio duplicado.

## Requisitos

- Node.js 22 o superior para correr sin Docker.
- Un navegador con Web Speech API para el micrófono: Chrome, Edge o Chromium en Android/escritorio. En Safari puede variar.
- **HTTPS** para usar el micrófono, salvo `http://localhost`, que el navegador considera seguro.
- Una clave de Fish Audio solo si vas a usar texto libre. Las 12 frases estáticas ya tienen sus MP3 y no necesitan la API.

## Probar localmente

```bash
cp .env.example .env
# Editá .env: como mínimo VOICE_PROVIDER, FISH_API_KEY y FISH_VOICE_ID
npm start
```

Abrí:

- `http://localhost:4173/` → pantalla.
- `http://localhost:4173/control` → control.
- `http://localhost:4173/local` → calibración.

Para desarrollo con recarga:

```bash
npm run dev
```

En Linux, para abrir la pantalla en modo kiosco con Chromium:

```bash
npm run standalone
```

### Probar el contenedor localmente

El compose de producción usa Traefik y la red `proxy`. Para probar solo el contenedor hay un compose aparte:

```bash
docker compose -f docker-compose.local.yml up --build
```

Luego abrí `http://localhost:4173/`. No usa Traefik ni basic auth. El `.env` y la carpeta `assets/` se montan desde tu máquina.

Si ya tenés `npm start` corriendo en el puerto 4173, parálo antes de levantar el contenedor.

## Cómo se usa el micrófono

1. Abrí primero la pantalla y después `/control`.
2. Tocá **Hablar** y aceptá el permiso del micrófono.
3. Dictá. Al terminar, el texto aparece en la barra de envío.
4. Se envía solo a los **1,5 s**; podés tocar **Cancelar** para descartarlo.
5. El botón del micrófono cambia a **Terminar** para cerrar el dictado. El botón **Detener** corta el audio del avatar y manda el comando de Stop.

Si el navegador no soporta Web Speech, la página está en HTTP fuera de localhost, o el permiso está denegado, el botón queda deshabilitado y se usa el campo de texto. También podés escribir directamente y apretar Enter en cualquier momento.

Notas:

- El botón de micrófono se habilita cuando hay una pantalla conectada.
- En la pantalla hay que tocar una vez **Activar pantalla** para habilitar el audio del navegador.
- La Web Speech API manda el audio al servicio de dictado del navegador. No se graba ni se sube al servidor de la app.

## Cara o video

Si existe `assets/face.mp4`, aparece el botón **Visual** en `/control` y `/local`:

- **Cara**: usa la foto, la boca CSS y la animación de respiración.
- **Video**: muestra `face.mp4` con su propia boca animada. El video va muteado y se reproduce solo cuando el avatar habla. Arranca en el segundo `2` (`VIDEO_START_TIME` en `app.js`) y, si se termina antes que el audio, vuelve a ese segundo. En este modo se desactivan la boca CSS y el movimiento por CSS.

El video no está en git; se sube a la VPS junto con la foto.

## Voz y audios

Los 12 audios están en `assets/audio/01.mp3` … `12.mp3` y se versionan en git.

Para regenerarlos con Fish Audio:

```bash
npm run clone -- assets/voz-amigo.wav "Voz de mi amigo"
# Pegá el voice ID en FISH_VOICE_ID dentro de .env
npm run generate
```

Variables de voz:

```env
VOICE_PROVIDER=fish
FISH_API_KEY=...
FISH_VOICE_ID=...
FISH_MODEL=s2.1-pro-free
FISH_LANGUAGE=es-AR
FISH_API_BASE=https://api.fish.audio
```

`FISH_API_KEY` se usa solo en el servidor, para `/api/tts`. Nunca llega al navegador. Si en la muestra usás solo las 12 frases, la app funciona aunque la clave no esté configurada.

## Deploy en la VPS

El deploy es manual, desde tu máquina, con `rsync` + SSH + Docker Compose. GitHub queda como repositorio; no se configuran Actions.

### Antes de empezar

- DNS: `avatar.example.com` (reemplazalo por tu dominio real) apuntando a la VPS.
- Traefik v2 con:
  - entrypoint HTTPS `websecure`;
  - cert resolver `letsencrypt`;
  - redirect global de HTTP a HTTPS;
  - red Docker `proxy`;
  - **sin** auth global (la auth la pone el avatar).
- Docker Engine y Docker Compose v2 en la VPS.
- `rsync` en tu máquina y en la VPS.
- Puertos 22, 80 y 443 abiertos. Los puertos 4173 y 4443 ya no se publican; si les habías abierto reglas en UFW, quitálas:
  ```bash
  sudo ufw delete allow 4173/tcp
  sudo ufw delete allow 4443/tcp
  ```

### 1. Crear el usuario de deploy

En la VPS, como root:

```bash
adduser --disabled-password --gecos "" deploy
usermod -aG docker deploy
mkdir -p /opt/avatar/assets
chown -R deploy:deploy /opt/avatar
```

En tu máquina:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/avatar_deploy -C avatar-deploy
ssh-copy-id -i ~/.ssh/avatar_deploy.pub deploy@TU_VPS
```

El grupo `docker` equivale a root. Usá una clave dedicada y protegé el acceso a la VPS.

### 2. Crear `.env` en la VPS

```bash
cd /opt/avatar
install -m 600 /dev/null .env
nano .env
```

Contenido mínimo:

```env
VOICE_PROVIDER=fish
FISH_API_KEY=...
FISH_VOICE_ID=...
FISH_MODEL=s2.1-pro-free
FISH_LANGUAGE=es-AR
FISH_API_BASE=https://api.fish.audio

HOST=0.0.0.0
PORT=4173

SERVER_HOST=avatar.example.com
BASIC_AUTH_USERS='usuario:$2y$05$...'
```

Generá el hash de basic auth:

```bash
htpasswd -nbB usuario 'tu-clave'
```

Si no tenés `htpasswd`:

```bash
docker run --rm httpd:alpine htpasswd -nbB usuario 'tu-clave'
```

En `.env`, el hash va **entre comillas simples** para que los `$` no se interpolen.

### 3. Subir la foto o el video

Subí el archivo que uses. Podés tener los dos:

```bash
rsync -av assets/face.jpg deploy@TU_VPS:/opt/avatar/assets/
rsync -av assets/face.mp4 deploy@TU_VPS:/opt/avatar/assets/
```

La foto y el video no están en git y no entran en la imagen. Quedan montados read-only desde `/opt/avatar/assets`.

Si los cambiás, volvé a subirlos. Como se monta la carpeta completa, no hace falta rebuildear.

### 4. Configurar el deploy local

```bash
cp .env.deploy.example .env.deploy
```

Editá `.env.deploy`:

```env
DEPLOY_HOST=TU_VPS
DEPLOY_USER=deploy
DEPLOY_PATH=/opt/avatar
SERVER_HOST=avatar.example.com
```

`.env.deploy` está en `.gitignore`.

### 5. Deployar

```bash
npm run deploy
```

El script:

1. Sincroniza el código con `rsync` (sin tocar `.env`, `assets/face.jpg` ni `assets/face.mp4`).
2. Entra por SSH a `/opt/avatar`.
3. Buildea `avatar:<sha>` y ejecuta `docker compose up -d --wait`.
4. Verifica que `https://.../` responda `401` por basic auth.

Si el healthcheck falla, revisá:

```bash
ssh deploy@TU_VPS 'cd /opt/avatar && docker compose ps && docker compose logs --tail=100 avatar'
```

### Rollback

Las imágenes quedan taggeadas con el SHA. Para volver a una anterior:

```bash
ssh deploy@TU_VPS 'cd /opt/avatar && IMAGE_TAG=<sha-viejo> docker compose up -d --no-build --wait'
```

### Actualizar la foto o el video

```bash
rsync -av assets/face.jpg deploy@TU_VPS:/opt/avatar/assets/
rsync -av assets/face.mp4 deploy@TU_VPS:/opt/avatar/assets/
```

No hace falta rebuildear ni reiniciar: el contenedor monta la carpeta `assets/`.

## Traefik

Los labels del compose son:

```yaml
- "traefik.enable=true"
- "traefik.docker.network=proxy"

- "traefik.http.routers.avatar.rule=Host(`${SERVER_HOST}`)"
- "traefik.http.routers.avatar.entrypoints=websecure"
- "traefik.http.routers.avatar.tls=true"
- "traefik.http.routers.avatar.tls.certresolver=letsencrypt"
- "traefik.http.routers.avatar.middlewares=avatar-auth"
- "traefik.http.services.avatar.loadbalancer.server.port=4173"

- "traefik.http.middlewares.avatar-auth.basicauth.users=${BASIC_AUTH_USERS}"
```

No hay router HTTP porque el redirect global ya manda todo a HTTPS.

La app ya manda `X-Accel-Buffering: no` en `/api/events`. No agregues un middleware de compresión ni de buffering al router del avatar, porque puede demorar los eventos de SSE.

## Verificación en producción

1. `https://avatar.example.com/` pide usuario/clave.
2. La pantalla muestra el avatar y el overlay **Activar pantalla**.
3. `/control` pide login y muestra las frases.
4. El botón de micrófono se habilita cuando la pantalla está conectada.
5. Dictado: aparece la barra de envío y se va solo a los 1,5 s.
6. **Cancelar** descarta el dictado; **Detener** corta el audio.
7. El botón **Visual** cambia entre **Cara** y **Video** en la pantalla.
8. Solo la pantalla primaria reproduce. Si abrís una segunda, muestra “Pantalla secundaria”.

## Seguridad

- `.env` no está en git, no está en la imagen y no se sincera por rsync.
- La foto y el video tampoco están en git ni en la imagen.
- El contenedor no publica puertos; solo Traefik lo alcanza por la red `proxy`.
- La API key de Fish queda en el entorno del contenedor. Cualquiera con root o acceso al grupo `docker` en la VPS puede verla; es el límite de confianza de una VPS dedicada.
- **No escales a dos réplicas**: el estado de displays, control y display primario está en memoria. Dos contenedores romperían la lógica de audio único.

## Estructura

```text
server.js                 HTTP, SSE, comandos, TTS y archivos estáticos
app.js                    Pantalla, control, micrófono Web Speech y calibración
index.html                Interfaz de los tres modos
styles.css                Estilos
lib/voice.js              Adaptador de Fish Audio / demo
assets/audio/             Los 12 MP3
assets/face.jpg           Foto privada (no versionada)
assets/face.mp4           Video privado (no versionado)
Dockerfile                Imagen Node sin Whisper ni Python
docker-compose.yml        Producción con Traefik
docker-compose.local.yml  Prueba local del contenedor
scripts/deploy.sh         Deploy manual por rsync + SSH
```

## Problemas comunes

**El micrófono está deshabilitado**

- Abrí la página por HTTPS, o por `http://localhost`.
- Aceptá el permiso del micrófono.
- Verificá que haya una pantalla conectada.
- Probá Chrome/Edge; si el navegador no soporta Web Speech, usá el campo de texto.

**No se escucha audio en la pantalla**

- Tocá **Activar pantalla** una vez.
- Verificá que la pantalla sea la primaria.
- Revisá el volumen y la salida de audio del dispositivo.

**Traefik devuelve 502**

```bash
ssh deploy@TU_VPS 'cd /opt/avatar && docker compose ps && docker compose logs --tail=100 avatar'
```

**El certificado no se emite**

- Confirmá el DNS con `dig +short avatar.example.com`.
- Verificá que 80 y 443 estén abiertos.
- Revisá los logs de Traefik.

**Error de Fish Audio**

- Revisá `FISH_API_KEY` y `FISH_VOICE_ID` en `/opt/avatar/.env`.
- Si solo usás las 12 frases, podés ignorar el error de texto libre.

**SSE se reconecta**

- Es normal si el contenedor se reinició.
- Revisá que no haya un middleware de compresión o buffering en el router del avatar. La app ya manda `X-Accel-Buffering: no`.
