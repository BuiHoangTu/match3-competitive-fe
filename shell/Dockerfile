# Build stage - Flutter
FROM ghcr.io/cirruslabs/flutter:stable AS builder
ARG BACKEND_URL=http://localhost:3001
ARG GAME_URL=http://localhost:5173/game/
WORKDIR /app
COPY shell/ shell/
WORKDIR /app/shell
# Handle missing firebase_options.dart by copying from example if needed
RUN if [ ! -f firebase_options.dart ] && [ -f firebase_options.dart.example ]; then cp firebase_options.dart.example firebase_options.dart; fi
RUN flutter pub get
# T-Local-08 — bake the backend URL into the build via --dart-define so the
# Flutter Web bundle calls the right host from the browser.
# GAME_URL points at the Phaser bundle (served by the `frontend` service at /game/).
RUN flutter build web --base-href / \
    --dart-define=BACKEND_URL=${BACKEND_URL} \
    --dart-define=GAME_URL=${GAME_URL}

# Runtime stage - serve with nginx
FROM nginx:alpine
COPY --from=builder /app/shell/build/web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

