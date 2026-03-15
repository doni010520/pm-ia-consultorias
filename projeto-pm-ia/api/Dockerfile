FROM node:20-alpine

WORKDIR /app

COPY package.json ./

RUN npm install --only=production

COPY . .

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

USER node

CMD ["node", "src/index.js"]
