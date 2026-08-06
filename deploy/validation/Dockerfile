FROM node:22-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /app/data && chown -R node:node /app

USER node
ENV NODE_ENV=validation
ENV PORT=5173
EXPOSE 5173

CMD ["node", "server.js"]
