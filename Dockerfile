# ─── ÉTAPE 1 : Build zsign ───────────────────────────────────────────────────
FROM ubuntu:22.04 AS zsign-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    git \
    cmake \
    build-essential \
    libssl-dev \
    libminizip-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/zhlynn/zsign.git /zsign
WORKDIR /zsign/build/linux
RUN make

# ─── ÉTAPE 2 : Serveur Node.js ───────────────────────────────────────────────
FROM node:18-slim

ENV DEBIAN_FRONTEND=noninteractive

# Installer les dépendances système pour zsign
RUN apt-get update && apt-get install -y \
    libssl3 \
    libminizip1 \
    && rm -rf /var/lib/apt/lists/*

# Copier zsign compilé
COPY --from=zsign-builder /zsign/build/linux/zsign /usr/local/bin/zsign
RUN chmod +x /usr/local/bin/zsign

# Dossier de l'app
WORKDIR /app

# Installer les dépendances Node
COPY package.json ./
RUN npm install --production

# Copier le serveur
COPY server.js ./

# Créer les dossiers de stockage
RUN mkdir -p uploads/ipa uploads/certs uploads/signed uploads/plists ssl

# Port exposé (Railway utilise la variable PORT automatiquement)
EXPOSE 3000

# Démarrer le serveur
CMD ["node", "server.js"]
