---
code: A5
slug: no-none
group: A
title_ru: "Нет честного варианта для нецелевого"
title_en: "no honest option for the non-fit"
---

## RU

**Что это.** Список, где человеку, которому не подходит ни один вариант, нечего выбрать: нет «ничего из перечисленного», «не пользуюсь», «другой город». Пропустить вопрос нельзя. Правило выхода при этом может быть, но ему не на что сработать.

**Что ломается.** То же, что в A2: нецелевой отмечает что-то наугад, проходит, в теле противоречит себе, и бан получает честный человек, а не анкета.

**Как чинить.** Добавить «ничего из перечисленного» (и «другое», где список не исчерпывающий) и вывести по нему из опроса. Список городов самый частый случай: двадцать городов без «другой город» это та же ошибка.

**Исключения.** Исчерпывающие списки (пол, «да/нет/не знаю») кода не требуют. Один вариант «Другое» в списке брендов честным выходом для непользователя не считается: он подразумевает, что что-то всё же используется.

**Плохо.**
Какими сервисами доставки еды вы пользовались за последние 3 месяца?
- ☐ Яндекс Еда
- ☐ Delivery Club
- ☐ Самокат
- ☐ Лавка
- ☐ Кухня на районе
- ☐ ВкусВилл
- ☐ Dostaевский
- ☐ Папа Джонс
- ☐ Додо Пицца
- ☐ Другое
Логика: Выход, если не выбран «Самокат». Варианта «ничем» нет, пропустить нельзя

Последствие: Честному непользователю нечего выбрать. Он отмечает что-то наугад, нередко целевой, и проходит как целевой.

**Хорошо.**
Какими сервисами доставки еды вы пользовались чаще всего за последние 3 месяца? Не больше трёх
- ☐ Яндекс Еда
- ☐ Delivery Club
- ☐ Самокат
- ☐ Лавка
- ☐ Кухня на районе
- ☐ ВкусВилл
- ☐ Dostaевский
- ☐ Папа Джонс
- ☐ Додо Пицца
- ☐ Другое
- ☐ Ни одним из перечисленных
Логика: Выход, если выбрано «Ни одним» или не выбран «Самокат»

## EN

**What.** A list where a person who fits none of the options has nothing to pick: no "none of
these", "I don't use any", "another city". The question cannot be skipped. An exit rule may
exist, but nothing triggers it.
**Breaks.** As in A2: the non-fit picks something at random, often the target, passes,
contradicts themselves in the body, and the honest person gets banned instead of the
questionnaire.
**Fix.** Add "none of these" (and "other" where the list is not exhaustive) and route it out.
A city list is the common case: twenty cities with no "another city" / "outside the country"
is A5 even when the list looks long.
**Exception.** Exhaustive lists (gender, yes/no/don't know) need no "none". A single "Other" in
a brand list is not an honest exit for a non-user: it implies that something is used.
