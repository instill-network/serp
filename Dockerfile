# Multi-arch Playwright base with browsers pre-installed
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Default runtime env (can be overridden)
ENV NODE_ENV=production

# CLI entry
ENTRYPOINT ["node", "/app/dist/cli.js"]