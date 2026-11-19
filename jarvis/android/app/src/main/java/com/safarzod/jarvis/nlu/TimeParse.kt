package com.safarzod.jarvis.nlu

import java.util.Calendar

/** Разбор длительностей («через 10 минут», «на полчаса») и времени («в 7:30 утра», «в половине восьмого»). */
object TimeParse {

    data class Clock(val hour: Int, val minute: Int, val period: Period?, val dayOffset: Int)

    enum class Period { MORNING, DAY, EVENING, NIGHT }

    private val genitiveHour = mapOf(
        "первого" to 1, "второго" to 2, "третьего" to 3, "четвертого" to 4, "пятого" to 5, "шестого" to 6,
        "седьмого" to 7, "восьмого" to 8, "девятого" to 9, "десятого" to 10, "одиннадцатого" to 11, "двенадцатого" to 12,
    )

    /** Длительность в секундах или null. Текст — нормализованный и с цифрами (Text.digitize). */
    fun duration(t: String): Long? {
        val s = " $t "
        var total = 0L
        var found = false
        val fixed = listOf(
            " полчаса " to 1800L, " полтора часа " to 5400L, " полторы минуты " to 90L,
            " четверть часа " to 900L, " пару минут " to 120L, " пару секунд " to 2L,
        )
        for ((k, v) in fixed) if (s.contains(k)) { total += v; found = true }
        val num = Regex("(\\d+(?:\\.\\d+)?) (секунд[\\p{L}\\d]*|сек|минут[\\p{L}\\d]*|мин|час[\\p{L}\\d]*)(?= )")
        for (m in num.findAll(s)) {
            val v = m.groupValues[1].toDouble()
            val unit = m.groupValues[2]
            total += when {
                unit.startsWith("сек") -> v
                unit.startsWith("мин") -> v * 60
                else -> v * 3600
            }.toLong()
            found = true
        }
        // «на час», «через час 20» — «час» без числа перед ним
        val bare = Regex(" (?:(?:на|через|в течение|за) )?час(?: (\\d+)( минут[\\p{L}\\d]*| мин)?)? ").find(s)
        if (bare != null && !s.contains(" полчаса ") && !s.contains(" полтора часа ")) {
            total += 3600
            val extra = bare.groupValues[1]
            if (extra.isNotEmpty() && bare.groupValues[2].isEmpty()) total += (extra.toLongOrNull() ?: 0L).coerceAtMost(10_000) * 60
            found = true
        }
        if (!found) {
            when {
                Regex(" (?:на|через) минуту ").containsMatchIn(s) -> { total = 60; found = true }
                Regex(" (?:на|через) секунду ").containsMatchIn(s) -> { total = 1; found = true }
            }
        }
        return if (found && total > 0) total.coerceAtMost(7L * 24 * 3600) else null
    }

    /** Время на часах или null. */
    fun clock(t: String): Clock? {
        val s = " $t "
        val dayOffset = when {
            s.contains(" послезавтра ") -> 2
            s.contains(" завтра ") -> 1
            else -> 0
        }
        val period = when {
            Regex(" (утра|утром) ").containsMatchIn(s) -> Period.MORNING
            Regex(" (дня|днем) ").containsMatchIn(s) -> Period.DAY
            Regex(" (вечера|вечером) ").containsMatchIn(s) -> Period.EVENING
            Regex(" (ночи|ночью) ").containsMatchIn(s) -> Period.NIGHT
            else -> null
        }
        if (s.contains(" в полдень ") || s.contains(" на полдень ")) return Clock(12, 0, null, dayOffset)
        if (s.contains(" в полночь ") || s.contains(" на полночь ")) return Clock(0, 0, null, if (dayOffset == 0) 1 else dayOffset)

        // «в половине восьмого» → 7:30
        Regex(" половин[аеу] ([\\p{L}\\d]+) ").find(s)?.let { m ->
            val h = genitiveHour[m.groupValues[1]] ?: m.groupValues[1].toIntOrNull()
            if (h != null) return Clock((h - 1 + 24) % 24, 30, period, dayOffset)
        }
        // «без пятнадцати восемь», «без 15 8» → 7:45
        Regex(" без (\\d+|четверти) (?:минут )?(\\d+) ").find(s)?.let { m ->
            val minus = if (m.groupValues[1] == "четверти") 15 else m.groupValues[1].toIntOrNull() ?: -1
            val h = m.groupValues[2].toIntOrNull() ?: -1
            if (minus in 1..59 && h in 0..24) return Clock((h - 1 + 24) % 24, 60 - minus, period, dayOffset)
        }
        // «7:30», «в 7 30», «на 7 часов 30 минут», «в 7», «к 9»
        val patterns = listOf(
            Regex(" (\\d{1,2}):(\\d{2}) "),
            Regex(" (?:в|на|к|до) (\\d{1,2}) (?:час[\\p{L}\\d]* )?(\\d{1,2}) ?(?:минут[\\p{L}\\d]*)? "),
            Regex(" (?:в|на|к|до) (\\d{1,2}) (?:час[\\p{L}\\d]*)? ?"),
            Regex(" (\\d{1,2}) (?:час[\\p{L}\\d]* )(\\d{1,2}) ?(?:минут[\\p{L}\\d]*)? "),
            Regex(" (\\d{1,2}) (?:час[\\p{L}\\d]*) "),
        )
        for (re in patterns) {
            val m = re.find(s) ?: continue
            val h = m.groupValues[1].toInt()
            val mi = m.groupValues.getOrNull(2)?.takeIf { it.isNotEmpty() }?.toInt() ?: 0
            if (h !in 0..24 || mi !in 0..59) continue
            // «на 5 минут» — это длительность, не время
            val after = s.substring(m.range.last).trimStart()
            if (m.groupValues.getOrNull(2).isNullOrEmpty() && Regex("^(минут|мин|секунд|сек)").containsMatchIn(after)) continue
            return Clock(h % 24, mi, period, dayOffset)
        }
        return null
    }

    /** Час в 24-часовом формате с учётом «утра/дня/вечера/ночи». Без уточнения — как сказано. */
    fun hour24(c: Clock): Int {
        val h = c.hour
        return when (c.period) {
            Period.MORNING -> if (h == 12) 0 else h
            Period.DAY -> if (h in 1..11) h + 12 else h
            Period.EVENING -> if (h in 1..11) h + 12 else h
            Period.NIGHT -> if (h == 12) 0 else if (h in 6..11) h + 12 else h
            null -> h
        }.let { if (it == 24) 0 else it }
    }

    /**
     * Ближайший момент времени для напоминания. Без «утра/вечера» для часов 1..11 выбираем
     * ближайшее будущее из h и h+12.
     */
    fun nextMillis(c: Clock, now: Calendar = Calendar.getInstance()): Long {
        val base = now.clone() as Calendar
        base.set(Calendar.SECOND, 0)
        base.set(Calendar.MILLISECOND, 0)
        fun at(h: Int): Calendar = (base.clone() as Calendar).apply {
            add(Calendar.DAY_OF_YEAR, c.dayOffset)
            set(Calendar.HOUR_OF_DAY, h)
            set(Calendar.MINUTE, c.minute)
        }
        val h = hour24(c)
        val candidates = mutableListOf(at(h))
        if (c.period == null && h in 1..11) candidates += at(h + 12)
        val future = candidates.filter { it.after(now) }.minByOrNull { it.timeInMillis }
        if (future != null) return future.timeInMillis
        // всё в прошлом — на следующий день
        return at(h).apply { add(Calendar.DAY_OF_YEAR, 1) }.timeInMillis
    }
}
