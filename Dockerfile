FROM node:24-alpine AS assets
WORKDIR /build
RUN npm install -g esbuild@0.24.0 --silent
COPY public ./public
RUN cd public \
  && for f in *.js; do esbuild "$f" --minify --format=esm --target=es2022 --outfile="$f" --allow-overwrite --log-level=warning; done \
  && esbuild styles.css --minify --outfile=styles.css --allow-overwrite --log-level=warning

FROM node:24-alpine
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY --from=assets /build/public ./public
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/round >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
