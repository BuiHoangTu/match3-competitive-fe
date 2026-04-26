# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/ shared/
COPY fe/ fe/
RUN npm ci
WORKDIR /app/fe
ARG VITE_BACKEND_URL=http://localhost:3001
RUN VITE_BACKEND_URL=${VITE_BACKEND_URL} npm run build

# Runtime stage - serve with nginx
FROM nginx:alpine
COPY --from=builder /app/fe/dist /usr/share/nginx/html/game
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
