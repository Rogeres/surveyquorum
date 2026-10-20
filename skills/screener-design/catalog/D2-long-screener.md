---
code: D2
slug: long-screener
group: D
title_ru: "Длинный скрининг без причины"
title_en: "a long screener without a reason"
---

## RU

**Что это.** Больше примерно десяти скрининговых вопросов, и длина взялась не из брифа, а из устройства анкеты. Сама по себе длина не ошибка: у кода обязательно указывается причина, и от неё зависит, что скилл может сделать.

**Что ломается.** Обрывы, падение incidence, рост стоимости найма. Честные уходят вместе с самозванцами, причём уходят на вопросах, которые ничего не решали.

**Как чинить.** Пустые вопросы убрать или перенести в тело; размазанный критерий схлопнуть в один вопрос; если критериев в брифе действительно много, поставить самые отсекающие первыми.

**Исключения.** Ошибкой считаются только причины 1 и 2. Длинный скрининг по причине 3 кодом не помечается, вместо него рекомендация по порядку и таргетам. В разметке к коду обязательно поле «причина».

**Плохо.**
15 скрининговых вопросов
- Пол · Тип населённого пункта · Семейный статус · Дети · Образование · Занятость · Финансовое положение · Доход · Язык ← девять вопросов без фильтра и без квоты
- Возраст · Религия · Продукты · Решения в семье · Регион · Опыт ← шесть фильтруют
Логика: Причина 1: пустые вопросы

Последствие: Обрывы на вопросах, которые ничего не решают. Честные уходят на пятом вопросе, не дойдя до фильтра.

**Хорошо.**
6 скрининговых вопросов
- Возраст · Регион · Продукты · Решения в семье · Опыт · Отсев отрасли
- Пустые вопросы перенесены в тело или убраны
Логика: Самые отсекающие вопросы первыми

## EN

**What.** More than about ten screening questions, and the length comes from the design, not
from the brief. Length by itself is not a fault: the code always carries a cause, and the
cause decides what the skill can do.
**Causes.** (1) Empty questions: they neither filter nor feed a quota (gender, education,
employment, income, phone brand), including re-asking what a target verified (A13). Fix:
remove or move to the body. In real corpora this is the main cause: more than half of the
questions in a long screener are often empty. (2) One criterion smeared over several
questions: "do you use", then "how often", then "when last", where one list with a time
window and a basis-limited choice is enough (A6, A8). Fix: collapse into one question. (3) The
brief really has many criteria: cannot be shortened, not a fault. The skill puts the most
selective questions first so a non-fit leaves on the second question, not the tenth, and
checks whether some criteria are covered by verified targets.
**Breaks.** Break-offs, falling incidence, rising recruitment cost. Honest people leave
together with imposters, and they leave on questions that decided nothing.
**Fix.** Causes 1 and 2: remove or move the empty questions, collapse the smeared criterion
into one list with a window and a basis-limited choice. Cause 3: keep the questions, order
them by selectivity, move what a verified target covers out of the screener.
**Exception.** Only causes 1 and 2 are faults; cause 3 gets a recommendation on order, not a
code.
