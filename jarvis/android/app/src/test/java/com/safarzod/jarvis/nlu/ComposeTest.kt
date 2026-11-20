package com.safarzod.jarvis.nlu

import org.junit.Assert.assertEquals
import org.junit.Test

class ComposeTest {

    private fun msg(cmd: String, contactName: String = "Mom"): String {
        val c = Parser.parse(cmd) as Command.Sms
        return Compose.message(c.text!!, c.who, contactName)
    }

    @Test fun greetsByHowUserCalledThem() {
        assertEquals("Привет, мама! Я не приду.", msg("напиши маме что я не приду"))
        assertEquals("Привет, Саша! Буду через час.", msg("напиши саше что буду через час", "Александр"))
        assertEquals("Привет, брат! Как дела?", msg("напиши брату как дела?", "Артём").replace("Как дела.", "Как дела?"))
    }

    @Test fun indirectRequestBecomesDirect() {
        assertEquals("Привет, мама! Нужно, чтобы ты купила хлеб.", msg("напиши маме чтобы она купила хлеб"))
    }

    @Test fun formalAndExistingGreeting() {
        assertEquals("Здравствуйте! Я сегодня заболел.", msg("напиши начальнику что я сегодня заболел", "Иван Петрович"))
        assertEquals("Привет мама я дома.", msg("напиши маме привет мама я дома"))
    }

    @Test fun noGreetingWhenDisabled() {
        assertEquals("Я не приду.", Compose.message("я не приду", "маме", "Mom", greet = false))
    }
}
