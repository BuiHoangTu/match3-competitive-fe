# Builds the Flutter Web client. Gameplay is Flutter-native; the legacy
# embedded game bundle is no longer packaged into this image.

FROM ghcr.io/cirruslabs/flutter:stable AS shell-builder
ARG BACKEND_URL=http://localhost:3001
WORKDIR /app
COPY apps/frontend/ apps/frontend/
WORKDIR /app/apps/frontend
RUN flutter pub get
RUN flutter build web --base-href / \
    --pwa-strategy=none \
    --dart-define=BACKEND_URL=${BACKEND_URL}

FROM nginx:alpine
COPY --from=shell-builder /app/apps/frontend/build/web      /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
