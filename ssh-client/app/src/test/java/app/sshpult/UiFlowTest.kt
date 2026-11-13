package app.sshpult

import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.sshpult.data.ConnectionProfile
import app.sshpult.data.SecretCipher
import app.sshpult.ssh.RemotePaths
import app.sshpult.ssh.SshError
import app.sshpult.ssh.ConnState
import app.sshpult.ui.FilesViewModel
import com.github.takahirom.roborazzi.captureScreenRoboImage
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import android.os.Looper
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/** The real App, with the keystore swapped for a fake (Robolectric has no Android Keystore). */
class TestApp : App() {
    override fun createCipher(): SecretCipher = FakeCipher()
}

/**
 * Drives the real UI (MainActivity, navigation, dialogs) against a real SSH server in-process:
 * create a connection, accept the host key, run a command in the terminal, browse and change
 * files, run a saved script. Screenshots of each step land in build/screenshots/flow.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestApp::class, qualifiers = "w411dp-h891dp-420dpi")
class UiFlowTest {
    @get:Rule(order = 0) val tmp = TemporaryFolder()
    @get:Rule(order = 1) val rule = createAndroidComposeRule<MainActivity>()
    private lateinit var server: TestServer
    private var shot = 0

    @Before fun setUp() {
        File(tmp.root, "hello.txt").writeText("hello from the server\n")
        File(tmp.root, "logs").mkdir()
        server = TestServer(tmp.root.toPath())
    }

    @After fun tearDown() {
        (RuntimeEnvironment.getApplication() as App).container.sessions.disconnectAll()
        server.close()
    }

    private fun snap(name: String) {
        rule.waitForIdle()
        captureScreenRoboImage("build/screenshots/flow/%02d_%s.png".format(++shot, name))
    }

    /** Waits for a condition on app state, letting work posted to the main thread run meanwhile. */
    private fun await(timeoutMs: Long = 30_000, condition: () -> Boolean) = rule.waitUntil(timeoutMs) {
        shadowOf(Looper.getMainLooper()).idle()
        condition()
    }

    private fun waitForText(text: String, timeoutMs: Long = 20_000) = rule.waitUntil(timeoutMs) {
        rule.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
    }

    @Test fun connectRunCommandBrowseFilesAndRunScript() {
        // -- empty first launch, create a connection
        rule.onNodeWithText("No servers yet").assertIsDisplayed()
        snap("empty")
        rule.onNodeWithContentDescription("Add").performClick()
        rule.onAllNodesWithText("Save")[0].performClick() // validation kicks in
        rule.onAllNodesWithText("Required")[0].assertIsDisplayed()
        snap("validation")
        rule.onNodeWithText("Name (optional)").performTextInput("Test box")
        rule.onNodeWithText("Host or IP").performTextInput("127.0.0.1")
        rule.onNodeWithText("Port").performTextReplacement(server.port.toString())
        rule.onNodeWithText("Login").performTextInput(server.user)
        rule.onNode(hasText("Password") and hasSetTextAction()).performTextInput(server.password)
        snap("new_connection")
        rule.onAllNodesWithText("Save")[0].performClick()

        // -- first connection: the unknown host key must be confirmed by the user
        rule.onNodeWithText("Test box").performClick()
        waitForText("Unknown server")
        snap("host_key")
        rule.onNodeWithText("Trust and connect").performClick()

        // -- terminal, typing straight into it (default mode): keystrokes go to the shell one by one
        waitForText("Terminal")
        rule.waitUntil(20_000) { rule.onAllNodesWithTag("direct-input").fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag("direct-input").performTextInput("echo ui-")
        rule.onNodeWithTag("direct-input").performTextInput("\$((40+2))")
        rule.onNodeWithTag("direct-input").performImeAction()
        waitForText("ui-42")
        snap("terminal_direct")
        // Ctrl is sticky: "ctrl" then a letter sends the control byte, here Ctrl+D ends the shell
        // -- separate input field
        rule.onNodeWithContentDescription("Switch to separate input field").performClick()
        rule.onNodeWithTag("compose-input").performTextInput("echo compose-\$((50+5))")
        snap("terminal_compose_typing")
        rule.onNodeWithContentDescription("Send").performClick()
        waitForText("compose-55")
        // history suggestion appears while typing a similar command
        rule.onNodeWithTag("compose-input").performTextInput("echo")
        waitForText("echo compose-\$((50+5))")
        snap("terminal_compose_history")
        rule.onNodeWithTag("compose-input").performTextClearance()
        assertFalse((RuntimeEnvironment.getApplication() as App).container.repository.data.value.settings.terminalDirectInput)
        rule.onNodeWithContentDescription("Switch to typing in the terminal").performClick()

        // -- files
        rule.onNodeWithText("Files").performClick()
        waitForText("hello.txt")
        rule.onNodeWithText("logs").assertIsDisplayed()
        snap("files")
        // open a folder and come back
        rule.onNodeWithText("logs").performClick()
        waitForText("This folder is empty")
        rule.onNodeWithContentDescription("Parent folder").performClick()
        waitForText("hello.txt")
        // tapping a file opens its menu; delete it through the confirmation dialog
        rule.onNodeWithText("hello.txt").performClick()
        rule.onNodeWithText("Delete").performClick()
        waitForText("Delete “hello.txt”?")
        snap("delete_confirm")
        rule.onNodeWithText("Delete").performClick()
        rule.waitUntil(20_000) { !File(tmp.root, "hello.txt").exists() }
        assertTrue(File(tmp.root, "logs").isDirectory)
        rule.onNodeWithText("Terminal").performClick()

        // -- run the bundled sample script from the session menu
        rule.onNodeWithContentDescription("More").performClick()
        rule.onNodeWithText("Run script").performClick()
        rule.onNodeWithText("System info").performClick()
        waitForText("Finished.", 60_000)
        waitForText("uname -a")
        snap("script_result")

        // -- back on the home screen the connection is marked as open
        rule.onNodeWithContentDescription("Back").performClick()
        rule.onNodeWithContentDescription("Back").performClick()
        waitForText("connected")
        snap("home_connected")
    }

    @Test fun wrongPasswordShowsAHelpfulErrorWithAWayOut() {
        val application = RuntimeEnvironment.getApplication() as App
        val repo = application.container.repository
        val profile = ConnectionProfile(repo.newId(), "", "127.0.0.1", server.port, server.user)
        repo.saveConnection(profile, "not the password")
        rule.onNodeWithText(profile.address).performClick()
        waitForText("Unknown server")
        rule.onNodeWithText("Trust and connect").performClick()
        waitForText("Sign-in failed")
        snap("auth_error")
        rule.onNodeWithText("Try again").assertIsDisplayed()
        rule.onNodeWithText("Enter another password").assertIsDisplayed()
        // (Dialogs that contain a text field cannot be driven here: a stock AlertDialog with an
        // OutlinedTextField never reports "idle" under Robolectric. Their logic is covered below
        // through the view model and in RepositoryTest.)
    }

    @Test fun quickConnectLineCreatesTheServerAndOpensIt() {
        val application = RuntimeEnvironment.getApplication() as App
        val repo = application.container.repository
        rule.onNodeWithContentDescription("Quick connect").performTextInput("not a target")
        rule.onNodeWithContentDescription("Quick connect").performImeAction()
        waitForText("Type it as login@host")
        assertTrue(repo.data.value.connections.isEmpty())
        rule.onNodeWithContentDescription("Quick connect").performTextClearance()
        rule.onNodeWithContentDescription("Quick connect").performTextInput("${server.user}@127.0.0.1:${server.port}")
        rule.onNodeWithContentDescription("Quick connect").performImeAction()
        // (the password prompt that opens next is a dialog with a text field, see the note above)
        await { repo.data.value.connections.size == 1 }
        val created = repo.data.value.connections.single()
        assertEquals(server.user, created.username)
        assertEquals(server.port, created.port)
        // the typed password is remembered only after it really opened the session
        val session = application.container.sessions.session(created.id)
        session.connect(repo.targetFor(created, server.password))
        await { session.state.value is ConnState.Failed }
        session.trustHostKeyAndRetry(((session.state.value as ConnState.Failed).error as SshError.UnknownHostKey).key)
        await { session.state.value is ConnState.Connected }
    }

    @Test fun serverDownShowsConnectionRefused() {
        val application = RuntimeEnvironment.getApplication() as App
        val repo = application.container.repository
        val profile = ConnectionProfile(repo.newId(), "", "127.0.0.1", server.port, server.user)
        repo.saveConnection(profile, server.password)
        server.close()
        rule.onNodeWithText(profile.address).performClick()
        waitForText("refused the connection")
        rule.onNodeWithText("Try again").assertIsDisplayed()
        snap("refused")
    }

    @Test fun uploadAndDownloadThroughTheFilesViewModel() {
        val application = RuntimeEnvironment.getApplication() as App
        val hostKeys = application.container.repository
        val session = application.container.sessions.session("vm-test")
        session.connect(server.passwordTarget())
        await { session.state.value is ConnState.Failed }
        session.trustHostKeyAndRetry(((session.state.value as ConnState.Failed).error as SshError.UnknownHostKey).key)
        await { session.state.value is ConnState.Connected }
        assertEquals(1, hostKeys.data.value.knownHosts.size)

        val vm = FilesViewModel(session, application)
        await { !vm.state.value.loading }
        assertEquals(listOf("logs", "hello.txt"), vm.state.value.entries.map { it.name })

        // upload two local files; one clashes with an existing remote name
        val local = tmp.newFolder("phone")
        val a = File(local, "photo.bin").apply { writeBytes(ByteArray(200_000) { it.toByte() }) }
        val b = File(local, "hello.txt").apply { writeText("from the phone") }
        vm.upload(listOf(Uri.fromFile(a), Uri.fromFile(b)))
        await { vm.state.value.transfer == null && vm.state.value.entries.any { it.name == "hello (2).txt" } }
        assertTrue(File(tmp.root, "photo.bin").readBytes().contentEquals(a.readBytes()))
        assertEquals("hello from the server\n", File(tmp.root, "hello.txt").readText()) // not overwritten
        assertEquals("from the phone", File(tmp.root, "hello (2).txt").readText())

        // folder operations
        vm.mkdir("made by vm")
        await { vm.state.value.entries.any { it.name == "made by vm" && it.isDirectory } }
        vm.rename(vm.state.value.entries.first { it.name == "made by vm" }, "renamed")
        await { File(tmp.root, "renamed").isDirectory && vm.state.value.entries.any { it.name == "renamed" } }
        vm.open(RemotePaths.join(vm.state.value.path, "renamed"))
        await { vm.state.value.path.endsWith("/renamed") && !vm.state.value.loading }
        assertTrue(vm.state.value.entries.isEmpty())
        vm.up()
        await { !vm.state.value.path.endsWith("/renamed") && !vm.state.value.loading }
        vm.delete(vm.state.value.entries.first { it.name == "renamed" })
        await { !File(tmp.root, "renamed").exists() }

        // download
        val target = File(local, "downloaded.bin")
        vm.download(vm.state.value.entries.first { it.name == "photo.bin" }, Uri.fromFile(target))
        await { vm.state.value.transfer == null && target.length() == 200_000L }
        assertTrue(target.readBytes().contentEquals(a.readBytes()))
        assertFalse(vm.state.value.loading)
    }
}
