# --- Base image ---
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first (better caching)
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy the rest of the source code
COPY . .

# Expose your backend port (change if needed)
EXPOSE 8080

# Default command for dev mode
CMD ["npm", "run", "dev"]
