package com.safarzod.jarvis.core

import com.safarzod.jarvis.nlu.Text
import com.safarzod.jarvis.voice.SpeechEngine
import kotlin.math.sqrt

/**
 * Настройка под голос владельца: человек читает несколько фраз, Джарвис подстраивает
 * чувствительность к «Джарвис», запоминает, как распознаватель слышит обращение у этого человека,
 * и сохраняет отпечаток голоса (для режима «только мой голос»). Читать дословно не нужно.
 */
class VoiceCalibration(private val settings: Settings) {

    val phrases = listOf(
        "Джарвис, позвони маме",
        "Джарвис, какая сегодня погода?",
        "Джарвис, напиши брату, что я задержусь",
        "Джарвис, поставь будильник на семь утра",
        "Джарвис, включи фонарик",
    )

    data class Summary(
        val accuracy: Int,          // % слов, распознанных верно
        val wakeOk: Int,            // из скольких фраз уверенно услышано «Джарвис»
        val total: Int,
        val variants: List<String>, // свои варианты обращения
        val hasVoiceprint: Boolean,
        val sensitivity: Float,
    )

    /** Насколько распознанное похоже на фразу (0..1), без учёта обращения и падежных хвостов. */
    fun score(expected: String, heard: String): Double {
        val e = Text.words(expected).drop(1).map { it.take(5) }
        val h = Text.words(heard).map { it.take(5) }.toMutableList()
        if (e.isEmpty()) return 1.0
        var hit = 0
        for (w in e) {
            val i = h.indexOfFirst { it == w || Text.similarity(it, w) >= 0.75 }
            if (i >= 0) { hit++; h.removeAt(i) }
        }
        return hit.toDouble() / e.size
    }

    fun finish(results: List<Pair<String, SpeechEngine.Enrollment>>): Summary {
        val enr = results.map { it.second }
        // 1) чувствительность: порог уверенности должен пропускать самое «неуверенное» обращение этого человека
        val confs = enr.mapNotNull { it.wakeConf }
        val sens = if (confs.isEmpty()) 0.85f else {
            val worst = confs.min()
            (((0.92 - worst * 0.95) / 0.3).toFloat()).coerceIn(0.35f, 0.95f)
        }
        settings.sensitivity.value = sens

        // 2) как распознаватель слышит «Джарвис» у этого человека
        val firsts = enr.mapNotNull { it.firstWord }.filter { it != "джарвис" && it.length >= 4 && Text.similarity(Text.latin(it), Text.latin("джарвис")) >= 0.45 }
        val variants = firsts.groupingBy { it }.eachCount().filter { it.value >= 1 }.keys.take(3).toList()
        settings.wakeVariants.value = variants.joinToString(",")

        // 3) отпечаток голоса: среднее нормированных векторов
        val vecs = enr.mapNotNull { it.spk }.filter { it.isNotEmpty() }.map { normalize(it) }
        if (vecs.size >= 2) {
            val avg = FloatArray(vecs[0].size)
            for (v in vecs) for (i in avg.indices) avg[i] += v[i] / vecs.size
            val center = normalize(avg)
            val self = vecs.map { cosine(it, center) }.average()
            settings.voiceprint.value = center.joinToString(",") { "%.5f".format(java.util.Locale.US, it) }
            settings.ownerThreshold.value = (self - 0.22).toFloat().coerceIn(0.25f, 0.75f)
        }

        // 4) уровень речи — для визуализации и порога «голос/тишина»
        enr.map { it.speechRms }.filter { it > 0 }.sorted().let { if (it.isNotEmpty()) settings.speechLevel.value = it[it.size / 2] }

        val acc = results.map { (exp, e) -> score(exp, e.text) }.average()
        settings.calibrated.value = true
        return Summary(
            accuracy = (acc * 100).toInt(),
            wakeOk = confs.count { it >= 0.92 - sens * 0.3 },
            total = results.size,
            variants = variants,
            hasVoiceprint = vecs.size >= 2,
            sensitivity = sens,
        )
    }

    companion object {
        fun normalize(v: FloatArray): FloatArray {
            val n = sqrt(v.sumOf { (it * it).toDouble() }).toFloat().coerceAtLeast(1e-6f)
            return FloatArray(v.size) { v[it] / n }
        }

        fun cosine(a: FloatArray, b: FloatArray): Double {
            if (a.size != b.size) return 0.0
            var d = 0.0; var na = 0.0; var nb = 0.0
            for (i in a.indices) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
            return d / (sqrt(na) * sqrt(nb) + 1e-9)
        }

        fun parse(s: String): FloatArray? = s.split(',').mapNotNull { it.toFloatOrNull() }.takeIf { it.size >= 16 }?.toFloatArray()
    }
}
