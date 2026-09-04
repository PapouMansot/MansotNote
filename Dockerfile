# syntax=docker/dockerfile:1

# ---------- Build Vite ----------
FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_AI_ENDPOINT=""
ARG VITE_AI_MODEL=""
ARG VITE_AI_EMBEDDING_MODEL=""
ENV VITE_AI_ENDPOINT=$VITE_AI_ENDPOINT \
    VITE_AI_MODEL=$VITE_AI_MODEL \
    VITE_AI_EMBEDDING_MODEL=$VITE_AI_EMBEDDING_MODEL

# Version verrouillée dans package.json (packageManager).
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ---------- Serveur statique ----------
FROM nginx:1.27-alpine AS runtime

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
