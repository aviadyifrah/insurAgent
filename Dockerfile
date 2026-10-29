# One container: the API server, which also serves the built web app.
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
# Mount a persistent volume here so the database survives redeploys.
ENV DATA_DIR=/data
WORKDIR /app/server
EXPOSE 8787
CMD ["npm", "start"]
