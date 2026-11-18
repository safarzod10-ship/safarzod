# syntax=docker/dockerfile:1.7
# ---- build ----
FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime: game server + broadcast tools (Chromium, Xvfb, PulseAudio, FFmpeg) ----
FROM node:24-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium xvfb pulseaudio ffmpeg tini ca-certificates fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10001 heist \
 && useradd --system --uid 10001 --gid heist --home-dir /data --shell /usr/sbin/nologin heist
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY deploy ./deploy
ENV NODE_ENV=production \
    DATA_DIR=/data \
    CLIENT_DIR=/app/dist/client \
    CHROMIUM_PATH=/usr/bin/chromium \
    PORT=8080 \
    HOST=0.0.0.0
RUN mkdir -p /data && chown heist:heist /data && chmod +x deploy/*.sh
USER heist
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/app/deploy/entrypoint.sh"]
