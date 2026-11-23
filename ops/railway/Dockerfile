FROM node:24-bookworm-slim
WORKDIR /app
COPY . .
RUN WORKERS_CI=1 npm ci --include=dev --no-audit --no-fund
CMD ["node", "ops/railway/start.mjs"]
