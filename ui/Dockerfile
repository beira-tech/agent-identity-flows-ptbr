FROM node:20-alpine AS builder
WORKDIR /app

ARG VITE_STS_URL=http://localhost:8001
ARG VITE_DOWNSTREAM_URL=http://localhost:8002
ENV VITE_STS_URL=$VITE_STS_URL
ENV VITE_DOWNSTREAM_URL=$VITE_DOWNSTREAM_URL

COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
