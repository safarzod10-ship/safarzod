package app.sshpult

import app.sshpult.ssh.KeyAlgorithm
import app.sshpult.ssh.KeyTools
import app.sshpult.ssh.ShellSession
import app.sshpult.ssh.SshConnection
import app.sshpult.ssh.SshConnector
import app.sshpult.ssh.SshError
import app.sshpult.ssh.SshTarget
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/**
 * Optional checks against a real OpenSSH server (real PTY, real bash, real sftp-server).
 * Skipped unless SSHPULT_REAL_SSH is set to `host:port:user:password`; the account must be a
 * throw-away test user, its ~/.ssh/authorized_keys gets overwritten.
 * SSHPULT_REAL_SSH_FP may hold the expected host key fingerprint (`SHA256:...`).
 */
class RealOpenSshTest {
    private val spec = System.getenv("SSHPULT_REAL_SSH")
    private lateinit var target: SshTarget
    private val hostKeys = MemoryHostKeys()
    private val open = ArrayList<SshConnection>()

    @Before fun setUp() {
        assumeTrue("SSHPULT_REAL_SSH not set", !spec.isNullOrBlank())
        val (host, port, user, password) = spec!!.split(":", limit = 4)
        target = SshTarget(host, port.toInt(), user, password = password)
        SshConnector.useBundledCrypto() // same crypto classes as on a phone
    }

    @After fun tearDown() = open.forEach { it.close() }

    private fun connect(t: SshTarget = target): SshConnection {
        val c = try {
            SshConnector.connect(t, hostKeys)
        } catch (e: SshError.UnknownHostKey) {
            System.getenv("SSHPULT_REAL_SSH_FP")?.let { assertEquals(it, e.key.fingerprint) }
            hostKeys.trust(e.key)
            SshConnector.connect(t, hostKeys)
        }
        open.add(c)
        return c
    }

    private fun ShellSession.await(what: String, predicate: (List<String>) -> Boolean) = runBlocking {
        try {
            withTimeout(10_000) { screen.first { predicate(it.lines) } }
        } catch (e: Exception) {
            throw AssertionError("Timed out waiting for $what. Screen:\n" + screen.value.lines.joinToString("\n"))
        }
    }

    @Test fun passwordLoginAndFingerprint() {
        val c = connect()
        assertTrue(c.serverVersion.contains("OpenSSH"))
        assertEquals(target.username, c.exec("whoami").output.trim())
        assertThrows(SshError.AuthFailed::class.java) {
            SshConnector.connect(target.copy(password = "definitely wrong"), hostKeys)
        }
    }

    @Test fun interactiveShellOnARealPty() {
        val shell = connect().openShell(cols = 80, rows = 24)
        shell.await("prompt") { it.last().contains("$") }

        shell.sendLine("cd /tmp")
        shell.sendLine("echo \"here=\$(pwd) term=\$TERM\"")
        shell.await("state kept between commands") { l -> l.any { it == "here=/tmp term=dumb" } }

        shell.resize(100, 30)
        shell.sendLine("stty size")
        shell.await("resized pty") { l -> l.any { it == "30 100" } }

        shell.sendLine("sleep 300")
        Thread.sleep(500)
        shell.send(ShellSession.CTRL_C)
        shell.sendLine("echo interrupted-\$((40+2))")
        shell.await("Ctrl+C interrupts") { l -> l.any { it == "interrupted-42" } }

        shell.sendLine("ls --color=always / ; printf '\\033[1;32mgreen\\033[0m-done\\n'")
        shell.await("colour codes stripped") { l -> l.any { it == "green-done" } }
        assertFalse(shell.screen.value.lines.any { '\u001b' in it })

        shell.sendLine("printf 'Привет €\\n'")
        shell.await("utf-8") { l -> l.any { it == "Привет €" } }

        shell.sendLine("exit")
        runBlocking { withTimeout(10_000) { shell.closed.first { it } } }
    }

    @Test fun passwordPromptInsideShellIsUsable() {
        val shell = connect().openShell()
        shell.await("prompt") { it.last().contains("$") }
        shell.sendLine("read -s -p 'Secret: ' v; echo; echo \"len=\${#v}\"")
        shell.await("hidden prompt") { it.last().startsWith("Secret:") }
        shell.sendLine("hunter2")
        shell.await("answer accepted") { l -> l.any { it == "len=7" } }
        assertFalse("typed secret must not be echoed", shell.screen.value.lines.any { "hunter2" in it })
    }

    @Test fun installGeneratedKeysOverSftpThenLogInWithThem() {
        val ed = KeyTools.generate(KeyAlgorithm.ED25519, "sshpult-test")
        val rsa = KeyTools.generate(KeyAlgorithm.RSA, "sshpult-test")
        val sftp = connect().openSftp()
        val home = sftp.home()
        if (!sftp.exists("$home/.ssh")) sftp.mkdir("$home/.ssh")
        if (sftp.exists("$home/.ssh/authorized_keys")) sftp.delete("$home/.ssh/authorized_keys")
        val authorized = (ed.info.publicKey + "\n" + rsa.info.publicKey + "\n").toByteArray()
        sftp.upload(ByteArrayInputStream(authorized), "$home/.ssh/authorized_keys", authorized.size.toLong())

        for (key in listOf(ed, rsa)) {
            val byKey = SshTarget(target.host, target.port, target.username, privateKey = key.privateKey)
            assertEquals(target.username, connect(byKey).exec("whoami").output.trim())
        }
        val stranger = KeyTools.generate(KeyAlgorithm.ED25519, "")
        assertThrows(SshError.AuthFailed::class.java) {
            SshConnector.connect(SshTarget(target.host, target.port, target.username, privateKey = stranger.privateKey), hostKeys)
        }
    }

    @Test fun sftpAgainstRealServer() {
        val sftp = connect().openSftp()
        val home = sftp.home()
        val dir = "$home/sshpult-test-${System.nanoTime()}"
        sftp.mkdir(dir)
        val payload = ByteArray(1_500_000) { (it * 7 % 253).toByte() }
        sftp.upload(ByteArrayInputStream(payload), "$dir/Файл с пробелом.bin", payload.size.toLong())
        val entry = sftp.list(dir).single()
        assertEquals("Файл с пробелом.bin", entry.name)
        assertEquals(payload.size.toLong(), entry.size)
        val back = ByteArrayOutputStream()
        sftp.download(entry.path, back)
        assertTrue(payload.contentEquals(back.toByteArray()))
        sftp.delete(dir)
        assertFalse(sftp.exists(dir))
        assertThrows(SshError.PermissionDenied::class.java) { sftp.list("/root") }
        assertThrows(SshError.PermissionDenied::class.java) { sftp.mkdir("/etc/sshpult-nope") }
    }
}
