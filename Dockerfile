# Use Playwright image with browsers preinstalled
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source and build TypeScript
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production

# Run the CLI; pass query/flags as container args
ENTRYPOINT ["node", "/app/dist/cli.js"]

