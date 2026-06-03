FROM node:20-slim

WORKDIR /app

# Dependencies first (better cache). No devDependencies in production.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Application code.
COPY index.js ./
COPY src ./src

# The process runs as a non-privileged user.
RUN useradd --create-home --uid 10001 appuser
USER appuser

# Inside the container we listen on all interfaces; it is NOT published outward:
# -p 127.0.0.1:8001:8001 limits access to the local nginx only.
ENV B24_TRANSPORT=http \
    B24_HOST=0.0.0.0 \
    B24_PORT=8001

EXPOSE 8001

CMD ["node", "index.js"]
