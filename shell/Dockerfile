# Build stage - Flutter
FROM ghcr.io/cirruslabs/flutter:stable AS builder
WORKDIR /app
COPY shell/ shell/
WORKDIR /app/shell
# Handle missing firebase_options.dart by copying from example if needed
RUN if [ ! -f firebase_options.dart ] && [ -f firebase_options.dart.example ]; then cp firebase_options.dart.example firebase_options.dart; fi
RUN flutter pub get
RUN flutter build web --base-href /

# Runtime stage - serve with nginx
FROM nginx:alpine
COPY --from=builder /app/shell/build/web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

