FROM node:18-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    git cmake build-essential \
    pkg-config \
    libssl-dev zlib1g-dev \
    libzip-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/zhlynn/zsign.git /zsign && \
    cd /zsign/build/linux && \
    make && \
    cp zsign /usr/local/bin/ && \
    chmod +x /usr/local/bin/zsign

WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
RUN mkdir -p uploads/ipa uploads/certs uploads/signed uploads/plists

EXPOSE 3000
CMD ["node", "server.js"]
