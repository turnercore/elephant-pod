FROM node:22-alpine
WORKDIR /app
COPY apps/segmenter/server.mjs /app/server.mjs
COPY apps/segmenter/segmenter-output.schema.json /app/segmenter-output.schema.json
ENV PORT=8002
EXPOSE 8002
CMD ["node", "/app/server.mjs"]
