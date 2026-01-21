FROM node:22-bookworm-slim

ENV NPM_CONFIG_LOGLEVEL=warn \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      python3 \
      make \
      g++ \
      libgtk-3-0 \
      libnss3 \
      libasound2 \
      libgbm1 \
      libxshmfence1 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxrandr2 \
      libatk1.0-0 \
      libcups2 \
      libxkbcommon0 \
      libxfixes3 \
      libdrm2 \
      libxext6 \
      libxrender1 \
      libx11-6 \
      libxcb1 \
      libxss1 \
      libxtst6 \
      libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN if ! getent passwd 1000 >/dev/null; then \
      useradd -m -u 1000 -s /bin/bash aionui; \
    fi \
    && mkdir -p /app /home/aionui \
    && chown 1000:1000 /app /home/aionui

WORKDIR /app

USER 1000

COPY --chown=1000:1000 package.json package-lock.json ./
COPY --chown=1000:1000 scripts ./scripts
RUN npm ci

USER root
RUN if [ -f /app/node_modules/electron/dist/chrome-sandbox ]; then \
      chown root:root /app/node_modules/electron/dist/chrome-sandbox; \
      chmod 4755 /app/node_modules/electron/dist/chrome-sandbox; \
    fi

USER 1000
COPY --chown=1000:1000 . .

EXPOSE 25808

CMD ["npm", "run", "webui:prod"]
