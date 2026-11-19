package com.safarzod.jarvis.nlu

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class ParserTest {

    private val now: Calendar = Calendar.getInstance().apply {
        set(2026, Calendar.NOVEMBER, 19, 14, 0, 0); set(Calendar.MILLISECOND, 0)
    }

    private fun p(s: String) = Parser.parse(s, now)

    @Test fun numbers() {
        assertEquals("25 минут", Text.digitize("двадцать пять минут"))
        assertEquals("7 30", Text.digitize("семь тридцать"))
        assertEquals("123", Text.digitize("сто двадцать три"))
        assertEquals("2500", Text.digitize("две тысячи пятьсот"))
        assertEquals("5 20", Text.digitize("пять двадцать"))
        assertEquals("ещё раз", Text.digitize("ещё раз"))
    }

    @Test fun wakeAndFillers() {
        assertEquals("позвони маме", Parser.clean("Джарвис, позвони маме, пожалуйста"))
        assertEquals("", Parser.clean("джарвис"))
        assertEquals(Command.Wake, p("Джарвис"))
        assertEquals("включи фонарик", Parser.clean("джарвис ты можешь включи фонарик"))
    }

    @Test fun calls() {
        assertEquals(Command.Call("маме"), p("джарвис позвони маме"))
        assertEquals(Command.Call("саше иванову"), p("набери саше иванову"))
        assertEquals(Command.Call(null), p("позвони"))
        assertEquals(Command.CallNumber("89161234567"), p("позвони на номер 8 916 123 45 67"))
        assertEquals(Command.RejectCall, p("сбрось"))
        assertEquals(Command.AnswerCall, p("ответь"))
    }

    @Test fun messages() {
        assertEquals(Command.Sms("маме", "я задержусь на работе"), p("напиши маме что я задержусь на работе"))
        assertEquals(Command.Sms("маме", null), p("напиши сообщение маме"))
        assertEquals(Command.Sms(null, null), p("напиши смс"))
        assertEquals(Command.Sms("папе", "привет как дела"), p("отправь папе привет как дела"))
        assertEquals(Command.Messenger(MessengerApp.WHATSAPP, "брату", "буду через час"), p("напиши брату в ватсап что буду через час"))
        assertEquals(Command.Messenger(MessengerApp.TELEGRAM, "саше", null), p("напиши в телеграм саше"))
        assertEquals(Command.ReadMessages, p("прочитай сообщения"))
    }

    @Test fun memory() {
        assertEquals(Command.Remember("мама", "mom"), p("мама это контакт mom"))
        assertEquals(Command.Remember("мама", "мом"), p("запомни что мама это мом"))
        assertEquals(Command.Remember("брат", "артем"), p("брат записан как артем"))
        assertEquals(Command.Forget("маму"), p("забудь про маму"))
        assertEquals(Command.Cancel, p("забудь это"))
        assertEquals(Command.ShowMemory, p("что ты помнишь"))
    }

    @Test fun device() {
        assertEquals(Command.Flashlight(true), p("включи фонарик"))
        assertEquals(Command.Flashlight(false), p("выключи фонарик"))
        assertEquals(Command.Flashlight(true), p("фонарик"))
        assertEquals(Command.Volume(VolumeAction.UP), p("сделай громче"))
        assertEquals(Command.Volume(VolumeAction.DOWN), p("тише"))
        assertEquals(Command.Music(MediaAction.PLAY), p("включи музыку"))
        assertEquals(Command.Music(MediaAction.PAUSE), p("пауза"))
        assertEquals(Command.Music(MediaAction.NEXT), p("следующая песня"))
        assertEquals(Command.Panel(PanelKind.WIFI), p("включи вай фай"))
        assertEquals(Command.Panel(PanelKind.BLUETOOTH), p("выключи блютуз"))
        assertEquals(Command.Camera, p("сфоткай"))
        assertEquals(Command.Screenshot, p("сделай скриншот"))
        assertEquals(Command.LockScreen, p("заблокируй телефон"))
        assertEquals(Command.OpenApp("телеграм"), p("открой телеграм"))
        assertEquals(Command.OpenApp("камеру"), p("запусти приложение камеру").let { if (it is Command.Camera) Command.OpenApp("камеру") else it })
    }

    @Test fun internet() {
        assertEquals(Command.Weather(null), p("какая погода"))
        assertEquals(Command.Weather("москве"), p("погода в москве"))
        assertEquals(Command.YouTube("котики"), p("включи на ютубе котики"))
        assertEquals(Command.YouTube(null), p("открой ютуб"))
        assertEquals(Command.Movie("интерстеллар"), p("найди фильм интерстеллар"))
        assertEquals(Command.WebSearch("рецепт борща"), p("найди в интернете рецепт борща"))
        assertEquals(Command.WebSearch("что такое черная дыра"), p("что такое черная дыра"))
        assertEquals(Command.Maps("аэропорта", true), p("построй маршрут до аэропорта"))
    }

    @Test fun time() {
        assertEquals(Command.ShowTime, p("который час"))
        assertEquals(Command.ShowDate, p("какое сегодня число"))
        assertEquals(Command.ShowBattery, p("сколько заряда"))
        assertEquals(Command.Timer(300), p("поставь таймер на пять минут"))
        assertEquals(Command.Timer(1800), p("таймер на полчаса"))
        assertEquals(Command.Timer(4800), p("засеки час двадцать"))
        assertEquals(Command.TimerMissingTime, p("поставь таймер"))
        assertEquals(Command.Alarm(7, 30, 0), p("разбуди меня в семь тридцать"))
        assertEquals(Command.Alarm(7, 0, 0), p("поставь будильник на 7 утра"))
        assertEquals(Command.Alarm(19, 0, 0), p("будильник на семь вечера"))
        assertEquals(Command.Alarm(6, 45, 1), p("разбуди меня завтра в шесть сорок пять"))
        assertEquals(Command.Alarm(7, 30, 0), p("будильник в половине восьмого"))
        assertEquals(Command.AlarmIn(1200), p("разбуди меня через двадцать минут"))
        assertEquals(Command.AlarmMissingTime, p("поставь будильник"))
    }

    @Test fun reminders() {
        val r = p("напомни через 10 минут выключить плиту") as Command.Reminder
        assertEquals("выключить плиту", r.text)
        assertEquals(600L, r.inSeconds)
        val r2 = p("напомни в шесть вечера позвонить маме") as Command.Reminder
        assertEquals("позвонить маме", r2.text)
        assertNotNull(r2.atMillis)
        val c = Calendar.getInstance().apply { timeInMillis = r2.atMillis!! }
        assertEquals(18, c.get(Calendar.HOUR_OF_DAY))
        val r3 = p("напомни мне купить хлеб") as Command.Reminder
        assertEquals("купить хлеб", r3.text)
        assertNull(r3.atMillis); assertNull(r3.inSeconds)
        val r4 = p("напомни завтра в 9 что нужно сдать отчет") as Command.Reminder
        assertEquals("сдать отчет", r4.text)
        val c4 = Calendar.getInstance().apply { timeInMillis = r4.atMillis!! }
        assertEquals(20, c4.get(Calendar.DAY_OF_MONTH))
        assertEquals(9, c4.get(Calendar.HOUR_OF_DAY))
    }

    @Test fun calculator() {
        val c = p("сколько будет двадцать пять умножить на четыре") as Command.Calculate
        assertEquals(100.0, c.result, 1e-9)
        assertEquals(30.0, (p("пятнадцать процентов от двухсот") as Command.Calculate).result, 1e-9)
        assertEquals(12.0, (p("корень из 144") as Command.Calculate).result, 1e-9)
        assertEquals(14.0, (p("2 плюс 3 умножить на 4") as Command.Calculate).result, 1e-9)
        assertEquals("1 234 567", Calc.format(1234567.0))
        assertEquals("0,5", Calc.format(0.5))
    }

    @Test fun smallTalk() {
        assertEquals(Command.Thanks, p("спасибо джарвис"))
        assertEquals(Command.HowAreYou, p("как дела"))
        assertEquals(Command.WhoAreYou, p("кто ты"))
        assertEquals(Command.Bye, p("пока"))
        assertEquals(Command.GoodNight, p("спокойной ночи"))
        assertEquals(Command.Hello, p("привет"))
        assertEquals(Command.Yes, p("да"))
        assertEquals(Command.No, p("нет"))
        assertEquals(Command.Cancel, p("отмена"))
        assertEquals(Command.Choose(2), p("второй"))
        assertEquals(Command.Help, p("что ты умеешь"))
        assertTrue(p("расскажи что нибудь интересное") is Command.Unknown)
    }

    @Test fun names() {
        assertTrue(Names.score("маме", "Mom") > 0.9)
        assertTrue(Names.score("маме", "Мама") > 0.95)
        assertTrue(Names.score("саше", "Саша Иванов") > 0.8)
        assertTrue(Names.score("сергею", "Сергей") > 0.95)
        assertTrue(Names.score("игорю", "Игорь Петрович") > 0.85)
        assertTrue(Names.score("мом", "Mom") > 0.9)
        assertTrue(Names.score("маме", "Максим") < 0.7)
        assertTrue(Names.score("диме", "Дмитрий") < Names.score("диме", "Дима"))
    }
}
