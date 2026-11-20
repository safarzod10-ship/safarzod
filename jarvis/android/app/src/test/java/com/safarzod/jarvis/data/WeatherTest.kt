package com.safarzod.jarvis.data

import com.safarzod.jarvis.JarvisApp
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class WeatherTest {

    @Test fun phrasesAreSpokenInWords() {
        assertEquals("плюс три градуса", WeatherService.degrees(3))
        assertEquals("минус один градус", WeatherService.degrees(-1))
        assertEquals("ноль градусов", WeatherService.degrees(0))
        assertEquals("Москве", WeatherService.inPlace("Москва"))
        assertEquals("Ташкенте", WeatherService.inPlace("Ташкент"))
        val r = WeatherService.Report("Москва", 0, 3, -1, 3, -2, 5, 40, 4)
        assertEquals(
            "Сейчас в Москве плюс три градуса, пасмурно, ощущается как минус один градус. Днём до плюс пяти градусов, вероятность осадков сорок процентов, сэр.",
            r.speech(),
        )
    }

    /** Живой запрос к Open-Meteo: пропускается без интернета. */
    @Test fun liveForecastForCityInAnyCase() = runBlocking {
        val app = RuntimeEnvironment.getApplication() as JarvisApp
        val res = app.engine.weatherService.get("москве", 0)
        assumeTrue("нет сети", res !is WeatherService.Result.Offline)
        assertTrue(res.toString(), res is WeatherService.Result.Ok)
        val w = (res as WeatherService.Result.Ok).report
        assertEquals("Москва", w.place)
        println(w.speech())
        val tomorrow = app.engine.weatherService.get("Ташкенте", 1) as WeatherService.Result.Ok
        println(tomorrow.report.speech())
    }
}
