FROM node:20-bookworm-slim

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

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN useradd -m -u 1000 -s /bin/bash aionui \
    && chown -R aionui:aionui /app /home/aionui

USER aionui

EXPOSE 25808

CMD ["npm", "run", "webui:prod"]
