---
code: A6
slug: multi-no-limit
group: A
title_ru: "Мультивыбор без лимита и без основания для выбора"
title_en: "multi-select without a limit and without a ranking basis"
---

## RU

**Что это.** Фильтрующий вопрос с несколькими ответами и инструкцией «выберите все подходящие». Лимита нет ни в тексте, ни в настройке, и нет критерия, по которому респондент должен выбирать.

**Что ломается.** Самозванец отмечает всё и гарантированно попадает в целевой вариант. Ответ «чем пользуетесь» у прошедших непригоден для анализа: отмечено всё подряд.

**Как чинить.** Лимит сам по себе не работает: «выберите до 3» без критерия респондент читает как произвольное ограничение и всё равно отмечает первое попавшееся. Лимит должен опираться на основание для выбора, которое заставляет ранжировать свой опыт: самые частые («которыми пользуетесь чаще всего»), основные («чем в основном занимаетесь»), самые важные («которые для вас важнее всего»). Окно времени («за последний месяц») основанием не является: оно ограничивает давность, а не количество, и за месяц честно можно отметить всё. Тогда отметить всё подряд не получится по смыслу, а не только по счётчику, и ответ целевого становится проверяемым: он должен совпасть с тем, что он расскажет в теле. Основание выбирается по брифу. Нужны активные пользователи: лимит с «чаще всего». Нужен любой опыт: лимит не ставить, иначе редкий, но честный пользователь не попадёт в тройку и вылетит (как в A7); вместо лимита сузить окно («за последние 7 дней»), которое само сокращает список, а «отметил всё» становится неправдоподобным и видно в экспорте.

**Плохо.**
В каких магазинах вы делали покупки за последнюю неделю? Выберите все подходящие
- ☐ Пятёрочка
- ☐ Магнит
- ☐ Лента
- ☐ Перекрёсток
- ☐ Дикси
- ☐ ВкусВилл
- ☐ Ашан
- ☐ О’кей
- ☐ METRO
- ☐ Spar
- ☐ Верный
- ☐ Азбука вкуса
- ☐ Fix Price
- ☐ Чижик
- ☐ Другое
Логика: Дальше, если выбран «Магнит»

Последствие: Самозванец отмечает все 15 и гарантированно проходит. Ответ прошедших про магазины ничего не значит: отмечено всё подряд.

**Хорошо.**
В каких магазинах вы покупали продукты чаще всего за последний месяц? Выберите не больше трёх
- ☐ Пятёрочка
- ☐ Магнит
- ☐ Лента
- ☐ Перекрёсток
- ☐ Дикси
- ☐ ВкусВилл
- ☐ Ашан
- ☐ О’кей
- ☐ METRO
- ☐ Spar
- ☐ Верный
- ☐ Азбука вкуса
- ☐ Fix Price
- ☐ Чижик
- ☐ Ни в одном из перечисленных
Логика: Выход, если не выбран «Магнит». «Чаще всего» заставляет ранжировать, отметить всё нельзя по смыслу

## EN

**What.** A filtering multi-select with "choose all that apply". No limit in the text or in
the settings, and no basis on which the respondent should choose.
**Breaks.** The imposter ticks everything and is guaranteed to hit the target. The "what do
you use" answer of those who passed is useless for analysis: everything is ticked.
**Fix.** A limit alone does not work: "up to 3" without a criterion reads as an arbitrary cap
and people still tick the first three. The limit must rest on a ranking basis: most often
("which you use most often"), main ("what you mainly do at work"), most important. A time
window ("in the last month") is not a basis: it bounds recency, not count, and in a month one
can honestly tick everything. With a basis, ticking everything becomes impossible by meaning,
not just by the counter, and the target's answer becomes checkable against what they say in
the body. The basis follows the brief. Active users wanted: limit + "most often". Any use
wanted: no limit, otherwise a rare but honest user does not make the top three and drops out
(as in A7); narrow the window instead ("in the last 7 days"), which shortens the list by
itself and makes "ticked everything" implausible and visible in the export.
**Exception.** Platforms differ: some store the limit, some only in the question text. Fake
"honeypot" options in the list are not required (a limit with a basis is enough).

Bad: "Which grocery chains do you shop at? Choose all that apply."
Good: "Which grocery chains did you shop at most often in the last month? Up to three" - ten
chains, "another", "I don't buy groceries myself"; exit if the target is not selected.
