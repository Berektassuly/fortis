FROM node:20-alpine AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
RUN npm ci


FROM node:20-alpine AS builder
WORKDIR /app

ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/postgres?schema=public"

ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=${DATABASE_URL}

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build


FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN apk add --no-cache libc6-compat openssl \
  && addgroup -S nodejs \
  && adduser -S nextjs -G nodejs

COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs

EXPOSE 3001

CMD ["node", "server.js"]
