---
code: D5
slug: logic-contradiction
group: D
title_ru: "Логическое противоречие"
title_en: "a rule that passes everyone or no one"
---

## RU

**Что это.** Правило, которое пропускает всех или никого, или противоречит квотам: «ИЛИ не выбран ничего», «не выбран младше 18 ИЛИ не выбран старше 65», выход на тех, кого ждёт квота.

**Что ломается.** Скрининг формально есть, но не работает: либо проходят все (нецелевые в поле), либо не проходит никто (нулевой найм и сгоревший бюджет рассылки).

**Как чинить.** Писать правило со стороны выхода: «завершить, если выбрано «ничего» ИЛИ не выбран целевой»; «завершить, если выбрано «младше 18» ИЛИ «старше 65»».

**Плохо.**
Какими магазинами вы пользовались за месяц?
- ☐ Пятёрочка
- ☐ Магнит
- ☐ Лента
- ☐ Ничего из перечисленного
Логика: Дальше, если НЕ выбрано «Ничего из перечисленного» ИЛИ выбран «Магнит»

Последствие: Правило пропускает всех: любой, кто отметил хоть что-то, прошёл. Скрининг формально есть, но не работает.

**Хорошо.**
Какими магазинами вы пользовались чаще всего за месяц? Не больше трёх
- ☐ Пятёрочка
- ☐ Магнит
- ☐ Лента
- ☐ Ничего из перечисленного
Логика: Выход, если выбрано «Ничего из перечисленного» ИЛИ не выбран «Магнит»

## EN

**What.** A rule that admits everyone or no one, or contradicts the quotas: "continue if NOT
'none' selected OR the target selected"; "continue if 'under 18' not selected OR 'over 65'
not selected"; an exit on people a quota is waiting for.
**Breaks.** The screener formally exists but does not work: either everyone passes (non-fits
in the field) or nobody does (zero recruitment and a burnt invitation budget).
**Fix.** Write the rule from the exit side: "end of survey if 'none' selected OR the target
not selected"; "end if 'under 18' selected OR 'over 65' selected".
