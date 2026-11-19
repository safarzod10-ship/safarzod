package com.safarzod.jarvis.nlu

import kotlin.math.abs
import kotlin.math.pow
import kotlin.math.roundToLong
import kotlin.math.sqrt

/** Голосовой калькулятор: «сколько будет 25 умножить на 4», «15 процентов от 200», «корень из 144». */
object Calc {

    private val opWords = listOf(
        "умноженное на" to "*", "умножить на" to "*", "умножь на" to "*", "помножить на" to "*", "помножь на" to "*",
        "разделить на" to "/", "деленное на" to "/", "поделить на" to "/", "делить на" to "/", "раздели на" to "/", "подели на" to "/",
        "плюс" to "+", "прибавить" to "+", "сложить с" to "+", "минус" to "-", "отнять" to "-", "вычесть" to "-",
        "в квадрате" to "^2", "в кубе" to "^3", "в степени" to "^",
        "процентов от" to "%of", "процента от" to "%of", "процент от" to "%of", "% от" to "%of",
        "корень из" to "sqrt", "квадратный корень из" to "sqrt",
        "умножить" to "*", "x" to "*", "х" to "*", "на" to "*", "раз по" to "*",
    )

    /** Пара «красивое выражение» → результат, или null, если это не арифметика. */
    fun tryParse(digitized: String): Pair<String, Double>? {
        var s = " " + digitized.trim() + " "
        s = s.replace(Regex("^ (?:сколько будет|сколько|посчитай|вычисли|подсчитай|реши|считай|калькулятор|скажи сколько будет) "), " ")
        s = s.replace(Regex(" (?:равно|будет|получится)\\s*$"), " ")
        if (!Regex("\\d").containsMatchIn(s)) return null
        for ((w, op) in opWords) s = s.replace(" $w ", " $op ")
        val tokens = s.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (tokens.isEmpty()) return null
        // разрешаем только числа и операторы
        val allowed = setOf("+", "-", "*", "/", "^", "^2", "^3", "%of", "sqrt", "%")
        if (tokens.any { it !in allowed && it.toDoubleOrNull() == null }) return null
        if (tokens.none { it in allowed && it != "%" }) return null
        return try {
            val p = P(tokens)
            val v = p.expr()
            if (p.i != tokens.size || v.isNaN() || v.isInfinite()) null
            else pretty(tokens) to v
        } catch (_: Exception) {
            null
        }
    }

    private class P(val t: List<String>) {
        var i = 0
        fun peek() = t.getOrNull(i)
        fun expr(): Double {
            var v = term()
            while (peek() == "+" || peek() == "-") {
                val op = t[i++]
                val r = term()
                v = if (op == "+") v + r else v - r
            }
            return v
        }
        fun term(): Double {
            var v = power()
            while (peek() == "*" || peek() == "/" || peek() == "%of") {
                val op = t[i++]
                val r = power()
                v = when (op) {
                    "*" -> v * r
                    "/" -> if (r == 0.0) Double.NaN else v / r
                    else -> v / 100.0 * r
                }
            }
            return v
        }
        fun power(): Double {
            var v = unary()
            while (true) {
                when (peek()) {
                    "^2" -> { i++; v = v * v }
                    "^3" -> { i++; v = v * v * v }
                    "^" -> { i++; v = v.pow(unary()) }
                    "%" -> { i++; v /= 100.0 }
                    else -> return v
                }
            }
        }
        fun unary(): Double {
            return when (peek()) {
                "-" -> { i++; -unary() }
                "sqrt" -> { i++; val x = unary(); if (x < 0) Double.NaN else sqrt(x) }
                else -> t[i++].toDouble()
            }
        }
    }

    private fun pretty(tokens: List<String>): String = tokens.joinToString(" ") {
        when (it) {
            "*" -> "×"; "/" -> "÷"; "-" -> "−"; "^2" -> "²"; "^3" -> "³"; "%of" -> "% от"; "sqrt" -> "√"
            else -> it
        }
    }.replace("√ ", "√").replace(" ²", "²").replace(" ³", "³")

    fun format(v: Double): String {
        if (abs(v - v.roundToLong()) < 1e-9 && abs(v) < 1e15) return groupDigits(v.roundToLong().toString())
        val s = "%.6f".format(java.util.Locale.US, v).trimEnd('0').trimEnd('.')
        val parts = s.split('.')
        return groupDigits(parts[0]) + if (parts.size > 1) "," + parts[1] else ""
    }

    private fun groupDigits(s: String): String {
        val neg = s.startsWith("-")
        val d = s.removePrefix("-")
        val sb = StringBuilder()
        for ((k, ch) in d.reversed().withIndex()) {
            if (k > 0 && k % 3 == 0) sb.append(' ')
            sb.append(ch)
        }
        return (if (neg) "−" else "") + sb.reverse().toString()
    }
}
