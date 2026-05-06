# Builds the shell (Flutter Web) AND the embedded game (Phaser/Vite) and
# serves both from the same nginx container. /game/ is a sub-path of the
# shell origin — postMessage to the iframe and Socket.IO auth from the
# iframe both stay same-origin, so no cross-origin GAME_URL plumbing is
# needed and there's only one container to deploy.

# ─── Stage 1 — build the Phaser game bundle ─────────────────────────────────
FROM node:20-alpine AS game-builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared-js/ packages/shared-js/
COPY packages/game-view/ packages/game-view/
RUN npm ci
# Build shared-js first so game-view's tsc + vite can resolve its compiled output.
RUN npm --prefix packages/shared-js run build
WORKDIR /app/packages/game-view
ARG VITE_BACKEND_URL=http://localhost:3001
RUN VITE_BACKEND_URL=${VITE_BACKEND_URL} npm run build

# ─── Stage 2 — build the Flutter Web shell ──────────────────────────────────
FROM ghcr.io/cirruslabs/flutter:stable AS shell-builder
ARG BACKEND_URL=http://localhost:3001
WORKDIR /app
COPY apps/frontend/ apps/frontend/
WORKDIR /app/apps/frontend
RUN if [ ! -f firebase_options.dart ] && [ -f firebase_options.dart.example ]; then cp firebase_options.dart.example firebase_options.dart; fi
RUN flutter pub get
# GAME_URL is omitted: the bundle defaults to the relative path `/game/`,
# served by the same nginx alongside the shell.
RUN flutter build web --base-href / \
    --pwa-strategy=none \
    --dart-define=BACKEND_URL=${BACKEND_URL}

# ─── Stage 3 — runtime: single nginx serving / and /game/ ───────────────────
FROM nginx:alpine
COPY --from=shell-builder /app/apps/frontend/build/web      /usr/share/nginx/html
COPY --from=game-builder  /app/packages/game-view/dist      /usr/share/nginx/html/game
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
