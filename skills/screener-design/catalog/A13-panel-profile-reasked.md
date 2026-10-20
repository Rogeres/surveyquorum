---
code: A13
slug: panel-profile-reasked
group: A
title_ru: "Переспрошено то, что проверяет таргет"
title_en: "re-asking what the recruitment target verifies"
---

## RU

**Что это.** Пол, возраст, город или другой критерий, уже заданный таргетом найма, спрашиваются в скрининге заново.

**Что ломается.** Лишняя длина. Два ответа на один критерий (возраст диапазоном из таргета и категориями из анкеты) расходятся в отчёте. Скрининг может отсеять того, кого таргет уже пропустил, и найм дорожает без пользы.

**Как чинить.** Убрать вопрос: сервис, который проверяет таргет, сам задаёт его и проверяет ответ.

**Исключения.** Найм без таргетов Pathway: сервис ничего не проверяет, и соцдем-блок остаётся единственной проверкой; единственный кейс корпуса именно такой, для него код нейтрален. Второе исключение: география мельче городов 500 тыс. и возрастные группы для отчёта, таргет их не знает, вопрос в анкете нужен.

**Плохо.**
_Таргет найма: женщины 25–45, Москва._
S1. Укажите ваш пол · S2. Укажите ваш возраст · S3. Где вы живёте?
- Три вопроса повторяют то, что сервис уже спросил и проверил по таргету
Логика: Отсев по этим вопросам дублирует проверку таргета

Последствие: Три лишних вопроса. Возраст в отчёте дважды и в разных форматах (диапазон из таргета, категория из анкеты), они расходятся. Скрининг может отсеять того, кого таргет уже пропустил.

**Хорошо.**
S1. Какими сервисами вы пользовались чаще всего за последний месяц? Не больше трёх
- ☐ …поведенческий вопрос сразу первым
Логика: Пол, возраст и город берутся из проверки таргета, в скрининге не задаются

## EN

**What.** Gender, age, city or another criterion already set as a hire target is asked again
in the screener.
**Breaks.** Extra length. Two answers to one criterion (age as a target range and as
questionnaire bands) diverge in the report. The screener may drop someone the target already
admitted, and recruitment gets more expensive for nothing.
**Fix.** Drop it. The service that verifies the target asks and checks it itself.
**Exception.** Recruitment without verified targets: the service checks nothing and the
demographic block is the only check. Also: geography finer than the target knows, or age
groups needed for the report, stay in the questionnaire.
