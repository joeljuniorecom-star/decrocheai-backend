FROM node:20-alpine

WORKDIR /app

# Copie des fichiers de dépendances en premier pour profiter du cache Docker
COPY package*.json ./
RUN npm ci --omit=dev

# Copie du reste du code source
COPY . .

# Railway injecte PORT automatiquement
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
