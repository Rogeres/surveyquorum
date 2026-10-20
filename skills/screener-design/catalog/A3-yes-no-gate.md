---
code: A3
slug: yes-no-gate
group: A
title_ru: "Да/нет на целевое поведение"
title_en: "yes/no on the qualifying behavior"
---

## RU

**Что это.** Квалифицирующее поведение спрашивается бинарно: «Пользуетесь ли вы диктофоном?» да/нет, и «да» пропускает дальше.

**Что ломается.** Самозванец проходит одним кликом. Доля нецелевых в данных растёт, жалобы и возврат клиенту.

**Как чинить.** Спрятать целевое поведение в списке действий того же рода, с лимитом на основании («чаще всего, не больше трёх») и честным выходом. Да/нет оставить только для фактов допуска: 18+, согласие.

**Исключения.** Да/нет допустим для фактов допуска: возраст 18+, согласие, наличие ПК.

**Плохо.**
Пользуетесь ли вы диктофоном на смартфоне?
- ○ Да
- ○ Нет
Логика: «Нет» → выход

Последствие: Правильный ответ очевиден. Самозванец проходит одним кликом, доля нецелевых в данных растёт.

**Хорошо.**
Какими функциями смартфона вы пользовались чаще всего за последний месяц? Не больше трёх
- ☐ Калькулятор
- ☐ Диктофон
- ☐ Сканер документов
- ☐ Фонарик
- ☐ Шагомер
- ☐ Заметки
- ☐ Компас
- ☐ Переводчик
- ☐ Ничем из перечисленного
Логика: Выход, если не выбран «Диктофон». Лимит держится на основании «чаще всего»: отметить всё нельзя по смыслу. Это для брифа про активных пользователей; если клиенту нужен любой опыт, лимит убрать и сузить окно до 7 дней

## EN

**What.** The qualifying behavior is asked as a binary: "Do you use the voice recorder on your
phone?" yes/no, and "yes" passes.
**Breaks.** An imposter passes with one click. The share of non-fits in the data grows,
complaints and refunds follow.
**Fix.** A list of the same kind with the target hidden in it, a limit with a ranking basis
(A6) and an honest exit (A5): "Which phone features have you used most often in the last
month? Up to three" - calculator, voice recorder, document scanner, flashlight, pedometer,
notes, compass, translator, none of these; exit if the recorder is not selected.
**Exception.** Yes/no is fine for eligibility facts: 18+, consent, owning a computer.
