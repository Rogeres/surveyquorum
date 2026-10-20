---
code: A2
slug: no-exit
group: A
title_ru: "Фильтр без выхода из скринера"
title_en: "a filtering question with no way out"
---

## RU

**Что это.** Вопрос по смыслу отсеивает (пользуетесь ли, покупали ли, какие приложения стоят), у нецелевого респондента есть вариант, который честно отражает его опыт, но за выбором этого варианта ничего не следует: нет правила, которое выводит его из скринера (screen-out). Он идёт дальше как целевой.

**Что ломается.** Нецелевой проходит и в теле отвечает про опыт, которого нет. Клиент получает мусор, а QC банит честного человека как «противоречивого»: он теряет оплату, панель получает жалобу на платформу.

**Как чинить.** Каждому варианту, который честно выбрал бы нецелевой («не пользуюсь», «ничего из перечисленного»), поставить правило «завершить опрос» (в редакторе статус «Дисквалифицировать»).

**Исключения.** Нефильтрующие профилирующие вопросы (пол, город для сегментации) выхода не требуют. Граница с A5: здесь честный вариант есть, нет правила; в A5 честного варианта нет вообще. Когда нет ни того, ни другого, ставятся оба кода.

**Плохо.**
Приложениями каких продуктовых сетей вы пользуетесь?
- ☐ О’кей
- ☐ ВкусВилл
- ☐ METRO
- ☐ Пятёрочка
- ☐ Дикси
- ☐ Магнит
- ☐ Перекрёсток
- ☐ Лента
- ☐ Другое
- ☐ Не пользуюсь
Логика: Логики нет, следующий вопрос: «Как именно вы пользуетесь приложением Пятёрочки?»

Последствие: Тот, кто честно выбрал «Не пользуюсь», идёт дальше и отвечает про приложение, которого у него нет. Контроль качества видит противоречие и банит его.

**Хорошо.**
Приложениями каких продуктовых сетей вы пользуетесь?
- ☐ О’кей
- ☐ ВкусВилл
- ☐ METRO
- ☐ Пятёрочка
- ☐ Дикси
- ☐ Магнит
- ☐ Перекрёсток
- ☐ Лента
- ☐ Другое
- ☐ Не пользуюсь
Логика: Выход, если выбрано «Не пользуюсь» или не выбрана «Пятёрочка»

## EN

**What.** The question filters by meaning ("do you use", "have you bought", "which apps are
installed"), the honest non-fit has an option that describes them, but nothing follows: no
rule routes that option out of the screener. The non-fit continues as a fit.
**Breaks.** The non-fit answers the body about an experience they do not have. The client gets
junk; quality control then bans an honest person as "contradictory", who loses the payment
and complains about the platform.
**Fix.** Every option an honest non-fit would pick routes to the end of the survey.
**Exception.** Profiling questions that do not filter (gender, city for segmentation) need no
exit. Boundary with A5: here the honest option exists but has no rule; in A5 there is no
honest option at all. When both are missing, both codes apply.

Bad: "Which of these apps are installed on your phone?" - options: bank app, taxi, food
delivery, maps, fitness tracker, none - no rule on "none" → next question.
Good: same question, rule: "none" selected, or the target not selected → end of survey.
