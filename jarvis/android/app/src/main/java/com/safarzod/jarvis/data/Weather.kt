package com.safarzod.jarvis.data

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.LocationManager
import androidx.core.content.ContextCompat
import com.safarzod.jarvis.core.Settings
import com.safarzod.jarvis.nlu.Names
import com.safarzod.jarvis.voice.RuNum
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import kotlin.math.roundToInt

/** Погода голосом: Open-Meteo (бесплатно, без ключей). Город — из фразы, по геопозиции или «домашний». */
class WeatherService(private val context: Context, private val settings: Settings) {

    data class Report(
        val place: String,
        val day: Int,              // 0 — сейчас/сегодня, 1 — завтра
        val temp: Int,             // сейчас (для day=0) или макс. днём (для day=1)
        val feels: Int?,
        val code: Int,
        val min: Int,
        val max: Int,
        val precip: Int?,
        val wind: Int?,
    ) {
        val description: String get() = describe(code)

        /** Фраза для синтеза голосом: всё словами, без цифр. */
        fun speech(): String = if (day == 0) {
            buildString {
                append("Сейчас в ${inPlace(place)} ${degrees(temp)}, $description")
                if (feels != null && kotlin.math.abs(feels - temp) >= 3) append(", ощущается как ${degrees(feels)}")
                append(". Днём до ${degreesGen(max)}")
                if (precip != null && precip >= 20) append(", вероятность осадков ${RuNum.words(precip.toLong())} ${RuNum.plural(precip.toLong(), "процент", "процента", "процентов")}")
                append(", сэр.")
            }
        } else {
            buildString {
                append("Завтра в ${inPlace(place)} от ${signed(min, genitive = true)} до ${degreesGen(max)}, $description")
                if (precip != null && precip >= 20) append(", вероятность осадков ${RuNum.words(precip.toLong())} ${RuNum.plural(precip.toLong(), "процент", "процента", "процентов")}")
                append(", сэр.")
            }
        }
    }

    sealed interface Result {
        data class Ok(val report: Report) : Result
        data object NoLocation : Result
        data object NotFound : Result
        data object Offline : Result
        data object Failed : Result
    }

    private val json = Json { ignoreUnknownKeys = true }

    fun hasLocationPermission() = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    suspend fun get(placeQuery: String?, day: Int): Result = withContext(Dispatchers.IO) {
        try {
            val place = when {
                !placeQuery.isNullOrBlank() -> geocode(placeQuery) ?: return@withContext Result.NotFound
                else -> deviceLocation() ?: settings.homeCity.value.takeIf { it.isNotBlank() }?.let { geocode(it) }
                    ?: return@withContext Result.NoLocation
            }
            val url = "https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}" +
                "&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m" +
                "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
                "&timezone=auto&forecast_days=2&wind_speed_unit=ms"
            val o = json.parseToJsonElement(http(url)).jsonObject
            val cur = o["current"]!!.jsonObject
            val daily = o["daily"]!!.jsonObject
            fun di(key: String) = daily[key]!!.jsonArray[day].jsonPrimitive
            fun dd(key: String) = di(key).doubleOrNull?.roundToInt()
            fun dn(key: String) = daily[key]?.jsonArray?.getOrNull(day)?.jsonPrimitive?.intOrNull
            val r = if (day == 0) Report(
                place.name, 0,
                cur["temperature_2m"]!!.jsonPrimitive.double.roundToInt(),
                cur["apparent_temperature"]?.jsonPrimitive?.doubleOrNull?.roundToInt(),
                cur["weather_code"]!!.jsonPrimitive.int,
                dd("temperature_2m_min") ?: 0, dd("temperature_2m_max") ?: 0,
                dn("precipitation_probability_max"),
                cur["wind_speed_10m"]?.jsonPrimitive?.doubleOrNull?.roundToInt(),
            ) else Report(
                place.name, 1,
                dd("temperature_2m_max") ?: throw IllegalStateException("нет прогноза"), null,
                di("weather_code").intOrNull ?: 0,
                dd("temperature_2m_min") ?: 0, dd("temperature_2m_max") ?: 0,
                dn("precipitation_probability_max"), null,
            )
            Result.Ok(r)
        } catch (e: java.io.IOException) {
            Result.Offline
        } catch (e: Exception) {
            // неожиданный ответ сервиса (пустые значения, другой формат) — не роняем диалог
            Result.Failed
        }
    }

    private data class Place(val name: String, val lat: Double, val lon: Double)

    /** «москве» → Москва: пробуем начальные формы слова, пока сервис не найдёт город. */
    private fun geocode(query: String): Place? {
        val words = query.trim().split(' ').filter { it.isNotBlank() }
        // сначала начальные формы («москве» → «москва»), исходное слово — последним
        val candidates = LinkedHashSet<String>()
        if (words.size == 1) candidates.addAll(Names.lemmas(words[0]).drop(1))
        else candidates += words.joinToString(" ") { w -> Names.lemmas(w).getOrElse(1) { w } }
        candidates += query.trim()
        for (c in candidates) {
            if (c.length < 2) continue
            val url = "https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=" + URLEncoder.encode(c, "UTF-8")
            val res = json.parseToJsonElement(http(url)).jsonObject["results"]?.jsonArray?.firstOrNull()?.jsonObject ?: continue
            // отбрасываем «примерные» совпадения: название должно начинаться с того, что спросили
            val found = res["name"]!!.jsonPrimitive.content.lowercase().replace('ё', 'е')
            if (!found.startsWith(c.lowercase().take(4))) continue
            return Place(
                res["name"]!!.jsonPrimitive.content,
                res["latitude"]!!.jsonPrimitive.double,
                res["longitude"]!!.jsonPrimitive.double,
            )
        }
        return null
    }

    @SuppressLint("MissingPermission")
    private fun deviceLocation(): Place? {
        if (!hasLocationPermission()) return null
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val loc = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.PASSIVE_PROVIDER, LocationManager.GPS_PROVIDER)
            .mapNotNull { p -> runCatching { lm.getLastKnownLocation(p) }.getOrNull() }
            .maxByOrNull { it.time } ?: return null
        val name = runCatching {
            @Suppress("DEPRECATION")
            Geocoder(context, Locale.forLanguageTag("ru")).getFromLocation(loc.latitude, loc.longitude, 1)?.firstOrNull()?.locality
        }.getOrNull() ?: settings.homeCity.value.ifBlank { "вашем районе" }
        return Place(name, loc.latitude, loc.longitude)
    }

    private fun http(url: String): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 6000
        c.readTimeout = 6000
        c.setRequestProperty("User-Agent", "Jarvis-Android")
        return try {
            if (c.responseCode != 200) throw java.io.IOException("HTTP ${c.responseCode}")
            c.inputStream.bufferedReader().use { it.readText() }
        } finally {
            c.disconnect()
        }
    }

    companion object {
        fun describe(code: Int): String = when (code) {
            0 -> "ясно"
            1 -> "преимущественно ясно"
            2 -> "переменная облачность"
            3 -> "пасмурно"
            45, 48 -> "туман"
            51, 53, 55 -> "морось"
            56, 57 -> "ледяная морось"
            61 -> "небольшой дождь"
            63 -> "дождь"
            65 -> "сильный дождь"
            66, 67 -> "ледяной дождь"
            71 -> "небольшой снег"
            73 -> "снег"
            75 -> "сильный снегопад"
            77 -> "снежная крупа"
            80, 81 -> "ливень"
            82 -> "сильный ливень"
            85, 86 -> "снегопад"
            95 -> "гроза"
            96, 99 -> "гроза с градом"
            else -> "без осадков"
        }

        fun degrees(t: Int): String {
            val n = kotlin.math.abs(t).toLong()
            val sign = when { t > 0 -> "плюс "; t < 0 -> "минус "; else -> "" }
            return sign + RuNum.words(n) + " " + RuNum.plural(n, "градус", "градуса", "градусов")
        }

        /** «до плюс пяти градусов», «до минус одного градуса». */
        fun degreesGen(t: Int): String {
            val n = kotlin.math.abs(t).toLong()
            return signed(t, genitive = true) + " " + if (n % 10 == 1L && n % 100 != 11L) "градуса" else "градусов"
        }

        private fun signed(t: Int, genitive: Boolean): String {
            val n = kotlin.math.abs(t)
            val sign = when { t > 0 -> "плюс "; t < 0 -> "минус "; else -> "" }
            return sign + if (genitive) genitiveWords(n) else RuNum.words(n.toLong())
        }

        private val genUnits = listOf("ноля", "одного", "двух", "трёх", "четырёх", "пяти", "шести", "семи", "восьми", "девяти",
            "десяти", "одиннадцати", "двенадцати", "тринадцати", "четырнадцати", "пятнадцати", "шестнадцати", "семнадцати", "восемнадцати", "девятнадцати")
        private val genTens = listOf("", "", "двадцати", "тридцати", "сорока", "пятидесяти", "шестидесяти")

        private fun genitiveWords(n: Int): String = when {
            n < 20 -> genUnits[n]
            n < 70 -> genTens[n / 10] + if (n % 10 != 0) " " + genUnits[n % 10] else ""
            else -> RuNum.words(n.toLong())
        }

        /** «Москва» → «Москве» для «в …»: простые правила склонения названий. */
        fun inPlace(name: String): String = when {
            name.endsWith("ва") || name.endsWith("ка") || name.endsWith("на") || name.endsWith("та") || name.endsWith("да") || name.endsWith("ма") -> name.dropLast(1) + "е"
            name.endsWith("ь") -> name.dropLast(1) + "и"
            name.endsWith("ск") || name.endsWith("рг") || name.endsWith("д") || name.endsWith("н") || name.endsWith("в") || name.endsWith("ент") || name.endsWith("ар") -> name + "е"
            name.endsWith("ы") || name.endsWith("и") || name.endsWith("о") || name.endsWith("е") -> name
            else -> name
        }
    }
}
