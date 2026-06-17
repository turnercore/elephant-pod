FROM node:22-alpine AS build
WORKDIR /app
COPY tsconfig.base.json tsconfig.base.json
COPY apps/server apps/server
WORKDIR /app/apps/server
RUN npm install
RUN npm run build

FROM node:22-alpine AS runtime
RUN apk add --no-cache ffmpeg
RUN apk add --no-cache yt-dlp
WORKDIR /app/apps/server
ENV NODE_ENV=production
ENV PORT=8787
ENV CLIP_RENDER_ENABLED=true
ENV FFMPEG_PATH=ffmpeg
COPY --from=build /app/apps/server/package.json package.json
RUN npm install --omit=dev
COPY --from=build /app/apps/server/dist dist
EXPOSE 8787
CMD ["node", "dist/index.js"]
