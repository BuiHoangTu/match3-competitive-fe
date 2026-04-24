# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/ shared/
COPY be/ be/
RUN npm ci
WORKDIR /app/be
RUN npm run build

# Runtime stage
FROM node:20-alpine
WORKDIR /app/be
COPY package.json package-lock.json /app/
COPY shared/ /app/shared/
COPY be/package.json be/
RUN npm ci --omit=dev
COPY --from=builder /app/be/dist ./dist
EXPOSE 3001
CMD ["node", "dist/be/src/server.js"]
