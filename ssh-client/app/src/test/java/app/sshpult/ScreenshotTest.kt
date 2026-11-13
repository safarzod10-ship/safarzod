package app.sshpult

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.sshpult.data.AuthType
import app.sshpult.data.ConnectionProfile
import app.sshpult.data.Script
import app.sshpult.ssh.KeyAlgorithm
import app.sshpult.ssh.KeyTools
import app.sshpult.ssh.RunMode
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the main screens on very different devices (small phone, phone, tablet in landscape),
 * in Russian and English, light and dark, to build/screenshots/layout — and fails if a screen
 * cannot be laid out at all on one of them.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestApp::class)
class ScreenshotTest {
    @get:Rule val rule = createAndroidComposeRule<MainActivity>()

    private fun seed() {
        val repo = (RuntimeEnvironment.getApplication() as App).container.repository
        val key = KeyTools.generate(KeyAlgorithm.ED25519, "phone")
        val k = repo.addKey("Мой телефон", key.info.type, key.info.publicKey, key.info.fingerprint, key.privateKey, null)
        repo.saveConnection(ConnectionProfile(repo.newId(), "Веб-сервер", "web.example.com", 22, "deploy", AuthType.KEY, keyId = k.id), null)
        repo.saveConnection(ConnectionProfile(repo.newId(), "База данных (очень длинное название подключения)", "db-01.internal.example.com", 2222, "postgres"), "x")
        repo.saveConnection(ConnectionProfile(repo.newId(), "", "192.168.1.10", 22, "pi"), "")
        repo.saveScript(Script(repo.newId(), "Обновление системы", "sudo apt update\nsudo apt -y upgrade", RunMode.SEQUENTIAL, true))
        repo.saveScript(Script(repo.newId(), "Проверка сервисов", "systemctl is-active nginx\nsystemctl is-active postgresql\ndf -h /", RunMode.PARALLEL, false))
    }

    private fun shot(name: String) {
        rule.waitForIdle()
        captureScreenRoboImage("build/screenshots/layout/$name.png")
    }

    private fun tour(prefix: String, add: String, scripts: String, keys: String, firstScript: String) {
        seed()
        shot("${prefix}_1_connections")
        rule.onNodeWithText(scripts).performClick()
        shot("${prefix}_2_scripts")
        rule.onNodeWithText(firstScript).performClick()
        shot("${prefix}_3_script_edit")
        rule.activityRule.scenario.onActivity { it.onBackPressedDispatcher.onBackPressed() }
        rule.onAllNodesWithText(keys)[0].performClick()
        shot("${prefix}_4_keys")
        rule.onNodeWithText("Мой телефон").performClick()
        shot("${prefix}_5_public_key")
        rule.onAllNodesWithText(if (add == "Add") "Close" else "Закрыть")[0].performClick()
        rule.onAllNodesWithText(if (add == "Add") "Servers" else "Серверы")[0].performClick()
        rule.onNodeWithContentDescription(add).performClick()
        shot("${prefix}_6_connection_edit")
    }

    @Config(qualifiers = "ru-w411dp-h891dp-420dpi")
    @Test fun phoneRussian() = tour("phone_ru", "Добавить", "Скрипты", "Ключи", "Обновление системы")

    @Config(qualifiers = "ru-w411dp-h891dp-night-420dpi")
    @Test fun phoneRussianDark() = tour("phone_ru_dark", "Добавить", "Скрипты", "Ключи", "Обновление системы")

    @Config(qualifiers = "w320dp-h568dp-320dpi")
    @Test fun smallPhoneEnglish() = tour("small_en", "Add", "Scripts", "Keys", "Обновление системы")

    @Config(qualifiers = "ru-w1280dp-h800dp-land-240dpi")
    @Test fun tabletLandscapeRussian() = tour("tablet_ru", "Добавить", "Скрипты", "Ключи", "Обновление системы")

    @Config(qualifiers = "ru-w891dp-h411dp-land-420dpi")
    @Test fun phoneLandscapeRussian() = tour("phone_land_ru", "Добавить", "Скрипты", "Ключи", "Обновление системы")
}
