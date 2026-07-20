# Forever — one image, two roles (web + BullMQ worker), chosen by the container command.
# Deployed on Alibaba Cloud ECS. All model calls go to Qwen Cloud (DashScope / Model Studio).
FROM node:22-slim AS build
WORKDIR /app

# Install deps against the lockfile for reproducible builds
COPY package.json package-lock.json ./
RUN npm ci

# Build the Next.js app
COPY . .
ENV NODE_ENV=production
# NEXT_TELEMETRY_DISABLED keeps the build offline-friendly
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime image ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# copy the built app + node_modules from the build stage
COPY --from=build /app ./

# The web process listens on 3000; the worker has no port.
EXPOSE 3000

# Default = web. docker-compose overrides the worker service's command.
CMD ["npm", "run", "start"]
