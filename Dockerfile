# Use Playwright image with browsers preinstalled
FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app

# Install packages to support headful mode via VNC
USER root
ARG DEBIAN_FRONTEND=noninteractive
ENV TZ=America/New_York
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    tzdata \
    fonts-noto \
    fonts-noto-color-emoji \
    fonts-liberation \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

# Default settings for optional headful VNC session
ENV HEADFUL=0 \
    DISPLAY=:99 \
    SCREEN_WIDTH=1920 \
    SCREEN_HEIGHT=1080 \
    SCREEN_DEPTH=24 \
    VNC_PORT=5900 \
    VNC_PASSWORD=

# Copy entrypoint wrapper that toggles headful/VNC
COPY bin/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 5900

RUN mkdir -p /app && chown -R pwuser:pwuser /app
USER pwuser

# Install dependencies
COPY --chown=pwuser:pwuser package*.json ./
RUN npm install

# Copy source and build TypeScript
COPY --chown=pwuser:pwuser tsconfig.json ./
COPY --chown=pwuser:pwuser src ./src
RUN npm run build

ENV NODE_ENV=production

# Run the CLI; pass query/flags as container args
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
