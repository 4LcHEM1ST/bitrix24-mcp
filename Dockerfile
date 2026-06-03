FROM node:20-slim

WORKDIR /app

# Dependencias primero (mejor cache). Sin devDependencies en producción.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Código de la aplicación.
COPY index.js ./
COPY src ./src

# El proceso corre como usuario no privilegiado.
RUN useradd --create-home --uid 10001 appuser
USER appuser

# En el contenedor escuchamos en todas las interfaces; hacia afuera NO se publica:
# -p 127.0.0.1:8001:8001 limita el acceso solo al nginx local.
ENV B24_TRANSPORT=http \
    B24_HOST=0.0.0.0 \
    B24_PORT=8001

EXPOSE 8001

CMD ["node", "index.js"]
