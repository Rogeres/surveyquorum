---
code: D6
slug: body-contradiction
group: D
title_ru: "Тело переспрашивает скрининг"
title_en: "the body re-asks the screener"
---

## RU

**Что это.** Тело анкеты задаёт критерий скрининга ещё раз, другими словами или в другой форме: возраст диапазоном в скрининге и числом в теле, «пользовались за 3 месяца» и «как часто пользуетесь», замаскированный список в скрининге и прямое «вы клиент банка X» в теле. Автор думает, что ловит самозванцев на противоречии.

**Что ломается.** Честные банятся контролем качества за «противоречие», которое создала анкета: респондент отработал всю анкету и остался без оплаты, жалоба на платформу, минус один из выборки и донабор за наш счёт, а клиент этот ответ уже видел в данных. В одном тесте корпуса переспрос возраста дал 28 «противоречий» на 903 проверенных ответа; у семи из них число отличалось от границы диапазона на год, и этих людей забанили вместе с теми, кто действительно назвал два разных возраста.

**Как чинить.** Убрать дубль критерия из тела. Проверка в теле не отсеивает: если критерий важен, его ловит скрининг. Открытый вопрос про личный опыт в теле это решение дизайна исследования под конкретную гипотезу, а не замена отсева.

**Плохо.**
Скрининг: «Сколько вам лет?» → выбрано «36–45»
- Тело: «Напишите ваш возраст» → 45
- Контроль качества сравнивает 45 с группой «45–55» и видит противоречие
Логика: 28 «противоречий» на 903 проверенных ответа в одном тесте, семь из них на границе диапазона

Последствие: Честные банятся за противоречие, которое создала анкета: неоплаченная анкета, жалоба, минус один из выборки и донабор.

**Хорошо.**
Скрининг: «Сколько вам лет?» → «36–45»
- Тело возраст не переспрашивает. Если критерий важен, его ловит скрининг
Логика: Проверка в теле не отсеивает

## EN

**What.** The body asks a screener criterion again, in other words or in another form: age as
bands in the screener and as a number in the body; "used in the last 3 months" and "how often
do you use"; a masked list in the screener and a direct "are you a client of bank X" in the
body. The author believes this catches imposters on a contradiction.
**Breaks.** Honest people get banned by quality control for a "contradiction" the
questionnaire created: the respondent completed the whole survey and is left unpaid, a
complaint against the platform, one less in the sample and a top-up at the provider's cost,
while the client has already seen that answer in the data. In one real survey, re-asking age
produced 28 "contradictions" among 903 checked answers; in seven of them the number was one year
off the band edge, and those people were banned together with the ones who really gave two ages.
**Fix.** Remove the duplicate from the body. A check in the body does not screen anyone out:
if the criterion matters, the screener catches it. An open question about personal experience
in the body is a research-design decision for a specific hypothesis, not a substitute for
screening.
