# ── Stage 1: Build frontend ────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:22-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server.js ./
COPY server/ ./server/
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

# Persistent data (SQLite DB + JWT secret)
VOLUME /app/data

EXPOSE 3000

# Run as non-root
RUN addgroup -S iptv && adduser -S iptv -G iptv
RUN mkdir -p /app/data && chown -R iptv:iptv /app/data
USER iptv

# tini handles PID 1 / signal forwarding properly
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
