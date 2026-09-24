# Бекенд для бронирования авиабилетов (Node.js)

[![hexlet-check](https://github.com/isour/test-program-please-ignore-middle-nodejs-project-430/actions/workflows/hexlet-check.yml/badge.svg)](https://github.com/isour/test-program-please-ignore-middle-nodejs-project-430/actions)
[![CI](https://github.com/isour/test-program-please-ignore-middle-nodejs-project-430/actions/workflows/ci.yml/badge.svg)](https://github.com/isour/test-program-please-ignore-middle-nodejs-project-430/actions/workflows/ci.yml)

Реализуйте бекенд сервиса бронирования авиабилетов: справочник городов, поиск рейсов,
оформление, просмотр и отмену брони. Код на TypeScript, данные храните в PostgreSQL,
фреймворк выбираете сами.
Фронтенд предоставляет Хекслет — готовое приложение, которое подключается к вашему API
и работает только тогда, когда API отвечает по описанному контракту.

Учебный проект Хекслета: https://ru.hexlet.io/programs/test-program-please-ignore-middle-nodejs
Как это должно работать: https://files.hexlet.app/a/5bi6gu

## Стек

- TypeScript (исполняется Node.js 22.18+ напрямую, без шага сборки)
- Node.js 22.18+
- [Fastify](https://fastify.dev/) + [@fastify/static](https://fastify.dev/#Reference/@fastify/static) (раздача собранного фронтенда)
- [Drizzle ORM](https://orm.drizzle.team/) + драйвер `postgres`
- PostgreSQL (локально поднимается через Docker Compose)
- Готовый фронтенд — npm-пакет `@hexlet/js-flight-booking-frontend`

## Установка

Требуется Node.js 22.18 или новее (`node -v`), GNU Make и Docker для локальной БД.

```bash
git clone https://github.com/isour/test-program-please-ignore-middle-nodejs-project-430.git
cd test-program-please-ignore-middle-nodejs-project-430
make install   # npm ci
```

Подготовка базы данных:

```bash
# 1. Поднять локальный PostgreSQL в Docker
docker compose up -d

# 2. Убедиться, что контейнер поднялся и здоров
docker compose ps

# 3. Создать .env из примера
cp .env.example .env
```

`DATABASE_URL` из `.env.example` совпадает с настройками `docker-compose.yml`
и меняйте их только парой.

## Использование

```bash
# Собрать статику фронтенда в public/ (без БД — сборка миграций в build не входит)
make build

# Запуск (для проверки и на Render запускается именно эта цель)
make start

# Разработка: перезапуск при изменении файлов
npm run dev

# Проверка типов
make lint

# Тесты (Vitest)
make test
```

Тесты — на [Vitest](https://vitest.dev/): бьют по приложению целиком через `app.inject`,
БД и свободные порты им не нужны (`npx vitest run` — эквивалент). Каждый push проверяется
в GitHub Actions (`.github/workflows/ci.yml`): `npm ci` → `make build` → `make lint` → `make test`;
статус — бейдж CI в начале README.

Сервер слушает `0.0.0.0` и отдаёт фронтенд и API на одном порту — CORS не нужен,
фронтенд обращается к `/api/...` по относительным путям с того же адреса.

Порт по умолчанию — **8080**. Приоритет: `PORT` из окружения
(например `PORT=3000 make start` или переменная на Render) > `PORT` из `.env` > `8080` в коде.
Цель `make start` всегда передаёт `PORT` в окружение, поэтому значение `PORT` из `.env`
при запуске через `make start` не применяется — используйте окружение.

```bash
# http://localhost:8080 — главная (поиск), /booking/<id>, /lookup (SPA, прямые ссылки работают)
curl http://localhost:8080/api/cities
# []

curl http://localhost:8080/api/health
# {"status":"ok"}
```

---

<details>
<summary>Автоматические тесты Хекслета</summary>

Тесты запускаются на каждый коммит. За запуск отвечает файл `.github/workflows/hexlet-check.yml` — не удаляйте и не переименовывайте ни его, ни репозиторий.

</details>

## О Хекслете

[Хекслет](https://ru.hexlet.io/) — школа программирования: авторские программы обучения с практикой, поддержкой наставников и реальными проектами, которые попадают в резюме. Этот репозиторий — один из таких проектов.
