FROM node:26-slim

# make нужен, потому что образ запускается через `make start` — той же командой, что локально
RUN apt-get update \
    && apt-get install -y --no-install-recommends make \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Сначала манифесты и установка, потом исходники: правка кода не переустанавливает зависимости.
# --prod: тестовые раннеры, линтер и генератор миграций в проде не нужны. Поэтому миграции
# применяет само приложение, а не команда drizzle-kit — её в образе нет.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Статика фронтенда раскладывается на сборке: цель build по контракту к базе не обращается
RUN make build

CMD ["make", "start"]
