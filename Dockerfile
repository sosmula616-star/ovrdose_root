# Базовый образ Node.js 20 на базе Debian Bookworm Slim
FROM node:20-bookworm-slim

# Установка системных утилит компиляции для сборки C++ модуля better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Рабочая директория приложения
WORKDIR /app

# Копируем манифесты зависимостей monorepo
COPY package*.json ./
COPY packages/ packages/
COPY apps/ apps/
COPY scripts/ scripts/
COPY ecosystem.config.js ./
COPY index.js ./

# Установка зависимостей всех workspaces
RUN npm install

# Создание директории данных для базы SQLite
RUN mkdir -p /app/data /app/data/backups /app/data/logs

# Открываем порт 3000 для веб-панели управления
EXPOSE 3000

# Переменные среды по умолчанию
ENV NODE_ENV=production
ENV PANEL_HOST=0.0.0.0
ENV PANEL_PORT=3000

# Запуск единого процесса Root-Core (БД + Бот + Панель)
CMD ["npm", "start"]
