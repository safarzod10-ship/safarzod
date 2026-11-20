package com.safarzod.jarvis.nlu

/**
 * Превращает надиктованное «напиши маме, что я не приду» в готовое сообщение:
 * «Привет, мама! Я не приду.» Работает без нейросети; нейросеть (если есть) переписывает ещё естественнее.
 */
object Compose {

    private val formal = setOf("босс", "начальник", "шеф", "руководитель")
    private val pronounToYou = mapOf("она" to "ты", "он" to "ты", "они" to "вы")

    /** Как обратиться к адресату: «мама», «Саша». null — обращаться без имени. */
    fun addressee(spokenWho: String?, contactName: String?): String? {
        val first = spokenWho?.let { Text.normalize(it).split(' ').firstOrNull { w -> w.isNotBlank() } }
        if (first != null) {
            val lemma = Names.nominative(first, contactName?.split(' ') ?: emptyList())
            if (lemma in formal) return null
            return if (Names.kin.containsKey(lemma)) lemma else lemma.replaceFirstChar { it.uppercase() }
        }
        val c = contactName?.trim()?.split(' ')?.firstOrNull()?.takeIf { w -> w.isNotBlank() && w.all { it.isLetter() } } ?: return null
        return if (c.any { it in 'а'..'я' || it in 'А'..'Я' }) c else null
    }

    fun isFormal(spokenWho: String?): Boolean {
        val first = spokenWho?.let { Text.normalize(it).split(' ').firstOrNull { w -> w.isNotBlank() } } ?: return false
        return Names.nominative(first) in formal
    }

    fun message(raw: String, spokenWho: String?, contactName: String?, greet: Boolean = true): String {
        var body = raw.trim().replace(Regex("\\s+"), " ")
        // «чтобы она купила хлеб» → «Нужно, чтобы ты купила хлеб»
        Regex("^чтобы (она|он|они) (.+)$").find(body)?.let { m ->
            body = "нужно, чтобы ${pronounToYou[m.groupValues[1]]} ${m.groupValues[2]}"
        }
        if (body.startsWith("чтобы ")) body = "нужно, $body"
        body = Text.sentence(body)
        if (!greet) return body
        if (Regex("^(привет|здравствуй|добрый|доброе|доброй|хай|салют)", RegexOption.IGNORE_CASE).containsMatchIn(body)) return body
        if (isFormal(spokenWho)) return "Здравствуйте! $body"
        val who = addressee(spokenWho, contactName)
        return if (who != null) "Привет, $who! $body" else "Привет! $body"
    }
}
