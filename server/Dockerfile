FROM node:22-slim AS deps
WORKDIR /app
ENV HUSKY=0
COPY package*.json ./
COPY package-lock.json ./
COPY common/package*.json ./common/
COPY server/package*.json ./server/
COPY tsconfig*.json ./
COPY tsconfig.base.json ./
COPY common ./common
COPY server ./server
RUN npm ci --workspaces --include-workspace-root --ignore-scripts && npm install --workspaces --include-workspace-root --ignore-scripts --prefer-offline

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app .
RUN npm run build --workspace server

FROM node:22-slim AS runtime
WORKDIR /app/server
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/common /app/common
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package*.json ./
ENV PORT=5010
EXPOSE 5010
CMD ["node", "dist/index.js"]
