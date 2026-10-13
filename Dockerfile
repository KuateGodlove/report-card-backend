FROM node:22-bookworm-slim

# Chromium is used by Puppeteer to produce report-card PDFs.
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate

ENV NODE_ENV=production
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 5000
CMD ["sh", "-c", "npx prisma migrate deploy && node prisma/seed.js && npm start"]
