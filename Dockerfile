FROM node:22-slim

# Install system dependencies including dos2unix for line ending conversion
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    libvips-dev \
    git \
    dos2unix \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV HUSKY=0
ENV DOCKER_OUTPUT=1
ENV SHARP_IGNORE_GLOBAL_LIBVIPS=1
ENV SHARP_FORCE_GLOBAL_LIBVIPS=1

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY turbo.json ./
COPY lingui.config.ts ./

# Copy source code
COPY apps ./apps
COPY packages ./packages

# Fix line endings for all shell scripts
RUN find . -name "*.sh" -type f -exec dos2unix {} \;

# Install dependencies with longer timeout for sharp
RUN npm install --fetch-timeout=60000 --fetch-retries=3

# Install turbo globally
RUN npm install -g turbo@^1.9.3

# Build the application
RUN npx turbo run build

# Create directory for certificates
RUN mkdir -p /app/certs

# Copy start script and fix line endings
COPY docker/start.sh ./start.sh
RUN dos2unix ./start.sh && chmod +x ./start.sh

# Expose port
EXPOSE 3000

# Start the application
CMD ["./start.sh"]
