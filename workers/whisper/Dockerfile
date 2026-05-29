FROM node:22-alpine
WORKDIR /app
COPY workers/whisper/server.mjs /app/server.mjs
ENV PORT=8001
EXPOSE 8001
CMD ["node", "/app/server.mjs"]
