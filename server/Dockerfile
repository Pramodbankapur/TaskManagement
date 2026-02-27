FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=base /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=base /app/dist ./dist
COPY --from=base /app/uploads ./uploads
COPY --from=base /app/data ./data
COPY --from=base /app/.env.example ./.env.example
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/index.js"]
