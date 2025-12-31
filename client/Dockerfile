FROM node:22-slim AS build
WORKDIR /app
ENV HUSKY=0
ARG VITE_API_URL
ARG VITE_LMSTUDIO_URL
ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_LMSTUDIO_URL=${VITE_LMSTUDIO_URL}
COPY package*.json ./
COPY package-lock.json ./
COPY common/package*.json ./common/
COPY client/package*.json ./client/
COPY tsconfig*.json ./
COPY tsconfig.base.json ./
COPY common ./common
COPY client ./client
RUN npm ci --workspaces --include-workspace-root --ignore-scripts --no-audit --no-fund
RUN npm run build --workspace client

FROM node:22-slim AS runtime
WORKDIR /app/client
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/common /app/common
COPY --from=build /app/client/dist ./dist
COPY --from=build /app/client/vite.config.ts ./vite.config.ts
COPY --from=build /app/client/package*.json ./
ENV PORT=5001
EXPOSE 5001
CMD ["npm", "run", "preview", "--", "--host", "--port", "5001"]
