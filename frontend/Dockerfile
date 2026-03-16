# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --legacy-peer-deps

COPY . .

ARG VITE_API_URL
ARG VITE_DEFAULT_ORG_ID

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_DEFAULT_ORG_ID=$VITE_DEFAULT_ORG_ID

RUN npm run build

# Stage 2: Nginx
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
