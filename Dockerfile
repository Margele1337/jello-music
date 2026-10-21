# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package*.json ./
# Remove electron and electron-builder from package.json
RUN node -e "const fs = require('fs'); const filePath = './package.json'; \
             let rawdata = fs.readFileSync(filePath); let packageJson = JSON.parse(rawdata); \
             if (packageJson.devDependencies) { \
               delete packageJson.devDependencies.electron; \
               delete packageJson.devDependencies['electron-builder']; \
             } \
             if (packageJson.dependencies) { \
               delete packageJson.dependencies.electron; \
             } \
             fs.writeFileSync(filePath, JSON.stringify(packageJson, null, 2));"
# postinstall 会执行 tools/patch-api.cjs，必须在 npm install 之前拷入（api 子模块不在则脚本自动跳过）
COPY tools ./tools
RUN npm install
COPY . .
RUN npm run build:docker

# Stage 2: Setup Combined App
FROM node:20-alpine
WORKDIR /app

# Install Nginx
RUN apk add --no-cache nginx

# Copy API code
COPY ./api ./api
# api 是 git 子模块（见 .gitmodules）：干净 clone 后是空目录，后面 npm install / node app.js
# 全部会以含糊的方式失败。这里提前给出明确报错。
WORKDIR /app/api
RUN if [ ! -f package.json ]; then \
      echo "ERROR: api 子模块未初始化。请先执行: git submodule update --init --recursive"; \
      exit 1; \
    fi
# Install API dependencies
RUN npm install --production
# Reset WORKDIR to /app
WORKDIR /app 

# Copy built frontend static assets from the builder stage
COPY --from=frontend-builder /app/dist/ ./dist/

# Expose ports
# For frontend served by 'serve'
EXPOSE 8080 
# For API
EXPOSE 6521 

# Copy Nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Command to run both services
# API runs from /app/api directory, frontend served by Nginx
# CMD ["sh", "-c", "cd /app/api && node app.js & nginx -g 'daemon off;'"]
CMD sh -c "\
  echo 'client running @ http://127.0.0.1:8080/'; \
  cd /app/api && node app.js & nginx -g 'daemon off;'"
