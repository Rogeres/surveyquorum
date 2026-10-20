---
code: C4
slug: double-barrelled
group: C
title_ru: "Два критерия в одном"
title_en: "two criteria in one"
---

## RU

**Что это.** Один вариант или вопрос содержит два условия сразу. В выборке не встретился.

**Что ломается.** Кто выполнил одно условие из двух, ответить честно не может. Непонятно, кого отобрали, фильтр не воспроизводим.

**Как чинить.** Два вопроса, у каждого свой выход.

**Плохо.**
Вы работаете в ИТ и принимаете решения о закупке программного обеспечения?
- ○ Да
- ○ Нет
Логика: «Нет» → выход

Последствие: Кто работает в ИТ, но закупки не ведёт, ответить честно не может. Непонятно, кого отобрали.

**Хорошо.**
S1. Чем вы в основном занимаетесь на работе? Не больше двух · S2. В чём вы участвуете при закупке ПО?
- ☐ S2: Выбираю поставщика
- ☐ Согласую бюджет
- ☐ Подписываю договор
- ☐ Пользуюсь, но не выбираю
- ☐ Не участвую
Логика: Два вопроса, каждый со своим выходом

## EN

**What.** One option or one question carries two conditions at once ("I work in sales and
take part in choosing software").
**Breaks.** Someone who meets one condition of two cannot answer honestly. It is unclear who
was selected; the filter is not reproducible.
**Fix.** Two questions, each with its own exit.
**Exception.** A list of fields of work with "I don't work" in it, or a geography list that
mixes named regions with city-size bands, is one criterion with a non-fit option, not C4. C4
needs an option that is true only when two conditions both hold ("I work in sales and choose
the software").
