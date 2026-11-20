package com.safarzod.jarvis.nlu

/** Имена и родственные обращения: падежи, синонимы, нечёткое сравнение с контактами. */
object Names {

    /** Родственные и бытовые обращения → как их обычно записывают в контактах. */
    val kin: Map<String, List<String>> = mapOf(
        "мама" to listOf("мама", "мамуля", "мамочка", "мам", "мать", "маман", "mom", "mama", "mum", "mommy", "mother", "mamma"),
        "папа" to listOf("папа", "папуля", "пап", "отец", "батя", "папочка", "dad", "papa", "father", "daddy"),
        "жена" to listOf("жена", "женушка", "любимая", "wife", "wifey", "my love", "love"),
        "муж" to listOf("муж", "любимый", "husband", "hubby", "my love", "love"),
        "брат" to listOf("брат", "братик", "братишка", "brother", "bro"),
        "сестра" to listOf("сестра", "сестренка", "сеструха", "sister", "sis"),
        "бабушка" to listOf("бабушка", "бабуля", "баба", "ба", "grandma", "granny", "grandmother", "nana"),
        "дедушка" to listOf("дедушка", "дед", "деда", "дедуля", "grandpa", "grandfather", "grandad"),
        "сын" to listOf("сын", "сынок", "сынуля", "son"),
        "дочь" to listOf("дочь", "дочка", "доча", "дочурка", "daughter"),
        "тетя" to listOf("тетя", "тетушка", "aunt", "auntie"),
        "дядя" to listOf("дядя", "uncle"),
        "босс" to listOf("босс", "начальник", "шеф", "руководитель", "boss", "chief"),
        "любимая" to listOf("любимая", "любимка", "зайка", "солнце", "my love", "love", "darling", "honey"),
        "любимый" to listOf("любимый", "my love", "love", "darling", "honey"),
    )

    /** Падежные формы обращений → начальная форма (для частых слов надёжнее правил). */
    private val kinForms: Map<String, String> = buildMap {
        fun add(base: String, vararg forms: String) { put(base, base); forms.forEach { put(it, base) } }
        add("мама", "маме", "маму", "мамы", "мамой", "мамочке", "мамочку", "мамуле", "мамулю", "матери", "мать")
        add("папа", "папе", "папу", "папы", "папой", "отцу", "отца", "отцом", "бате", "батю", "бати")
        add("жена", "жене", "жену", "жены", "женой")
        add("муж", "мужу", "мужа", "мужем")
        add("брат", "брату", "брата", "братом", "братику", "братишке")
        add("сестра", "сестре", "сестру", "сестры", "сестрой", "сестренке", "сеструхе")
        add("бабушка", "бабушке", "бабушку", "бабушки", "бабуле", "бабулю", "бабе", "бабу")
        add("дедушка", "дедушке", "дедушку", "дедушки", "деду", "деда", "дедуле")
        add("сын", "сыну", "сына", "сыном", "сынку", "сынок")
        add("дочь", "дочери", "дочке", "дочку", "доче", "дочу")
        add("тетя", "тете", "тетю", "тети", "тетей")
        add("дядя", "дяде", "дядю", "дяди", "дядей")
        add("босс", "боссу", "босса", "начальнику", "начальника", "шефу", "шефа")
        add("любимая", "любимой", "любимую")
        add("любимый", "любимому", "любимого")
    }

    /**
     * Возможные начальные формы слова в косвенном падеже.
     * «маше» → маша, «сергею» → сергей, «игорю» → игорь, «ивану» → иван, «марии» → мария.
     */
    fun lemmas(word: String): List<String> {
        val w = word.lowercase().replace('ё', 'е')
        if (w.isEmpty()) return listOf(w)
        kinForms[w]?.let { return listOf(it) }
        val out = LinkedHashSet<String>()
        out += w
        fun stem(n: Int) = if (w.length > n + 1) w.dropLast(n) else null
        when {
            w.endsWith("ии") || w.endsWith("ию") -> stem(1)?.let { out += it + "я" }
            w.endsWith("ией") -> stem(2)?.let { out += it + "я" }
        }
        when {
            w.endsWith("ею") || w.endsWith("ея") || w.endsWith("еем") -> stem(if (w.endsWith("еем")) 3 else 2)?.let { out += it + "ей" }
            w.endsWith("аю") || w.endsWith("ая") -> stem(2)?.let { out += it + "ай" }
        }
        when {
            w.endsWith("ой") || w.endsWith("ей") || w.endsWith("ою") -> stem(2)?.let { out += it + "а"; out += it + "я" }
            w.endsWith("ом") || w.endsWith("ем") -> stem(2)?.let { out += it; out += it + "ь" }
        }
        val last = w.last()
        when (last) {
            'е', 'у', 'ы', 'и' -> stem(1)?.let { out += it + "а"; out += it + "я"; out += it }
            'ю' -> stem(1)?.let { out += it + "я"; out += it + "ь"; out += it + "й" }
            'а' -> stem(1)?.let { out += it }           // ивана → иван
            'я' -> stem(1)?.let { out += it + "ь"; out += it + "й" } // игоря → игорь, сергея → сергей
        }
        return out.toList()
    }

    /** Частые русские имена (в т.ч. уменьшительные) — чтобы угадать именительный падеж: «кате» → «катя». */
    private val commonNames: Set<String> = """
        саша маша катя таня ваня петя коля оля юля аня даша настя лена наташа дима миша сережа женя леша
        андрей сергей алексей игорь иван артем максим никита денис роман олег антон павел паша костя кирилл
        егор илья влад вова володя витя толя гоша гриша федя рома стас слава тима тимур руслан ренат марат
        ира ольга ирина анна мария марина света светлана вера надя люба галя валя нина зина рита алла жанна
        вика лиза соня полина алина кристина ксюша ксения диана карина яна аля зоя ева милана вероника
        алина эля лиля нюра люда люся тоня тома варя дуся мила кира лера ульяна юлия екатерина татьяна
        наталья елена анастасия дарья евгения александра виктория валентина людмила галина ангелина
        александр дмитрий михаил николай владимир виктор евгений юрий василий петр анатолий геннадий
        валерий борис константин станислав вячеслав григорий леонид аркадий эдуард вадим тимофей семен
        фарход рустам бахтиер шахзод сардор жасур азиз алишер бекзод улугбек дилшод акмал санжар
        """.trim().split(Regex("\\s+")).toSet()

    /** Начальная форма для обращения: «маме» → «мама», «саше» → «саша», «игорю» → «игорь». */
    fun nominative(word: String, contactTokens: Collection<String> = emptyList()): String {
        val w = word.lowercase().replace('ё', 'е')
        val ls = lemmas(w)
        kinForms[w]?.let { return it }
        val tokens = contactTokens.map { it.lowercase().replace('ё', 'е') }.toSet()
        ls.firstOrNull { it in tokens }?.let { return it }
        ls.firstOrNull { it in commonNames }?.let { return it }
        // без словаря: «е/и/у» на конце — скорее всего «а» (Лена, Дима), «ю» — «й/ь»
        return ls.getOrNull(1) ?: w
    }

    /** Все варианты, как обращение могло быть записано в контактах. */
    fun expansions(query: String): List<String> {
        val words = query.split(' ').filter { it.isNotBlank() }
        if (words.size == 1) {
            val ls = lemmas(words[0])
            val out = LinkedHashSet<String>(ls)
            ls.forEach { l -> kin[l]?.let { out.addAll(it) } }
            return out.toList()
        }
        return listOf(words.joinToString(" ") { lemmas(it).first() }) + listOf(query)
    }

    /** Похожесть запроса на имя контакта, 0..1. */
    fun score(query: String, contactName: String): Double {
        val name = Text.normalize(contactName)
        if (name.isEmpty()) return 0.0
        val tokens = name.split(' ').filter { it.isNotEmpty() }
        val qWords = Text.normalize(query).split(' ').filter { it.isNotEmpty() }
        if (qWords.isEmpty()) return 0.0

        // полное совпадение строки
        if (name == Text.normalize(query)) return 1.0

        var sum = 0.0
        for (qw in qWords) {
            var best = 0.0
            val variants = lemmas(qw)
            val kinVariants = variants.flatMap { kin[it] ?: emptyList() }
            for (t in tokens) {
                for (v in variants) {
                    best = maxOf(best, tokenScore(v, t))
                }
                for (k in kinVariants) {
                    val s = if (k.contains(' ')) (if (name.contains(k)) 0.95 else 0.0) else tokenScore(k, t) * 0.97
                    best = maxOf(best, s)
                }
            }
            sum += best
        }
        var s = sum / qWords.size
        // небольшой штраф, если в контакте много лишних слов
        if (tokens.size > qWords.size) s -= 0.02 * (tokens.size - qWords.size)
        return s.coerceIn(0.0, 1.0)
    }

    private fun tokenScore(q: String, t: String): Double {
        if (q == t) return 1.0
        val lq = Text.latin(q)
        val lt = Text.latin(t)
        if (lq.isEmpty() || lt.isEmpty()) return 0.0
        if (lq == lt) return 0.96
        if (q.length >= 3 && t.startsWith(q)) return 0.86
        if (lq.length >= 3 && lt.startsWith(lq)) return 0.84
        val sim = Text.similarity(lq, lt)
        return if (sim >= 0.6) sim * 0.88 else 0.0
    }
}
