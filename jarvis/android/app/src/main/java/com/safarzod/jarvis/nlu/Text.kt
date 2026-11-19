package com.safarzod.jarvis.nlu

/** Нормализация распознанного текста и работа с русскими числами. */
object Text {

    /**
     * Нижний регистр, ё→е, без пунктуации. Сохраняет «7:30», десятичную точку «2.5»
     * и знаки арифметики между числами.
     */
    fun normalize(s: String): String {
        val t = s.lowercase().replace('ё', 'е')
        val sb = StringBuilder(t.length + 8)
        for (i in t.indices) {
            val c = t[i]
            val prevDigit = i > 0 && t[i - 1].isDigit()
            val nextDigit = i + 1 < t.length && t[i + 1].isDigit()
            when {
                c.isLetterOrDigit() -> sb.append(c)
                c == ':' && prevDigit && nextDigit -> sb.append(':')
                (c == ',' || c == '.') && prevDigit && nextDigit -> sb.append('.')
                c == '+' || c == '*' || c == '×' || c == '/' || c == '÷' || c == '%' || c == '=' ->
                    sb.append(' ').append(when (c) { '×' -> '*'; '÷' -> '/'; else -> c }).append(' ')
                c == '-' && (prevDigit || (i > 0 && t[i - 1] == ' ')) && (nextDigit || (i + 1 < t.length && t[i + 1] == ' ')) ->
                    sb.append(" - ")
                else -> sb.append(' ')
            }
        }
        return sb.toString().replace(Regex("\\s+"), " ").trim()
    }

    fun words(s: String): List<String> = normalize(s).split(' ').filter { it.isNotEmpty() }

    // ---------- числа словами ----------

    private val units = mapOf(
        "ноль" to 0, "нуль" to 0,
        "один" to 1, "одна" to 1, "одну" to 1, "одно" to 1, "одного" to 1, "одной" to 1, "одним" to 1, "раз" to 1,
        "два" to 2, "две" to 2, "двух" to 2, "двум" to 2,
        "три" to 3, "трех" to 3, "трем" to 3,
        "четыре" to 4, "четырех" to 4,
        "пять" to 5, "пяти" to 5, "шесть" to 6, "шести" to 6, "семь" to 7, "семи" to 7,
        "восемь" to 8, "восьми" to 8, "девять" to 9, "девяти" to 9,
    )
    private val teens = mapOf(
        "десять" to 10, "десяти" to 10, "одиннадцать" to 11, "одиннадцати" to 11, "двенадцать" to 12, "двенадцати" to 12,
        "тринадцать" to 13, "тринадцати" to 13, "четырнадцать" to 14, "четырнадцати" to 14,
        "пятнадцать" to 15, "пятнадцати" to 15, "шестнадцать" to 16, "шестнадцати" to 16,
        "семнадцать" to 17, "семнадцати" to 17, "восемнадцать" to 18, "восемнадцати" to 18,
        "девятнадцать" to 19, "девятнадцати" to 19,
    )
    private val tens = mapOf(
        "двадцать" to 20, "двадцати" to 20, "тридцать" to 30, "тридцати" to 30, "сорок" to 40, "сорока" to 40,
        "пятьдесят" to 50, "пятидесяти" to 50, "шестьдесят" to 60, "шестидесяти" to 60,
        "семьдесят" to 70, "семидесяти" to 70, "восемьдесят" to 80, "восьмидесяти" to 80,
        "девяносто" to 90, "девяноста" to 90,
    )
    private val hundreds = mapOf(
        "сто" to 100, "ста" to 100, "двести" to 200, "двухсот" to 200, "триста" to 300, "трехсот" to 300,
        "четыреста" to 400, "четырехсот" to 400, "пятьсот" to 500, "пятисот" to 500, "шестьсот" to 600,
        "семьсот" to 700, "восемьсот" to 800, "девятьсот" to 900,
    )
    private val thousands = setOf("тысяча", "тысячи", "тысяч", "тысячу")

    private val ordinals = mapOf(
        "первый" to 1, "первая" to 1, "первое" to 1, "первого" to 1, "первую" to 1, "первому" to 1, "первом" to 1,
        "второй" to 2, "вторая" to 2, "второе" to 2, "второго" to 2, "вторую" to 2, "втором" to 2,
        "третий" to 3, "третья" to 3, "третье" to 3, "третьего" to 3, "третью" to 3, "третьем" to 3,
        "четвертый" to 4, "четвертая" to 4, "четвертого" to 4, "четвертую" to 4,
        "пятый" to 5, "пятая" to 5, "пятого" to 5, "пятую" to 5,
        "шестой" to 6, "шестая" to 6, "шестого" to 6, "шестую" to 6,
        "седьмой" to 7, "седьмого" to 7, "восьмой" to 8, "восьмого" to 8,
        "девятый" to 9, "девятого" to 9, "десятый" to 10, "десятого" to 10,
        "одиннадцатого" to 11, "двенадцатого" to 12, "последний" to -1, "последняя" to -1, "последнего" to -1, "последнему" to -1,
    )

    fun ordinal(word: String): Int? = ordinals[word]

    fun isNumberWord(w: String): Boolean =
        w in units || w in teens || w in tens || w in hundreds || w in thousands || w.all { it.isDigit() }

    /**
     * Заменяет числительные словами на цифры: «двадцать пять минут» → «25 минут».
     * Отдельно стоящее «раз» не трогаем, «полтора/полчаса» обрабатываются в разборе времени.
     */
    fun digitize(s: String): String {
        val ws = s.split(' ').filter { it.isNotEmpty() }
        val out = ArrayList<String>()
        var i = 0
        while (i < ws.size) {
            var total = 0
            var current = 0
            var prevRank: Int? = null
            var consumed = 0
            var j = i
            while (j < ws.size) {
                val x = ws[j]
                val rank = rankOf(x) ?: break
                if (rank == 4) {
                    if (current == 0 && consumed > 0 && total > 0) break
                    total += (if (current == 0) 1 else current) * 1000
                    current = 0
                    prevRank = null
                } else {
                    if (!canFollow(prevRank, rank)) break
                    current += valueOf(x)
                    prevRank = rank
                }
                j++; consumed++
            }
            if (consumed == 0) {
                out += ws[i]; i++
            } else {
                out += (total + current).toString()
                i = j
            }
        }
        return out.joinToString(" ")
    }

    private fun rankOf(x: String): Int? = when {
        x == "раз" -> null
        x in hundreds -> 3
        x in tens -> 2
        x in teens -> 1
        x in units -> 0
        x in thousands -> 4
        else -> null
    }

    private fun valueOf(x: String): Int = hundreds[x] ?: tens[x] ?: teens[x] ?: units[x] ?: 0

    /** «двадцать пять» и «сто двадцать» — одно число; «пять двадцать» — два (время 5:20). */
    private fun canFollow(prev: Int?, r: Int): Boolean = when (prev) {
        null -> true
        3 -> r in 0..2
        2 -> r == 0
        else -> false
    }

    // ---------- транслитерация (для сравнения «мом» ↔ «Mom») ----------

    private val ru2lat = mapOf(
        'а' to "a", 'б' to "b", 'в' to "v", 'г' to "g", 'д' to "d", 'е' to "e", 'ж' to "zh", 'з' to "z",
        'и' to "i", 'й' to "i", 'к' to "k", 'л' to "l", 'м' to "m", 'н' to "n", 'о' to "o", 'п' to "p",
        'р' to "r", 'с' to "s", 'т' to "t", 'у' to "u", 'ф' to "f", 'х' to "h", 'ц' to "ts", 'ч' to "ch",
        'ш' to "sh", 'щ' to "sch", 'ъ' to "", 'ы' to "y", 'ь' to "", 'э' to "e", 'ю' to "yu", 'я' to "ya",
    )

    /** Приводит строку к латинице в упрощённой «фонетической» форме для нечёткого сравнения. */
    fun latin(s: String): String {
        val sb = StringBuilder()
        for (c in s.lowercase().replace('ё', 'е')) {
            val m = ru2lat[c]
            when {
                m != null -> sb.append(m)
                c in 'a'..'z' || c.isDigit() -> sb.append(c)
                else -> sb.append(' ')
            }
        }
        // упрощения, чтобы английские имена совпадали с русской записью на слух
        return sb.toString()
            .replace("ph", "f").replace("w", "v").replace("x", "ks").replace("q", "k")
            .replace("ck", "k").replace("c", "k").replace("th", "t").replace("y", "i").replace("j", "dzh")
            .replace("ee", "i").replace("oo", "u").replace("ou", "u")
            .replace(Regex("(.)\\1+"), "$1")
            .replace(Regex("\\s+"), " ").trim()
    }

    fun levenshtein(a: String, b: String): Int {
        if (a == b) return 0
        if (a.isEmpty()) return b.length
        if (b.isEmpty()) return a.length
        var prev = IntArray(b.length + 1) { it }
        var cur = IntArray(b.length + 1)
        for (i in 1..a.length) {
            cur[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
            }
            val t = prev; prev = cur; cur = t
        }
        return prev[b.length]
    }

    /** Похожесть 0..1 по расстоянию Левенштейна. */
    fun similarity(a: String, b: String): Double {
        if (a.isEmpty() && b.isEmpty()) return 1.0
        val d = levenshtein(a, b)
        return 1.0 - d.toDouble() / maxOf(a.length, b.length)
    }

    /** Первая буква заглавная, точка в конце, если нет знака препинания. */
    fun sentence(s: String): String {
        val t = s.trim()
        if (t.isEmpty()) return t
        val first = t.substring(0, 1).uppercase() + t.substring(1)
        return if (first.last() in ".!?…)") first else "$first."
    }
}
