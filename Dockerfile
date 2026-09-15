FROM node:24.15.0

# install cargo and rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustc --version && cargo --version

# install iputils-ping
RUN apt-get update && \
    apt-get install -y iputils-ping && \
    rm -rf /var/lib/apt/lists/*

# set workspace
WORKDIR /scan

# install dependencies
COPY package*.json ./
COPY vendor/inspector-metrics-1.23.0-node24.tgz ./vendor/inspector-metrics-1.23.0-node24.tgz
RUN npm install

# compile
COPY . .
RUN npm run compile

CMD ["node"]
