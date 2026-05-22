# Use the official Puppeteer image which includes Node.js and Google Chrome
FROM ghcr.io/puppeteer/puppeteer:22.0.0

# Set environment variables
ENV NODE_ENV=production
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Create app directory inside the image
WORKDIR /usr/src/app

# The puppeteer image runs as user 'pptruser', we need root to copy files, 
# then we switch to pptruser for security.
USER root

# Copy package.json and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy the rest of the application files
COPY . .

# Change ownership of all files to pptruser
RUN chown -R pptruser:pptruser /usr/src/app

# Switch to the non-root user
USER pptruser

# Expose the port (Render provides PORT environment variable)
EXPOSE 3000

# Start the Node.js server
CMD ["node", "server.js"]
