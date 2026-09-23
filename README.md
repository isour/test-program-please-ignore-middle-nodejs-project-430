# Бекенд для бронирования авиабилетов (Node.js)

[![hexlet-check](https://github.com/isour/test-program-please-ignore-middle-nodejs-project-430/actions/workflows/hexlet-check.yml/badge.svg)](https://github.com/isour/test-program-please-ignore-middle-nodejs-project-430/actions)

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
- [Fastify](https://fastify.dev/)
- [Drizzle ORM](https://orm.drizzle.team/) + драйвер `postgres`
- PostgreSQL (локально поднимается через Docker Compose)

## Установка

Требуется Node.js 22.18 или новее (`node -v`) и Docker для локальной БД.

```bash
git clone https://github.com/isour/test-program-please-ignore-middle-nodejs-project-430.git
cd test-program-please-ignore-middle-nodejs-project-430
npm install
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
# Разработка: перезапуск при изменении файлов
npm run dev

# Обычный запуск
npm start
```

Сервер слушает `PORT` из окружения (по умолчанию `3000`; переопределите в `.env`
или переменной окружения, например `PORT=4000 npm start`): http://localhost:3000

Проверка живости API:

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}

# Проверка типов без сборки
npm run check
```

---

<details>
<summary>Автоматические тесты Хекслета</summary>

Тесты запускаются на каждый коммит. За запуск отвечает файл `.github/workflows/hexlet-check.yml` — не удаляйте и не переименовывайте ни его, ни репозиторий.

</details>

## О Хекслете

[Хекслет](https://ru.hexlet.io/) — школа программирования: авторские программы обучения с практикой, поддержкой наставников и реальными проектами, которые остаются в резюме. Этот репозиторий — один из таких проектов.
