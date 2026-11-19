package com.safarzod.jarvis.nlu

import java.util.Calendar

/**
 * Офлайн-разбор русских команд на правилах. Работает мгновенно и без нейросети;
 * нейросеть (если скачана) подключается только когда правила не поняли фразу.
 */
object Parser {

    val wakeWords = listOf("джарвис", "джарвиз", "джервис", "джарвес", "жарвис", "дарвис", "jarvis")
    private val leadingFillerRe = Regex(
        "^(?:(?:пожалуйста|плиз|ну|слушай|эй|а|так|давай|окей|ок|короче|будь добр|будь добра|" +
            "ты можешь|можешь|можете|не мог бы ты|не могла бы ты|сможешь|мне нужно|мне надо|я хочу чтобы ты|я хочу|хочу)\\s+)+"
    )
    private val trailingFillerRe = Regex("(?:\\s+(?:пожалуйста|плиз|сэр|срочно|быстро|быстрее))+$")

    /** Убирает обращение «Джарвис» и вежливые слова по краям. */
    fun clean(raw: String): String {
        var t = Text.normalize(raw)
        var changed = true
        while (changed) {
            changed = false
            for (w in wakeWords) {
                if (t == w) return ""
                if (t.startsWith("$w ")) { t = t.removePrefix("$w ").trim(); changed = true }
                if (t.endsWith(" $w")) { t = t.removeSuffix(" $w").trim(); changed = true }
            }
            val l = leadingFillerRe.replace(t, "")
            if (l != t) { t = l; changed = true }
            val r = trailingFillerRe.replace(t, "")
            if (r != t) { t = r; changed = true }
        }
        return t.trim()
    }

    fun containsWake(raw: String): Boolean {
        val w = Text.words(raw)
        return w.any { it in wakeWords }
    }

    fun parse(raw: String, now: Calendar = Calendar.getInstance()): Command {
        val c = clean(raw)
        if (c.isEmpty()) return Command.Wake
        val d = Text.digitize(c)
        return parseClean(c, d, now)
    }

    private fun has(s: String, re: String) = Regex(re).containsMatchIn(s)
    private fun full(s: String, re: String) = Regex("^(?:$re)$").matches(s)

    private fun parseClean(c: String, d: String, now: Calendar): Command {
        // ---------- короткие ответы в диалоге ----------
        if (full(c, "отмена|отмени|отменить|отбой|стоп|стой|хватит|не надо|забудь это|нет не надо|нет отмена|ничего|никому|неважно|отставить|отменяй")) return Command.Cancel
        if (full(c, "да|ага|угу|конечно|подтверждаю|верно|точно|давай|отправляй|отправь|звони|набирай|да давай|правильно|все верно|именно|ок|окей|хорошо|да конечно|да отправь|да звони|подтверди|подтверждаю отправку|ну да|да да|так точно|сделай")) return Command.Yes
        if (full(c, "нет|не|неа|не то|не тот|не та|не этот|не эта|другой|другая|неправильно|не правильно|нет не то|не он|не она")) return Command.No
        Regex("^(?:номер |вариант |контакт )?(\\S+)$").find(d)?.let { m ->
            val w = m.groupValues[1]
            Text.ordinal(w)?.let { return Command.Choose(it) }
            if (c.startsWith("номер ") || c.startsWith("вариант ")) w.toIntOrNull()?.let { return Command.Choose(it) }
        }
        if (full(c, "повтори|еще раз|повтори еще раз|что ты сказал|не расслышал|повтори пожалуйста")) return Command.Repeat

        // ---------- память ----------
        parseMemory(c)?.let { return it }

        // ---------- разговор ----------
        if (full(c, "привет|здравствуй|здравствуйте|добрый день|добрый вечер|доброе утро|доброй ночи джарвис|хай|салют|здорово|приветствую|привет привет|здарова|хеллоу|хелло|алло")) return Command.Hello
        if (full(c, "спокойной ночи|доброй ночи|я спать|я пошел спать|я спать пошел|пошел спать|сладких снов|я ложусь спать")) return Command.GoodNight
        if (has(c, "^(?:спасибо|благодарю|спс|спасибочки|сенкс|thank)") && c.split(' ').size <= 4) return Command.Thanks
        if (full(c, "(?:ты )?(?:молодец|умница|красавчик|красава|гений|лучший|ты лучший|крут|ты крут|ты крутой|отлично|супер|класс|круто|шикарно|великолепно|отличная работа|хорошая работа|так держать)")) return Command.Praise
        if (has(c, "(?:^| )(?:дурак|тупой|тупица|идиот|дебил|глупый|бесполезный|бестолковый|кретин|придурок|туп)(?: |$)") && c.split(' ').size <= 5) return Command.Insult
        if (has(c, "^(?:как (?:у тебя )?дела|как ты|как поживаешь|как настроение|как сам|как жизнь|ты как|все хорошо у тебя|как работаешь)")) return Command.HowAreYou
        if (has(c, "^(?:кто ты|ты кто|как тебя зовут|что ты такое|представься|кто ты такой|расскажи о себе|ты кто такой)")) return Command.WhoAreYou
        if (has(c, "^(?:что ты умеешь|что ты можешь|помощь|команды|список команд|какие команды|что умеешь|что можешь|покажи команды|справка|помоги)$")) return Command.Help
        if (has(c, "(?:шутк|анекдот|рассмеши|пошути|насмеши)")) return Command.Joke
        if (full(c, "пока|до свидания|до связи|все спасибо|спасибо все|свободен|можешь идти|отдыхай|на этом все|это все|все|всего доброго|не слушай|хватит слушать|отключись|выключись|замолчи|помолчи|тихо")) return Command.Bye

        // ---------- звонки ----------
        if (full(c, "ответь|ответить|прими звонок|прими вызов|возьми трубку|подними трубку|ответь на звонок")) return Command.AnswerCall
        if (full(c, "сбрось|сбросить|отклони|отклонить|не отвечай|сбрось звонок|отклони звонок|положи трубку|заверши звонок|завершить звонок|повесь трубку|отбей")) return Command.RejectCall

        Regex("^(?:позвони|позвонить|набери|набрать|звони|вызови|вызвать|соедини меня с|соедини с|свяжись с|сделай звонок|перезвони|позвоните|звякни|брякни|дозвонись до)(?: (.*))?$").find(d)?.let { m ->
            var rest = (m.groupValues.getOrNull(1) ?: "").trim()
            rest = rest.removePrefix("мне ").removePrefix("по номеру ").removePrefix("на номер ").removePrefix("номер ").trim()
            rest = rest.replace(Regex(" (?:по телефону|на мобильный|на сотовый|по ватсапу|в ватсапе|в ватсап)$"), "").trim()
            val digits = rest.replace(" ", "").replace("плюс", "+")
            if (digits.length >= 3 && digits.all { it.isDigit() || it == '+' }) return Command.CallNumber(digits)
            return Command.Call(rest.ifEmpty { null })
        }
        Regex("^звонок (.+)$").find(c)?.let { return Command.Call(it.groupValues[1]) }

        // ---------- сообщения ----------
        if (has(c, "^(?:прочитай|прочти|покажи|зачитай|какие|есть ли|есть|открой)(?: мне)? (?:новые |последние |входящие )?(?:сообщения|смс|уведомления|эсэмэски|сообщение)") ||
            full(c, "что мне пишут|кто мне писал|кто написал|что пришло|новые сообщения|есть сообщения|что нового в сообщениях")
        ) return Command.ReadMessages
        parseMessage(c)?.let { return it }

        // ---------- фонарик ----------
        if (has(c, "(?:фонар|фанар|вспышк|подсветк)") || full(c, "посвети|свет|дай свет|включи свет|выключи свет|погаси свет")) {
            val off = has(c, "(?:выключ|отключ|погас|убер|убр|потуш|не надо|хватит)")
            return Command.Flashlight(!off)
        }

        // ---------- музыка ----------
        if (has(c, "(?:следующ[\\p{L}\\d]* (?:песн|трек|композиц)|переключи (?:песню|трек|музыку)|^дальше$|^следующ[\\p{L}\\d]*$|^некст$|^скип$|пропусти (?:песню|трек))")) return Command.Music(MediaAction.NEXT)
        if (has(c, "(?:предыдущ[\\p{L}\\d]*|верни (?:песню|трек|прошлую)|прошл[\\p{L}\\d]* (?:песн|трек)|^назад песню$)")) return Command.Music(MediaAction.PREV)
        if (has(c, "(?:^пауза$|на паузу|останови (?:музыку|песню|трек|плеер|воспроизведение)|выключи (?:музыку|песню|трек|плеер)|стоп музык|музыку стоп|хватит музык|убери музыку|замолчи музык)")) return Command.Music(MediaAction.PAUSE)
        if (has(c, "^(?:включи|поставь|запусти|продолжи|играй|воспроизведи|давай|врубай|вруби|сыграй)(?: (?:музыку|музыка|песню|песенку|трек|плеер|что нибудь|воспроизведение|музычку))?$") && c.split(' ').size >= 2 ||
            full(c, "музыку|музыка|продолжи|воспроизведение|играй")
        ) return Command.Music(MediaAction.PLAY)

        // ---------- громкость ----------
        if (has(c, "(?:на полную|на максимум|максимальн[\\p{L}\\d]* громкост|громкость на максимум|громкость максимум|выкрути звук|громко на всю)")) return Command.Volume(VolumeAction.MAX)
        if (has(c, "(?:беззвучн|без звука|выключи звук|отключи звук|убери звук|режим тишины|звук выключи|звук отключи|вибро)")) return Command.Volume(VolumeAction.SILENT)
        if (has(c, "(?:включи звук|верни звук|звук включи|сними беззвуч|обычный режим|выключи беззвуч)")) return Command.Volume(VolumeAction.UNMUTE)
        if (has(c, "(?:громче|погромче|прибавь (?:звук|громкость)?|увеличь громкость|сделай громче|добавь громкость|звук громче|прибавь)")) return Command.Volume(VolumeAction.UP)
        if (has(c, "(?:тише|потише|убавь (?:звук|громкость)?|уменьши громкость|сделай тише|звук тише|убавь)")) return Command.Volume(VolumeAction.DOWN)

        // ---------- системные панели ----------
        if (has(c, "(?:вай ?фай|wi ?fi|вифи|вайфай|wifi)")) return Command.Panel(PanelKind.WIFI)
        if (has(c, "(?:блюту[зс]|bluetooth|блютус|блутуз)")) return Command.Panel(PanelKind.BLUETOOTH)
        if (has(c, "(?:мобильн[\\p{L}\\d]* (?:интернет|данн)|передач[\\p{L}\\d]* данных|включи интернет|выключи интернет)")) return Command.Panel(PanelKind.INTERNET)
        if (has(c, "(?:нфс|nfc|энэфси)")) return Command.Panel(PanelKind.NFC)
        if (has(c, "(?:геолокац|местоположени|gps|джипиэс|геопозиц)")) return Command.Panel(PanelKind.LOCATION)
        if (has(c, "(?:ярче|темнее|яркост)")) return Command.Panel(PanelKind.DISPLAY)
        if (has(c, "(?:экономи[\\p{L}\\d]* (?:батаре|заряд|энерги)|энергосбережени)")) return Command.Panel(PanelKind.BATTERY)
        if (full(c, "(?:открой |зайди в )?настройки(?: телефона)?|параметры")) return Command.Panel(PanelKind.SETTINGS)
        if (has(c, "(?:настройки звука|звуковые настройки)")) return Command.Panel(PanelKind.SOUND)

        // ---------- камера, экран ----------
        if (has(c, "(?:селфи|фронтальн)")) return Command.Selfie
        if (has(c, "(?:скриншот|скрин|снимок экрана|заскринь|сфоткай экран)")) return Command.Screenshot
        if (has(c, "(?:^камера$|открой камеру|включи камеру|сфотографируй|сфоткай|сделай фото|сделай снимок|сделай фотку|сфотай|фотоаппарат|запусти камеру|сними фото)")) return Command.Camera
        if (has(c, "(?:заблокируй|блокировка экрана|выключи экран|погаси экран|заблокировать|блокируй)")) return Command.LockScreen
        if (full(c, "домой|на главный экран|главный экран|на рабочий стол|сверни|сверни все|закрой|закрой приложение|выйди|выход")) return Command.GoHome
        if (full(c, "назад|вернись назад|верни назад|шаг назад")) return Command.GoBack

        // ---------- время, дата, заряд ----------
        if (has(c, "^(?:который час|сколько времени|сколько сейчас времени|какое время|время|сколько время|скажи время|покажи время|который сейчас час|текущее время)$")) return Command.ShowTime
        if (has(c, "^(?:какое (?:сегодня )?число|какая (?:сегодня )?дата|какой (?:сегодня )?день(?: недели)?|сегодня какое число|дата|число|какое число сегодня|какой день|покажи дату|какой сегодня день)$")) return Command.ShowDate
        if (has(c, "(?:заряд|батаре|аккумулятор|сколько процентов|сколько осталось заряда)")) return Command.ShowBattery

        // ---------- будильник, таймер, напоминание ----------
        if (has(c, "(?:будильник|разбуди|подними меня|подъем в)")) {
            if (has(c, "(?:выключи|отключи|отмени|убери|удали) будильник")) return Command.OpenApp("будильник")
            val dur = if (has(d, "через")) TimeParse.duration(d) else null
            if (dur != null) return Command.AlarmIn(dur)
            val clk = TimeParse.clock(d)
            if (clk != null) return Command.Alarm(TimeParse.hour24(clk), clk.minute, clk.dayOffset)
            return Command.AlarmMissingTime
        }
        if (has(c, "(?:таймер|засеки|засечь|отсчет|отсчитай|поставь время)")) {
            val dur = TimeParse.duration(d) ?: return Command.TimerMissingTime
            return Command.Timer(dur)
        }
        Regex("^(?:напомни|напомнить|напоминание|поставь напоминание|создай напоминание|сделай напоминание|не дай мне забыть)(?: мне)?(?: (.*))?$").find(d)?.let { m ->
            return parseReminder(m.groupValues.getOrNull(1) ?: "", now)
        }

        // ---------- калькулятор ----------
        Calc.tryParse(d)?.let { (expr, value) -> return Command.Calculate(expr, value) }

        // ---------- интернет ----------
        if (has(c, "(?:ютуб|youtube|ютьюб|ютюб|ю туб|you tube)")) {
            val q = c.replace(Regex("(?:на |в )?(?:ютуб[\\p{L}\\d]*|youtube|ютьюб[\\p{L}\\d]*|ютюб[\\p{L}\\d]*|ю туб[\\p{L}\\d]*|you tube)"), " ")
                .replace(Regex("^\\s*(?:открой|включи|найди|поищи|покажи|запусти|зайди|поставь)(?= |$)"), " ")
                .replace(Regex("\\s+"), " ").trim()
                .removePrefix("видео ").removePrefix("ролик ").removePrefix("про ").trim()
            return Command.YouTube(q.ifEmpty { null })
        }
        if (has(c, "погод")) {
            val place = Regex("(?:погода|погоду|погоды) (.+)$").find(c)?.groupValues?.get(1)
                ?.removePrefix("в ")?.removePrefix("во ")?.removePrefix("на ")?.trim()
            return Command.Weather(place?.ifEmpty { null })
        }
        Regex("^(?:найди|включи|покажи|поставь|запусти|хочу посмотреть|давай посмотрим|посмотрим|открой|поищи)(?: мне)? (?:фильм|кино|сериал|мультфильм|мультик)(?: про)? (.+)$").find(c)?.let {
            return Command.Movie(it.groupValues[1])
        }
        Regex("^(?:построй маршрут|проложи маршрут|маршрут|как доехать|как добраться|как дойти|отвези меня|вези меня|навигация|веди меня|поехали|едем|поехали в|дорога)(?: (?:до|к|в|на|ко))? (.+)$").find(c)?.let {
            return Command.Maps(it.groupValues[1], navigate = true)
        }
        Regex("^(?:где ближайш[\\p{L}\\d]*|найди на карте|покажи на карте|где находится|где тут|найди рядом|ближайш[\\p{L}\\d]*|открой на карте|покажи где)(?: (.+))$").find(c)?.let {
            val q = if (c.startsWith("где ближайш") || c.startsWith("ближайш")) c.removePrefix("где ") else it.groupValues[1]
            return Command.Maps(q, navigate = false)
        }
        if (full(c, "новости|покажи новости|что нового|что нового в мире|последние новости|что в мире происходит|свежие новости")) return Command.News
        Regex("^(?:найди|поищи|загугли|погугли|гугл|поиск|ищи|найти|узнай|посмотри|найди мне|поищи мне|глянь)(?: в (?:интернете|гугле|яндексе|сети|браузере))?(?: (?:про|о|об|информацию о|информацию про))? (.+)$").find(c)?.let {
            return Command.WebSearch(it.groupValues[1])
        }

        // ---------- приложения ----------
        Regex("^(?:открой|запусти|включи|открыть|запустить|зайди в|перейди в|покажи|врубай|вруби|давай)(?: (?:приложение|программу|прогу))? (.+)$").find(c)?.let {
            return Command.OpenApp(it.groupValues[1])
        }
        Regex("^(.+?) (?:открой|запусти)$").find(c)?.let { return Command.OpenApp(it.groupValues[1]) }

        // ---------- вопрос → поиск ----------
        if (has(c, "^(?:что такое|кто такой|кто такая|кто такие|что значит|что означает|как сделать|как приготовить|как называется|сколько стоит|сколько лет|сколько весит|почему|зачем|когда|где|как|какой|какая|какое|какие|что|кто|сколько|чем|откуда|куда) .+")) {
            return Command.WebSearch(c)
        }
        return Command.Unknown(c)
    }

    // ---------------- память ----------------

    private fun parseMemory(c: String): Command? {
        if (full(c, "что ты помнишь|покажи память|что ты знаешь|что ты знаешь обо мне|что ты запомнил|память|моя память|открой память")) return Command.ShowMemory
        val patterns = listOf(
            "^(?:запомни|запиши|учти|сохрани|знай)(?: что| себе)? (.+?) (?:это|значит|означает|равно|теперь) (?:контакт |номер |приложение |человек )?(.+)$",
            "^(?:когда я говорю|когда говорю|если я говорю|если скажу|когда я скажу) (.+?) (?:это|то это|имей в виду|значит|звони|набирай|то) (?:контакт |номер )?(.+)$",
            "^(.+?) (?:записан|записана|записано|сохранен|сохранена|сохранено|подписан|подписана|подписано)(?: у меня)?(?: в контактах)? (?:как|под именем|под названием) (.+)$",
            "^(.+?) это (?:контакт|номер|приложение) (.+)$",
            "^(.+?) это (?:у меня )?в контактах (.+)$",
        )
        for (p in patterns) {
            val m = Regex(p).find(c) ?: continue
            val alias = m.groupValues[1].trim().removePrefix("что ").trim()
            val target = m.groupValues[2].trim().removePrefix("что ").trim()
            if (alias.isNotEmpty() && target.isNotEmpty() && alias != target) return Command.Remember(alias, target)
        }
        if (c != "забудь это") {
            Regex("^(?:забудь|удали из памяти|сотри из памяти|сотри|удали запись)(?: про| что| о| об)? (.+)$").find(c)?.let {
                return Command.Forget(it.groupValues[1])
            }
        }
        return null
    }

    // ---------------- сообщения ----------------

    private val messengerRe = Regex("(?:в |через |по )?(ватсап[\\p{L}\\d]*|вотсап[\\p{L}\\d]*|ватцап[\\p{L}\\d]*|whatsapp|вацап[\\p{L}\\d]*|телеграм[\\p{L}\\d]*|телегу|телеге|телега|telegram|тг|вайбер[\\p{L}\\d]*|viber)")

    private fun parseMessage(c: String): Command? {
        val m = Regex("^(?:напиши|отправь|пошли|скинь|написать|отправить|послать|черкни|набери сообщение|сообщи|передай|ответь)(?: (.*))?$").find(c) ?: return null
        var rest = (m.groupValues.getOrNull(1) ?: "").trim()
        if (c.startsWith("набери сообщение")) rest = c.removePrefix("набери сообщение").trim()
        // «ответь» без продолжения — это ответ на звонок, обработан раньше
        var app: MessengerApp? = null
        messengerRe.find(rest)?.let { mm ->
            val w = mm.groupValues[1]
            app = when {
                w.startsWith("тел") || w == "telegram" || w == "тг" -> MessengerApp.TELEGRAM
                w.startsWith("вайб") || w == "viber" -> MessengerApp.VIBER
                else -> MessengerApp.WHATSAPP
            }
            rest = (rest.substring(0, mm.range.first) + " " + rest.substring(mm.range.last + 1)).replace(Regex("\\s+"), " ").trim()
        }
        rest = rest.replace(Regex("^(?:мне )?(?:смс|sms|эсэмэс[\\p{L}\\d]*|смску|сообщение|сообщения|сообщеньку|текст|письмо|эсэмэску)(?: |$)"), "").trim()
        rest = rest.removePrefix("для ").trim()

        var who: String? = null
        var text: String? = null
        if (rest.isNotEmpty()) {
            val sep = Regex(" (?:что|чтобы|текст|следующее|со словами|с текстом|мол) ").find(" $rest ")
            if (sep != null) {
                val idx = sep.range.first
                val before = " $rest ".substring(0, idx).trim()
                val after = " $rest ".substring(sep.range.last + 1).trim()
                who = before.ifEmpty { null }
                text = after.ifEmpty { null }
                if (sep.value.trim() == "чтобы" && text != null) text = "Пожалуйста, $text"
            } else {
                val ws = rest.split(' ')
                // «напиши маме привет» → кому: первое слово, текст: остальное
                // «напиши саше иванову привет» → кому: два слова, если второе похоже на фамилию в дательном
                var take = 1
                if (ws.size >= 3 && Regex("(?:ову|еву|ину|ыну|ой|ому|ему|ской|скому|ой)$").containsMatchIn(ws[1])) take = 2
                who = ws.take(take).joinToString(" ")
                text = ws.drop(take).joinToString(" ").ifEmpty { null }
            }
        }
        who = who?.removePrefix("на номер ")?.trim()?.ifEmpty { null }
        val a = app
        return if (a != null) Command.Messenger(a, who, text) else Command.Sms(who, text)
    }

    // ---------------- напоминания ----------------

    private fun parseReminder(restIn: String, now: Calendar): Command {
        var rest = " $restIn "
        var inSeconds: Long? = null
        var at: Long? = null
        // «через 10 минут»
        Regex(" через ((?:\\d+(?:\\.\\d+)? (?:секунд[\\p{L}\\d]*|сек|минут[\\p{L}\\d]*|мин|час[\\p{L}\\d]*) ?)+|полчаса|полтора часа|час(?: \\d+)?|минуту|пару минут) ").find(rest)?.let { m ->
            inSeconds = TimeParse.duration("через " + m.groupValues[1])
            rest = rest.replace(m.value, " ")
        }
        if (inSeconds == null) {
            val clk = TimeParse.clock(rest.trim())
            if (clk != null) {
                at = TimeParse.nextMillis(clk, now)
                rest = rest
                    .replace(Regex(" (?:послезавтра|завтра|сегодня) "), " ")
                    .replace(Regex(" (?:в|на|к) (?:половин[аеу] \\S+|\\d{1,2}:\\d{2}|\\d{1,2}(?: час[\\p{L}\\d]*)?(?: \\d{1,2}(?: минут[\\p{L}\\d]*)?)?) "), " ")
                    .replace(Regex(" \\d{1,2}:\\d{2} "), " ")
                    .replace(Regex(" (?:утра|утром|вечера|вечером|дня|днем|ночи|ночью|в полдень|в полночь) "), " ")
            } else if (rest.contains(" завтра ")) {
                val cal = (now.clone() as Calendar).apply {
                    add(Calendar.DAY_OF_YEAR, 1); set(Calendar.HOUR_OF_DAY, 9); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0)
                }
                at = cal.timeInMillis
                rest = rest.replace(" завтра ", " ")
            }
        }
        var text = rest.replace(Regex("\\s+"), " ").trim()
        text = text.replace(Regex("^(?:мне |о том что |о том чтобы |что |чтобы |про |о |об |нужно |надо |необходимо )+"), "").trim()
        return Command.Reminder(text, at, inSeconds)
    }
}
