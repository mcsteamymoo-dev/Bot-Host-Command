FROM node:24-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy everything
COPY . .

# Install all monorepo deps
RUN pnpm install --frozen-lockfile

# Build just the api-server
RUN pnpm run --filter './artifacts/api-server' build

# Copy the built dist folder
RUN mkdir -p /app/final && cp -r /app/artifacts/api-server/dist /app/final/

WORKDIR /app/final

EXPOSE 3000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
