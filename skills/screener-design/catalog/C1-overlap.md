---
code: C1
slug: overlap
group: C
title_ru: "Пересекающиеся диапазоны"
title_en: "overlapping or gapped ranges"
---

## RU

**Что это.** Диапазоны возраста, дохода, частоты пересекаются или имеют дыру.

**Что ломается.** Человек на границе выбирает произвольно: квоты заполняются не теми, логика выхода срабатывает не там, группы в отчёте смещены.

**Как чинить.** Непересекающиеся полные диапазоны: 18–24, 25–34, 35–44 …

**Плохо.**
Сколько вам лет?
- ○ 18–25
- ○ 25–35
- ○ 35–45
- ○ 45–55
- ○ Старше 55
Логика: Квоты по группам

Последствие: Кому 25, 35 или 45, выбирает произвольно. Квоты заполняются не теми, группы в отчёте смещены.

**Хорошо.**
Сколько вам лет?
- ○ Младше 18
- ○ 18–24
- ○ 25–34
- ○ 35–44
- ○ 45–54
- ○ 55 и старше
Логика: «Младше 18» → выход

## EN

**What.** Age, income or frequency bands overlap or leave a gap ("18-25, 25-34"; "30-40,
41-58, 58-65").
**Breaks.** A person on the boundary picks arbitrarily: quotas fill with the wrong people, the
exit rule fires in the wrong place, report groups are shifted.
**Fix.** Mutually exclusive, jointly exhaustive bands: 18-24, 25-34, 35-44 ...
**Exception.** Not C1: bands written as "from 500k to 1M / from 1M" (the convention is clear
to respondents); a named city next to a size band ("Moscow / another city over 1M"); a
standard frequency ladder ("about once a week / several times a month") - its steps are
ordinal, not numeric. C1 needs the same number explicitly in two bands (18-25 / 25-34) or a
value no band covers (45-54 / 56+).
