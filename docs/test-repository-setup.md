# Настройка тестового GitHub-репозитория для Blast Furnace

## Что использует проект сейчас

Сейчас проект авторизуется в GitHub через `GITHUB_TOKEN` и работает с репозиторием по HTTPS.

## 1. Создайте тестовый репозиторий

Создайте отдельный репозиторий на GitHub, в котором безопасно тестировать:

- чтение GitHub Issues
- создание веток
- пуш изменений
- создание pull request

## 2. Создайте GitHub token

Проекту нужен token, у которого есть доступ к целевому тестовому репозиторию.

Практически подходят два варианта:

1. Classic Personal Access Token с доступом уровня `repo`
2. Fine-grained Personal Access Token с доступом к конкретному тестовому репозиторию

Для fine-grained token нужны права, достаточные как минимум для:

- чтения issues
- чтения и записи contents
- создания pull requests

Если токен умеет читать issue, пушить в репозиторий и открывать PR, этого достаточно для текущей реализации.

Официальная сводка GitHub по fine-grained permissions:

- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens

## 3. Положите секреты в локальный `.env.local`

В проекте уже есть шаблон: `.env.local.example`

Создайте локальный файл:

```bash
cp .env.local.example .env.local
```

Заполните эти переменные:

```bash
export GITHUB_TOKEN='...'
export GITHUB_OWNER='owner-or-org'
export GITHUB_REPO='test-repo'
export QUALITY_GATE_TEST_COMMAND='npm test'
export QUALITY_GATE_TEST_TIMEOUT_MS='180000'
```

`QUALITY_GATE_TEST_COMMAND` - команда для проверки целевого репозитория. Оркестратор запускает ее из корня клонированного target repository workspace на Stop hook этапа `develop`.

Требования к команде:

- неинтерактивная;
- ориентирована на unit tests;
- возвращает ненулевой exit code при ошибках;
- не требует browser/UI/manual auth;
- не зависит от внешних сервисов без детерминированной подготовки;
- не запускает тесты самого Blast Furnace, если Blast Furnace не является целевым репозиторием.

## 4. Загрузите переменные окружения

```bash
source ./scripts/load-env.sh
```

## 5. Запустите локальную среду

Если хотите поднять Redis и dev-сервер одной командой:

```bash
./scripts/start.sh
```

Этот скрипт:
- загружает `.env.local`, если файл существует
- поднимает Redis через Docker Compose
- запускает `npm run dev`

## 8.  Проверка

1. Заполнить `.env.local`
2. Выполнить `source ./scripts/load-env.sh`
3. Запустить `./scripts/start.sh`
4. Создать issue в тестовом репозитории, или переименовать существующий, повесить на него лейбл `ready`. Причем сначала лучше повесить лейбл, а потом переименовать issue. 
5. Убедиться, что сервер увидел issue
6. Убедиться, что Quality Gate прошел внутри `develop`
7. Проверить, что появилась рабочая ветка и затем pull request, PR приаттачен к issue, issue сменил статус на `in progress`, у issue один лейбл - `in review`
