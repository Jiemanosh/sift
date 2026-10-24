FROM node:22-alpine

ENV NODE_ENV=production \
    SIFT_PORT=8787 \
    SIFT_HOST=0.0.0.0 \
    SIFT_DATA_DIR=/data

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public

RUN mkdir -p /data && chown -R node:node /app /data

USER node

EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

CMD ["node", "--dns-result-order=ipv4first", "server/index.js"]
