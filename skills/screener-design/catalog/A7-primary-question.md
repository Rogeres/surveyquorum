---
code: A7
slug: primary-question
group: A
title_ru: "«Основной» вместо «пользуется»"
title_en: ""main" instead of "uses""
---

## RU

**Что это.** Бриф просит пользователей или клиентов X, а гейт стоит на вопросе «какой ваш основной оператор / банк / сервис» с одним ответом. Вторая форма той же ошибки: «какими пользуетесь» с одним ответом и без основания для выбора.

**Что ломается.** Ложный отсев: клиент просил пользователей X, а получил только тех, у кого X основной. Найм дольше и дороже, выборка смещена, при узкой аудитории набрать не удаётся.

**Как чинить.** Спросить мультивыбором «какими пользуетесь», а «какой основной» задать после гейта как сегментирующий вопрос. Для естественно коротких наборов (сим-карты) лимит не нужен.

**Исключения.** Бриф сам требует «основной» или «чаще всего»: кода нет. «Основной» как сегментирующий вопрос после гейта «какими пользуетесь»: норма. Для кейсов корпуса бриф не проверен, аудитория восстановлена по самой анкете, поэтому код там означает «сверить с брифом», а не доказанную ошибку. Если инструкция говорит «выберите все», а тип один ответ, это C5.

**Плохо.**
_Бриф: «абоненты МегаФона»._
Какой ваш основной мобильный оператор?
- ○ МТС
- ○ Билайн
- ○ МегаФон
- ○ Т2
- ○ Yota
- ○ Другой
Логика: Дальше только «МегаФон»

Последствие: Абонент с двумя сим-картами, у которого МегаФон вторая, честно отвечает «МТС» и отсеян, хотя клиенту подходит. Найм дольше и дороже, выборка смещена.

**Хорошо.**
Сим-картами каких операторов вы пользуетесь сейчас?
- ☐ МТС
- ☐ Билайн
- ☐ МегаФон
- ☐ Т2
- ☐ Yota
- ☐ СберМобайл
- ☐ Тинькофф Мобайл
- ☐ Другого
- ☐ Не пользуюсь мобильной связью
Логика: Выход, если не выбран «МегаФон». «Какой из них основной?» спрашивается после, для сегментации

## EN

**What.** The brief asks for users or clients of X, and the gate is "which is your main
operator / bank / service" with one answer. Second form of the same fault: "which do you use"
with a single answer and no basis for choosing.
**Breaks.** False screen-out: the client asked for users of X and got only those for whom X
is the main one. Recruitment is longer and more expensive, the sample is biased, a narrow
audience cannot be filled.
**Fix.** Multi-select of what they use; "which one is the main one" afterwards, for
segmentation. For sets that are naturally small (SIM cards in use) no limit is needed.
**Exception.** The brief itself asks for "main" or "most often": no code. "Main" as a
segmentation question after the "which do you use" gate: normal. If the text says "choose all"
and the type is single-choice, that is C5.
