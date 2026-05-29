FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_RUNTIME_MODE=server
ENV VITE_RUNTIME_MODE=${VITE_RUNTIME_MODE}
COPY package.json package.json
COPY tsconfig.base.json tsconfig.base.json
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm install
COPY apps apps
COPY src-tauri src-tauri
RUN npm run build:web && npm run build:server

FROM node:22-alpine AS runtime
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8787
ENV WEB_DIST=apps/web/dist
ENV CLIP_RENDER_ENABLED=true
ENV FFMPEG_PATH=ffmpeg
COPY --from=build /app /app
EXPOSE 8787
CMD ["node", "apps/server/dist/index.js"]
