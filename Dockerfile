# --- Base image ---
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first (better caching)
COPY package.json package-lock.json ./

# Install ALL dependencies (including devDependencies for nodemon)
RUN npm install

# Copy the rest of the source code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose the port (matches PORT in .env)
EXPOSE 3001

# Use start script (node, not nodemon) for production stability
CMD ["npm", "start"]
