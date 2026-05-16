# Builds the Flutter Web client. Gameplay is Flutter-native; the legacy
# embedded game bundle is no longer packaged into this image.

# Dependencies download
FROM ghcr.io/cirruslabs/flutter:stable AS shell-builder
WORKDIR /app/fe
COPY fe/pubspec.yaml fe/pubspec.lock ./
RUN flutter pub get

# source code build
ARG BACKEND_URL=http://localhost:3001
COPY fe/ ./
RUN flutter build web --base-href / \
    --pwa-strategy=none \
    --dart-define=BACKEND_URL=${BACKEND_URL}

FROM nginx:alpine
COPY --from=shell-builder /app/fe/build/web      /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
