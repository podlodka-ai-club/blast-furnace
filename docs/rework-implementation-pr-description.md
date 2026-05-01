# PR Description: Rework mechanism

## Что меняется

Этот change добавляет в Blast Furnace полноценный цикл human rework после создания Pull Request.

Раньше основной поток фактически заканчивался после создания PR и синхронизации tracker-состояния. Теперь после PR система продолжает следить за ним: если PR смержен, run завершается успешно; если PR закрыт без merge, run завершается как закрытый без merge; если пользователь ставит на PR label `Rework`, система собирает human review feedback и запускает новый rework-проход.

Ключевая идея: rework не создает новый PR. Он продолжает работу в существующей PR branch, проходит обычные стадии качества и review, затем пушит изменения обратно в тот же PR.

## Новый post-PR lifecycle

После `make-pr` по-прежнему запускается `sync-tracker-state`. Но `sync-tracker-state` больше не считается финальной стадией сам по себе.

Его ответственность остается прежней:

- внешние tracker side effects;
- перевод source issue в `in review`;
- удаление `Rework` label после rework finalization;
- cleanup workspace.

После этого запускается новая стадия `PR Rework Intake`, которая работает как per-run polling loop для конкретного PR.

`PR Rework Intake` отслеживает:

- PR был смержен — run закрывается успешно;
- PR закрыт без merge — run завершается как closed without merge;
- на PR появился label `Rework` — начинается rework flow;
- ничего не произошло — stage переоткладывает сам себя с той же частотой, что и Intake.

## Rework trigger и сбор комментариев

Rework запускается label-ом `Rework` на PR.

При срабатывании trigger-а `PR Rework Intake` собирает human-authored PR review comments и PR-level comments в один markdown-документ. Комментарии фильтруются:

- исключаются комментарии Blast Furnace;
- исключаются GitHub users с type `Bot`;
- исключаются outdated comments;
- исключаются resolved comments;
- исключаются deleted comments.

Окно сбора комментариев:

- для первого rework собираются все релевантные комментарии;
- для последующих rework нижняя граница — `createdAt` handoff entry, который инициировал предыдущий rework;
- верхняя граница — текущий момент.

`File` и `Line` в markdown являются опциональными: если у комментария нет location, эти поля просто не выводятся.

## Route analysis

Собранные комментарии передаются в prompt `prompts/review_comments_analysis.md` вместе с:

- title и description задачи;
- latest available accepted plan;
- markdown-документом с review comments.

Codex должен вернуть первую строку:

- `ROUTE: DEVELOP` — rework идет сразу в Develop;
- `ROUTE: PLAN` или любое другое значение — rework идет в Plan.

Полный ответ Codex сохраняется в handoff отдельно от comments markdown. Этот ответ нужен для диагностики и не используется downstream-стадиями как рабочий контекст.

## Workspace strategy

Workspace после PR creation продолжает удаляться. Для rework он не сохраняется.

Когда `PR Rework Intake` решает запустить rework, он не готовит workspace сам. Вместо этого он делегирует управление в `Prepare Run`.

`Prepare Run` получает rework handoff, создает свежий workspace, checkout-ит существующую PR branch и затем направляет execution в выбранный stage:

- `plan`, если route analysis решил, что нужен новый план;
- `develop`, если можно сразу вносить изменения.

В rework mode `Prepare Run` больше не обязан всегда продолжать в `Assess`. Для initial run старое поведение сохраняется: `Prepare Run -> Assess`.

## Attempt counters

Для rework используется два счетчика:

- `reworkAttempt` увеличивается при входе в rework;
- `stageAttempt` при входе в rework Plan или Develop сбрасывается в `1`.

`MAX_HUMAN_REWORK_ATTEMPTS` задает максимальное число полных flow runs, а не только количество rework-проходов.

Например, значение `3` означает:

- initial run;
- первый rework;
- второй rework.

Следующий rework уже запрещен. В этом случае run завершается terminal outcome, и в source issue добавляется comment о том, что rework-ов слишком много.

## Plan selection

Для rework всегда используется latest available accepted plan.

Правило такое:

- первый rework использует original accepted plan;
- если какой-то предыдущий rework проходил через Plan, используется самый свежий accepted rework plan;
- если все rework-и шли напрямую через Develop и план не обновлялся, используется original accepted plan.

Это важно для обоих путей:

- `Plan` получает latest plan как old/current plan context;
- `Develop` получает latest plan вместе с `reviewContent`.

## Rework через Plan

Если route — `PLAN`, stage `plan` запускается в rework mode.

Он использует template:

```text
prompts/plan-rework.md
```

В template передаются:

- task title;
- task description;
- latest available accepted plan;
- markdown с human review comments.

Результирующий accepted plan передается в `Develop` обычным способом.

## Rework напрямую через Develop

Если route — `DEVELOP`, stage `develop` запускается напрямую после rework `Prepare Run`.

Он использует template:

```text
prompts/develop-rework.md
```

В template передаются:

- latest available accepted plan;
- comments markdown как `reviewContent`.

После этого flow не обрывается: rework все равно проходит через Quality Gate, Review, Make PR и Sync Tracker State.

## Make PR в rework mode

В initial flow `Make PR` создает новый Pull Request.

В rework flow `Make PR` не создает новый PR. Вместо этого он:

- определяет существующий PR из dependency chain;
- валидирует PR head repository;
- валидирует branch name;
- валидирует expected head SHA;
- reject-ит fork PR, unexpected repository, unexpected branch и unexpected head SHA;
- коммитит и пушит изменения в существующую PR branch;
- при non-fast-forward конфликте делает refetch и bounded retry;
- после успешной finalization передает управление в `Sync Tracker State`.

Если rework не произвел файловых изменений, это все равно не terminal outcome внутри `Make PR`. `Make PR` передает управление в `Sync Tracker State`, чтобы тот снял `Rework` label, перевел issue обратно в `in review` и почистил workspace.

## Idempotency и recovery

`PR Rework Intake` должен быть устойчив к duplicate delayed jobs, BullMQ retries и crash-ам.

Для этого вводится per-run lock или durable in-progress marker. Перед тем как append-ить terminal/rework handoff, stage фиксирует, что action уже обрабатывается.

Handoff append и enqueue следующего job считаются recoverable transition:

- handoff record является durable decision;
- после append в run summary сохраняется pending next stage;
- если процесс упал после append, но до enqueue, повторный запуск должен найти существующий handoff и восстановить enqueue;
- duplicate job не должен append-ить второй rework handoff.

## Основные boundary decisions

Принятые границы ответственности:

- `PR Rework Intake` — polling PR lifecycle, trigger detection, comment collection, route analysis, rework handoff.
- `Prepare Run` — подготовка workspace как для initial run, так и для rework.
- `Plan` — rework planning через `plan-rework.md`.
- `Develop` — direct human rework через `develop-rework.md` или обычный develop после rework plan.
- `Make PR` — initial PR creation или update существующей PR branch в rework.
- `Sync Tracker State` — external tracker side effects, PR label cleanup, issue status update, workspace cleanup.
- `Run Handoff Ledger` — durable cross-stage context; business data не передается через queue payload fields.

## Референсы промптов

В `docs/Reference prompts for rework` положил референсы, которые имел в виду для переработки плана и оценки задачи - должна она идти в plan или в develop. Их нужно доработать напильником и положить в актуальные файлы

## Связанные OpenSpec artifacts

- `openspec/changes/rework-implementation/proposal.md`
- `openspec/changes/rework-implementation/design.md`
- `openspec/changes/rework-implementation/specs/**/spec.md`
- `openspec/changes/rework-implementation/tasks.md`
