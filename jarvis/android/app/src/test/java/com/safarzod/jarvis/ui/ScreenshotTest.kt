package com.safarzod.jarvis.ui

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.github.takahirom.roborazzi.captureRoboImage
import com.safarzod.jarvis.JarvisApp
import com.safarzod.jarvis.core.Card
import com.safarzod.jarvis.core.CardIcon
import com.safarzod.jarvis.core.Need
import com.safarzod.jarvis.core.Phase
import com.safarzod.jarvis.core.UiState
import com.safarzod.jarvis.data.AliasKind
import com.safarzod.jarvis.data.Contact
import com.safarzod.jarvis.data.ContactMatch
import com.safarzod.jarvis.data.IncomingMessage
import com.safarzod.jarvis.gl.CoreParams
import com.safarzod.jarvis.ui.home.HomeContent
import com.safarzod.jarvis.ui.screens.CommandsScreen
import com.safarzod.jarvis.ui.screens.MemoryScreen
import com.safarzod.jarvis.ui.screens.OnboardingScreen
import com.safarzod.jarvis.ui.screens.SettingsScreen
import com.safarzod.jarvis.ui.screens.VoiceScreen
import com.safarzod.jarvis.ui.theme.JarvisTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Скриншоты экранов поверх реального кадра 3D-ядра (рендер шейдеров из tools/shader_preview).
 * Запуск: ./gradlew :app:testDebugUnitTest --tests '*ScreenshotTest*' — картинки в app/build/screenshots.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class ScreenshotTest {

    @get:Rule val compose = createComposeRule()

    private fun shot(name: String, bg: String?, content: @Composable () -> Unit) {
        val img = bg?.let { javaClass.classLoader!!.getResourceAsStream("bg/$it.png").use { s -> BitmapFactory.decodeStream(s).asImageBitmap() } }
        compose.setContent {
            JarvisTheme(Color(0xFF5BE3FF)) {
                Box(Modifier.fillMaxSize().background(Color(0xFF04060A))) {
                    if (img != null) Image(img, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    content()
                }
            }
        }
        compose.mainClock.advanceTimeBy(3000)
        compose.onRoot().captureRoboImage("build/screenshots/$name.png")
    }

    private fun home(name: String, bg: String, ui: UiState, mic: Float = 0f, typing: Boolean = false) =
        shot(name, bg) { HomeContent(ui, mic, CoreParams(), {}, {}, {}, {}, startTyping = typing) }

    private val mom = Contact(1, "Мама", "+7 916 123-45-67", "Мобильный", true, 0)

    @Test fun home_idle() = home("01_home_idle", "home_idle", UiState(phase = Phase.STANDBY, micReady = true))

    @Test fun home_listening() = home("02_home_listening", "home_listen", UiState(phase = Phase.LISTENING, partial = "позвони маме", micReady = true), mic = 0.6f)

    @Test fun home_sms() = home(
        "03_home_sms", "home_card",
        UiState(
            phase = Phase.LISTENING, awaiting = true, micReady = true,
            userText = "Напиши маме, что я задержусь на работе.", reply = "Подтверждаете, сэр?",
            card = Card.SmsDraft("Мама", "+7 916 123-45-67", "Мам, я задержусь на работе.", null, true),
        ),
    )

    @Test fun home_choice() = home(
        "04_home_choice", "home_card",
        UiState(
            phase = Phase.SPEAKING, micReady = true, userText = "Позвони Саше.", reply = "Вы уверены, сэр?",
            card = Card.ContactChoice(
                "саше", listOf(
                    ContactMatch(Contact(2, "Саша Иванов", "+7 903 555-12-12", "Мобильный", false, 0), 0.9, false),
                    ContactMatch(Contact(3, "Александра Работа", "+7 495 123-00-00", "Рабочий", false, 0), 0.8, false),
                    ContactMatch(Contact(4, "Саша Спорт", "+7 926 777-88-99", "Мобильный", false, 0), 0.78, false),
                )
            ),
        ),
    )

    @Test fun home_battery() = home(
        "05_home_battery", "home_card",
        UiState(phase = Phase.STANDBY, micReady = true, userText = "Сколько заряда?", reply = "Да, сэр.", card = Card.Big("Заряд", "86%", "Заряжается · 31 °C", CardIcon.BATTERY)),
    )

    @Test fun home_thinking() = home(
        "06_home_thinking", "home_think",
        UiState(phase = Phase.THINKING, micReady = true, userText = "Черкани жене, что я уже еду."),
    )

    @Test fun home_calling() = home(
        "07_home_calling", "home_card",
        UiState(phase = Phase.SPEAKING, micReady = true, userText = "Позвони маме.", reply = "Набираю, сэр.", card = Card.Calling(mom.name, mom.phone, mom.phoneLabel)),
    )

    @Test fun home_reply() = home(
        "08_home_reply", "home_idle",
        UiState(phase = Phase.STANDBY, micReady = true, userText = "Как дела?", reply = "Все системы в норме, сэр. Спасибо, что спросили."),
    )

    @Test fun home_messages() = home(
        "09_home_messages", "home_card",
        UiState(
            phase = Phase.STANDBY, micReady = true, userText = "Прочитай сообщения.", reply = "Да, сэр.",
            card = Card.Messages(listOf(
                IncomingMessage("Telegram", "org.telegram.messenger", "Саша", "Ты где? Мы уже у входа, ждём тебя", System.currentTimeMillis() - 120_000),
                IncomingMessage("WhatsApp", "com.whatsapp", "Мама", "Купи хлеба по дороге, пожалуйста", System.currentTimeMillis() - 900_000),
            )),
        ),
    )

    @Test fun home_reminder() = home(
        "10_home_reminder", "home_card",
        UiState(phase = Phase.LISTENING, awaiting = true, micReady = true, userText = "Напомни купить хлеб.", reply = "Когда напомнить, сэр?", card = Card.ReminderPickTime("Купить хлеб")),
    )

    @Test fun home_permission() = home(
        "11_home_permission", "home_card",
        UiState(phase = Phase.STANDBY, micReady = true, userText = "Сделай скриншот.", reply = "Простите, сэр, но нужные разрешения не обнаружены.",
            card = Card.Permission("Спец. возможности", "Для скриншотов, блокировки экрана и кнопок «Назад/Домой» включите службу Джарвиса в «Специальных возможностях».", Need.ACCESSIBILITY)),
    )

    @Test fun home_muted() = home("13_home_muted", "home_idle", UiState(phase = Phase.OFF, micReady = true, muted = true))

    @Test fun home_weather() = home(
        "14_home_weather", "home_card",
        UiState(phase = Phase.SPEAKING, micReady = true, userText = "Какая погода?", reply = "Сейчас в Москве плюс четыре градуса, пасмурно. Днём до плюс шести градусов, сэр.",
            card = Card.Weather("Москва", 0, 4, "пасмурно", 1, 2, 6, 40, 3)),
    )

    @Test fun home_chat() = home(
        "15_home_chat", "home_listen",
        UiState(phase = Phase.SPEAKING, micReady = true, userText = "Зачем людям сон?", reply = "Во сне мозг сортирует воспоминания и восстанавливает силы, сэр. Без него падают внимание и настроение."),
    )

    @Test fun home_typing() = home("12_home_typing", "home_card", UiState(phase = Phase.STANDBY, micReady = true), typing = true)

    @Test fun onboarding() {
        shot("20_onboarding_welcome", "onb_welcome") { OnboardingScreen(CoreParams(), {}, {}) }
    }

    @Test fun onboarding_perms() {
        shot("21_onboarding_perms", "onb_perms") { OnboardingScreen(CoreParams(), {}, {}) }
        compose.onNodeWithText("Начать").performClick()
        compose.mainClock.advanceTimeBy(1500)
        compose.onRoot().captureRoboImage("build/screenshots/21_onboarding_perms.png")
    }

    @Test fun settings() {
        val app = RuntimeEnvironment.getApplication() as JarvisApp
        shot("30_settings", null) { SettingsScreen(app, {}, {}, {}) }
    }

    @Test fun memory() {
        val app = RuntimeEnvironment.getApplication() as JarvisApp
        app.engine.memory.put("мама", AliasKind.CONTACT, "Mom", "+7 916 123-45-67")
        app.engine.memory.put("брат", AliasKind.CONTACT, "Артём", "+7 903 111-22-33")
        app.engine.memory.put("телега", AliasKind.APP, "Telegram", "org.telegram.messenger")
        app.engine.reminders.add("Позвонить в банк", System.currentTimeMillis() + 3_600_000)
        shot("31_memory", null) { MemoryScreen(app.engine, {}) }
    }

    @Test fun voice() {
        val app = RuntimeEnvironment.getApplication() as JarvisApp
        shot("32_voice", null) { VoiceScreen(app.engine, {}) }
    }

    @Test fun commands() = shot("33_commands", null) { CommandsScreen({}, {}) }
}
