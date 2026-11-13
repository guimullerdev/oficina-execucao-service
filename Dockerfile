### deps stage: install production-only dependencies (cached separately from build)
FROM node:24.13.1-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

COPY package.json yarn.lock ./

# --ignore-scripts: nenhum script de ciclo de vida de dependência roda no install.
RUN yarn install --frozen-lockfile --production --ignore-scripts

### builder stage: install all deps (incl. dev) and compile TypeScript
FROM node:24.13.1-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile --ignore-scripts

COPY . .

RUN yarn build

### runtime stage: lean image with only dist + production node_modules
FROM node:24.13.1-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache dos2unix

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

COPY entrypoint.sh /entrypoint.sh
RUN dos2unix /entrypoint.sh && chmod +x /entrypoint.sh

USER node

EXPOSE 3000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/main"]
