# FFmpeg + a caption font must exist in the runtime — that's the whole reason this
# render lives here and not in a Vercel serverless function. node:20-slim + apt is the
# most reliable way to guarantee both on Railway.
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
# Railway injects PORT; the server falls back to 8080 locally.
EXPOSE 8080

CMD ["node", "src/server.js"]
