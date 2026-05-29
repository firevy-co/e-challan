# Use the official Puppeteer image which includes Node.js and Google Chrome
FROM ghcr.io/puppeteer/puppeteer:25.1.0

# Set environment variables
ENV NODE_ENV=production
# Do NOT set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD - let Puppeteer download Chrome if needed
# The Docker image already has Chrome, but this is a safety net
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

# Verify Chrome is available (fail build early if not)
RUN echo "Checking Chrome..." && \
    (test -f /usr/bin/google-chrome-stable && echo "Chrome found at /usr/bin/google-chrome-stable") || \
    (test -f /usr/bin/google-chrome && echo "Chrome found at /usr/bin/google-chrome") || \
    (test -f /usr/bin/chromium && echo "Chrome found at /usr/bin/chromium") || \
    (echo "WARNING: No system Chrome found, Puppeteer bundled Chrome will be used")

# Change ownership of all files to pptruser
RUN chown -R pptruser:pptruser /usr/src/app

# Switch to the non-root user
USER pptruser

# Expose the port (Render provides PORT environment variable)
EXPOSE 3000

# Start the Node.js server
CMD ["node", "server.js"]
