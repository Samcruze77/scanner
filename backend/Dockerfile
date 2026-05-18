FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV SERVICE_NAME=document-converter-api
ENV UPLOAD_DIR=/tmp/uploads
ENV OUTPUT_DIR=/tmp/outputs

RUN mkdir -p /tmp/uploads /tmp/outputs && chown -R node:node /app /tmp/uploads /tmp/outputs
USER node

EXPOSE 4000

CMD ["node", "src/index.js"]
