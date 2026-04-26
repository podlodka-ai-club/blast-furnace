# План: Приведение Оркестратора к Target State

## Зачем нужен этот план

Цель этой итерации — убрать архитектурную двусмысленность и привести оркестратор к более стабильной модели исполнения:

- один способ intake из GitHub;
- понятный и доменно названный workflow;
- единый `runId` как сквозной идентификатор прогона;
- handoff между этапами через файловые артефакты;
- `run`-scoped статус и логирование;
- явная модель `clarify / rework`.

Этот план рассчитан на реализацию в несколько MR, но с одной общей архитектурной целью.

## Текущее состояние

Сейчас фактический pipeline в коде выглядит так:

`issue-watcher -> issue-processor -> plan -> codex-provider -> review -> make-pr -> check-pr`

Ключевые особенности текущего состояния:

- intake работает через polling: repeatable `issue-watcher` job ищет подходящие issue;
- `issue-processor` подготавливает ветку;
- `codex-provider` одновременно готовит локальный workspace и запускает Codex;
- `plan` и `review` сейчас фактически passthrough-заглушки;
- `check-pr` сейчас является terminal cleanup-шагом;
- handoff между этапами идет в основном через payload очереди;
- инфраструктура для `.orchestrator/runs/<runId>/` уже есть, но еще не встроена как основной state/handoff механизм.

## Целевой workflow

Для этой итерации фиксируем такой workflow:

`Intake -> Prepare Run -> Assess -> Plan -> Develop -> Quality Gate -> Review -> Make PR -> Sync Tracker State`

### Mapping текущих шагов на целевые

- `issue-watcher` остается технической реализацией этапа `Intake`
- `issue-processor` переименовывается в `Prepare Run`
- `plan` остается `Plan`, но перестает быть просто passthrough
- `codex-provider` переименовывается в `Develop`
- `review` остается `Review`, но получает нормальное место в pipeline
- `make-pr` остается `Make PR`
- `check-pr` заменяется на `Sync Tracker State`
- добавляются новые этапы-заглушки:
  - `Assess`
  - `Quality Gate`

### Принцип по доступу к репозиторию

`Prepare Run` остается до `Assess` и `Plan`, потому что и `Assess`, и `Plan` должны иметь доступ к репозиторию.

Это означает:

- repo/workspace prep не выносится целиком в отдельный шаг перед `Develop`;
- основная подготовка репозитория выполняется один раз на уровне `run`;
- если позже понадобится отдельная изоляция executor attempt для `Develop`, это можно будет добавить отдельным stage-attempt-scoped шагом, но не в этой итерации.

## Общие архитектурные решения для этой итерации

### 1. Один intake path

У системы должен остаться только один способ intake: polling.

### 2. `Prepare Run` — это run-scoped этап

`Prepare Run` отвечает не только за ветку, но и за создание общего контекста прогона:

- `runId`;
- начальный `run.json`;
- рабочая директория / workspace;
- branch preparation;
- базовые артефакты, нужные `Assess`, `Plan` и `Develop`.

### 3. Очередь остается, но перестает быть основным handoff-каналом

BullMQ остается транспортом, retry-механизмом и orchestration layer, но не главным носителем бизнес-state между этапами.

### 4. Нужно развести виды попыток

Слово `attempt` должно быть формализовано.

- `bullmqRetry`: инфраструктурный retry BullMQ;
- `stageAttempt`: попытка исполнения конкретного этапа;
- `reworkAttempt`: бизнес-попытка повторной реализации после неуспешного результата.

### 5. Все межэтапные контракты должны быть формализованы

Недостаточно просто записывать JSON-файлы. Для каждого этапа нужен:

- явный input artifact;
- явный output artifact;
- схема;
- детерминированная валидация перед переходом к следующему шагу.

## 1. Оставить один способ интейки с GitHub

### Что входит в работу

- зафиксировать polling как единственный поддерживаемый intake path;
- обновить документацию, OpenSpec, конфиг и тесты под новую модель.

### Что именно нужно поменять

- оставить в runtime только polling intake через repeatable `issue-watcher` job
- в архитектуре и документации шаг называть просто `Intake`, без разделения на webhook/polling

### Почему это важно

Пока существуют два intake path, сохраняется ambiguity:

- разные входные условия;
- разные правила intake;
- разные тестовые сценарии;
- больше точек отказа и больше работы по синхронизации контрактов.

Для целевого оркестратора в этой итерации это лишняя сложность.

### Результат

После выполнения этого пункта:

- система принимает задачи только через polling;
- документация больше не обещает webhook-режим;
- все новые pipeline-изменения реализуются поверх одного intake path.

### Критерии готовности

- основной runtime не использует webhook flow;
- OpenSpec и документация описывают только polling;
- intake-тесты переписаны под один путь;
- старт приложения не зависит от выбора стратегии intake.

## 2. Привести workflow к target state, вернуть и расширить `Prepare Run`, переименовать этапы и расширить queue payload

### Что входит в работу

- переименовать этапы и worker routing под целевой workflow;
- добавить новые этапы-заглушки;
- перераспределить ответственность между `Prepare Run` и `Develop`;
- добавить в queue payload минимально необходимые сквозные идентификаторы и счетчики попыток.

### Новые/обновленные этапы

#### `Intake`

Отвечает только за обнаружение подходящих issue и enqueue следующего шага.

#### `Prepare Run`

Это ключевой инфраструктурный этап начала прогона.

Он должен делать:

- создать `runId`;
- создать начальный `run.json`;
- завести run-level log file;
- построить и провалидировать `branchName`;
- создать или переиспользовать issue branch;
- создать / подготовить локальный workspace;
- clone репозитория;
- fetch / checkout / reset ветки;
- записать базовый artifact контекста, который потом используют `Assess`, `Plan` и `Develop`.

Важно: именно сюда возвращается repo access prep, потому что `Assess` и `Plan` тоже должны работать с реальным репозиторием.

#### `Assess`

Пока может быть заглушкой, но должен существовать как отдельный этап workflow.

На этой итерации важно:

- добавить stage в routing;
- зафиксировать входной и выходной artifact;
- оставить stub-логику, если содержательная оценка еще не реализуется.

#### `Plan`

Пока может оставаться упрощенным, но должен:

- работать после `Assess`;
- читать входной artifact;
- писать собственный output artifact;
- иметь место для будущего GitHub comment side effect.

#### `Develop`

`Develop` должен быть сужен до собственно запуска executor.

На этой итерации сюда входит:

- чтение подготовленного контекста и plan artifact;
- запуск Codex;
- запись результата в output artifact;
- отсутствие ответственности за branch prep и workspace prep.

#### `Quality Gate`

Пока может быть заглушкой, но должен существовать как отдельный этап.

Даже при stub-логике у него должен быть свой artifact contract.

#### `Review`

Пока может оставаться stub, но должен читаться и писаться как нормальный этап, а не как passthrough без собственного handoff.

#### `Make PR`

Оставляем как есть по доменной ответственности:

- commit;
- push;
- create PR.

Но его вход должен прийти уже через artifact-based handoff, а не через business-rich queue payload.

#### `Sync Tracker State`

Заменяет текущий `check-pr`.

Отвечает за внешние tracker-side effects после успешного PR path:

- перевод карточки / лейблов / статуса;
- terminal tracker synchronization;
- при необходимости terminal cleanup, если это остается его responsibility.

### Переходный queue payload

На этой итерации в payload очереди добавляем минимум:

- `runId`
- `stage`
- `stageAttempt`
- `reworkAttempt`

На переходный период в payload еще могут временно остаться отдельные служебные поля, но цель — сделать payload максимально тонким.

### Формализация попыток

Нужно зафиксировать их назначение в коде и типах:

- `bullmqRetry` не входит в доменный контракт handoff и остается внутренней механикой BullMQ;
- `stageAttempt` используется для artifact path и состояния этапа;
- `reworkAttempt` используется для бизнес-цикла переделки.

### Результат

После выполнения этого пункта:

- в коде и документации используются одинаковые имена этапов;
- `Prepare Run` становится полным этапом подготовки run и repo context;
- `Develop` становится узким executor step;
- pipeline structurally соответствует target workflow;
- очередь несет сквозную идентичность прогона и попыток.

### Критерии готовности

- worker routing соответствует target workflow;
- `Prepare Run`, `Assess`, `Plan`, `Develop`, `Quality Gate`, `Review`, `Make PR`, `Sync Tracker State` существуют как отдельные job types;
- в queue payload есть `runId`, `stage`, `stageAttempt`, `reworkAttempt`;
- `Develop` больше не отвечает за clone/checkout ветки;
- документация и OpenSpec обновлены под новые имена и обязанности этапов.

## 3. Перевести handoff в файлы, ввести формализованные output-контракты и schema validation

### Что входит в работу

- сделать файловые артефакты основным межэтапным handoff-механизмом;
- формализовать output каждого этапа;
- ввести схемы и детерминированную validation перед переходом дальше;
- перевести queue payload в служебный транспортный слой.

### Базовая структура run

Минимальная целевая структура:

```text
.orchestrator/
  runs/
    <runId>/
      run.json
      events/
      logs/
      stages/
        <stage>/
          attempt-<n>/
            artifacts/
```

### Что должно стать source of truth

Source of truth между этапами:

- не payload очереди;
- не in-memory state;
- а artifact files внутри `.orchestrator/runs/<runId>/`.

### Что нужно формализовать

Для каждого этапа нужно определить:

- какой artifact он читает;
- какой artifact он пишет;
- какие поля обязательны;
- как выглядит success output;
- как выглядит failure / blocked / clarify / rework-needed output;
- как валидируется схема.

### Что особенно важно на этой итерации

Даже если `Assess`, `Plan`, `Quality Gate`, `Review` пока заглушки, их outputs все равно нужно формализовать сейчас.

То есть уже в этой итерации должны появиться:

- формализованный output `Assess`;
- формализованный output `Plan`;
- формализованный output `Develop`;
- формализованный output `Quality Gate`;
- формализованный output `Review`;
- формализованный output `Make PR`;
- формализованный output `Sync Tracker State`.

### Роль `run.json`

`run.json` остается mutable status file уровня прогона.

В нем должно быть видно:

- `runId`
- текущий stage
- статус run
- статусы stage attempts
- счетчики `stageAttempt` и `reworkAttempt`
- ссылки на актуальные artifacts / summary pointers

### Целевой минимальный queue payload после миграции

После перевода handoff в файлы queue payload должен содержать только:

- `runId`
- `stage`
- `stageAttempt`
- `reworkAttempt`
- `inputArtifactRefs`

Если этапу нужны данные вроде `issue`, `branchName`, `repoPath`, они должны читаться из artifacts/run-state, а не передаваться как основной handoff через очередь.

### Результат

После выполнения этого пункта:

- каждый этап стартует от файлового контракта;
- handoff становится проверяемым и детерминированным;
- outputs всех этапов формализованы;
- очередь больше не является главным носителем межэтапного state.

### Критерии готовности

- для каждого этапа определены input/output artifacts;
- для каждого output есть схема;
- перед переходом к следующему этапу выполняется validation;
- `run.json` отражает реальное состояние прогона;
- очередь несет только transport metadata.

## 2.1. Отложенные задачи после `align-workflow-target-state`

Эти пункты найдены при verification изменения `align-workflow-target-state`, но не входят в текущую правку. Их нужно сделать отдельными изменениями.

### Critical: зафиксировать single-repo режим

Текущая реализация частично поддерживает registry нескольких репозиториев: `Intake` может читать `github:repos` и передавать `repository` дальше по payload. При этом downstream GitHub/git операции исторически ориентированы на `GITHUB_OWNER` и `GITHUB_REPO`.

Целевое решение для ближайшей версии: не поддерживать multi-repo workflow. Оркестратор должен работать с одним репозиторием, заданным в environment:

- `GITHUB_OWNER`;
- `GITHUB_REPO`;
- `GITHUB_TOKEN`.

Что нужно сделать отдельно:

- убрать или отключить чтение `github:repos` из production-path intake;
- оставить polling только configured repository из environment;
- убрать неоднозначность между `job.data.repository` и `config.github`;
- проверить, что branch preparation, clone, pull request creation и label transition работают только с configured repository;
- обновить API/UI/docs, если repository registry больше не является частью целевого поведения.

Критерий готовности: в runtime больше нет сценария, где issue найден в одном репозитории, а branch/clone/PR/label операции выполняются в другом.

### Warning: определить cleanup после terminal failures

После успешного handoff из `Prepare Run` workspace может дожить до `Develop` или `Make PR`. Сейчас ошибки в `Develop` и в части failure path `Make PR` пробрасываются дальше без terminal cleanup. Это может быть допустимо, если workspace нужен для диагностики после исчерпания BullMQ retries, но такое поведение должно быть явно описано.

Что нужно сделать отдельно:

- определить, когда workspace удаляется при ошибках после `Prepare Run`;
- решить, сохраняется ли workspace до исчерпания BullMQ retries;
- добавить явный cleanup/failure policy для `Develop`, `Make PR` и `Sync Tracker State`;
- покрыть policy тестами;
- обновить OpenSpec, чтобы cleanup contract совпадал с реальным поведением.

Критерий готовности: для каждого terminal failure path понятно, удаляется workspace или сохраняется для диагностики, и это поведение закреплено тестами.

## 4. Сделать run-scoped структурированные логи в JSONL с привязкой к `runId`

### Что входит в работу

- добавить file sink для run-level логов;
- писать отдельный JSONL-файл на каждый `runId`;
- связать logging, artifacts и stage transitions в одну наблюдаемую историю.

### Что именно нужно логировать

Минимальный набор событий:

- start/finish/fail этапа;
- enqueue/dequeue job;
- artifact read;
- artifact write;
- validation success/failure;
- GitHub side effect;
- переход в `clarify-needed`;
- переход в `rework-needed`;
- окончание run.

### Минимальный формат записи

Каждая запись должна содержать:

- `timestamp`
- `runId`
- `stage`
- `stageAttempt`
- `reworkAttempt`
- `jobId`
- `level`
- `eventType`
- `message`
- `context`

### Связь с текущим logger

Текущие console JSON logs можно сохранить.

Нужно добавить:

- обязательную привязку к `runId`;
- запись той же событийной модели в `.orchestrator/runs/<runId>/logs/*.jsonl` или в один run-level файл.

### Результат

После выполнения этого пункта любой прогон можно разбирать как последовательность событий по одному `runId`.

### Критерии готовности

- у каждого run есть JSONL-лог;
- в каждой записи присутствует `runId`;
- по логу можно восстановить весь путь pipeline;
- лог синхронизирован с `run.json` и artifact events.

## 5. Добавить GitHub-visible side effects

### Что входит в работу

- сделать внешне видимые действия частью workflow, а не случайными побочными эффектами;
- явно зафиксировать, какие шаги взаимодействуют с GitHub и зачем.

### Что нужно добавить

- комментарий с планом после `Plan`;
- комментарий о старте rework;
- перевод issue / карточки / статуса на этапе `Sync Tracker State`;
- фиксация того, когда и кем публикуются внешние сообщения.

### Почему это нужно вынести отдельно

GitHub-visible side effects важны не только как UI-удобство, но и как часть пользовательского контракта системы.

Снаружи должно быть видно:

- что задача была принята;
- что по ней был построен план;
- что начался rework, если он начался;
- что результат ушел в review / нужный статус.

### Результат

После выполнения этого пункта оркестратор становится наблюдаемым не только изнутри, но и снаружи, через GitHub.

### Критерии готовности

- после `Plan` появляется comment с планом;
- при rework появляется отдельный comment;
- terminal tracker sync вынесен в `Sync Tracker State`;
- side effects описаны в OpenSpec и соответствуют реальному поведению.

## 6. Добавить `Clarify / Rework` loop как отдельный слой workflow

### Что входит в работу

- сделать `clarify` и `rework` частью state machine;
- не сводить их к неформальному поведению “потом добавим”.

### `Clarify`

`Assess` должен уметь перевести run в состояние, где недостаточно данных для продолжения.

На этой итерации это может быть stub-логика, но должны существовать:

- состояние run;
- artifact с результатом `Assess`;
- переход в `clarify-needed`;
- GitHub-visible side effect для запроса уточнений.

### `Rework`

`Quality Gate` и/или `Review` должны уметь инициировать rework path.

На этой итерации это тоже может быть stub, но должны существовать:

- `reworkAttempt`;
- status transition;
- artifact решения о rework;
- отдельный comment о старте rework;
- повторный запуск нужного участка workflow по формальному правилу.

### Почему это критично уже сейчас

Даже если логика `clarify` и `rework` еще простая, структура попыток и переходов должна быть заложена сейчас. Иначе later-stage handoff, logs и state machine придется ломать повторно.

### Результат

После выполнения этого пункта `clarify` и `rework` существуют не как идея в архитектуре, а как часть workflow-модели.

### Критерии готовности

- есть явные состояния `clarify-needed` и `rework-needed`;
- используется `reworkAttempt`, а не retry BullMQ вместо него;
- transitions видны в artifacts, `run.json` и JSONL-логе;
- GitHub-visible side effects для `clarify`/`rework` определены.

## Рекомендуемая последовательность реализации

Чтобы снизить количество конфликтов и не ломать все сразу, рекомендована такая очередность:

1. Упростить intake до polling-only.
2. Переименовать workflow и завести новые stage types.
3. Ввести `runId`, `stageAttempt`, `reworkAttempt` в queue payload.
4. Расширить `Prepare Run` и сузить `Develop`.
5. Ввести `run.json` и artifact contracts.
6. Перевести handoff на файлы.
7. Добавить run-scoped JSONL logging.
8. Добавить GitHub-visible side effects.
9. Завести `clarify / rework` transitions и counters.

## Что можно оставить stub на этой итерации

Разрешается оставить содержательно упрощенными:

- `Assess`
- `Plan` validation
- `Quality Gate`
- `Review`
- `Clarify`
- `Rework`

Но нельзя оставлять неформализованными их:

- место в workflow;
- input/output artifacts;
- статусы;
- transitions;
- логирование;
- связь с `runId`.

## Что должно считаться итогом итерации

Итерация считается завершенной, когда:

- intake работает только одним способом;
- workflow в коде и архитектуре совпадает по названиям и этапам;
- `Prepare Run` подготавливает run и repo context для `Assess`, `Plan`, `Develop`;
- `Develop` отвечает только за executor;
- handoff идет через файловые artifacts;
- `run.json` отражает реальное состояние прогона;
- run-level JSONL logs привязаны к `runId`;
- `clarify / rework` существуют как часть state machine;
- GitHub-visible side effects определены и встроены в workflow.

