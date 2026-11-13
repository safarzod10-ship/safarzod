package app.sshpult

import app.sshpult.ssh.CommandStatus
import app.sshpult.ssh.ConnState
import app.sshpult.ssh.KeyAlgorithm
import app.sshpult.ssh.KeyTools
import app.sshpult.ssh.RunMode
import app.sshpult.ssh.ScriptRunner
import app.sshpult.ssh.SessionManager
import app.sshpult.ssh.ShellSession
import app.sshpult.ssh.SshConnection
import app.sshpult.ssh.SshConnector
import app.sshpult.ssh.SshError
import app.sshpult.ssh.SshTarget
import com.jcraft.jsch.JSch
import com.jcraft.jsch.KeyPair
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.ServerSocket

class SshIntegrationTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var server: TestServer
    private lateinit var hostKeys: MemoryHostKeys
    private val open = ArrayList<SshConnection>()

    @Before fun setUp() {
        server = TestServer(tmp.root.toPath())
        hostKeys = MemoryHostKeys()
    }

    @After fun tearDown() {
        open.forEach { it.close() }
        server.close()
    }

    /** Connects the way the app does: first attempt reports the unknown key, user accepts, retry. */
    private fun connectTrusting(target: SshTarget): SshConnection {
        val c = try {
            SshConnector.connect(target, hostKeys)
        } catch (e: SshError.UnknownHostKey) {
            hostKeys.trust(e.key)
            SshConnector.connect(target, hostKeys)
        }
        open.add(c)
        return c
    }

    // ---- host keys ----

    @Test fun unknownHostKeyIsReportedAndNothingIsTrustedImplicitly() {
        val e = assertThrows(SshError.UnknownHostKey::class.java) {
            SshConnector.connect(server.passwordTarget(), hostKeys)
        }
        assertEquals("[127.0.0.1]:${server.port}", e.key.hostId)
        assertTrue(e.key.fingerprint.startsWith("SHA256:"))
        assertTrue(hostKeys.keys.isEmpty())
    }

    @Test fun changedHostKeyIsRejected() {
        connectTrusting(server.passwordTarget()).close()
        val port = server.port
        server.close()
        // "Attacker": a different server (new host key of the same type) on the same address.
        server = TestServer(tmp.root.toPath(), port)
        val e = assertThrows(SshError.HostKeyChanged::class.java) {
            SshConnector.connect(server.passwordTarget(), hostKeys)
        }
        assertFalse(hostKeys.keys.any { it.keyBase64 == e.key.keyBase64 })
    }

    // ---- authentication ----

    @Test fun passwordAuthAndExec() {
        val c = connectTrusting(server.passwordTarget())
        val r = c.exec("echo hello; echo oops 1>&2; exit 3")
        assertEquals(3, r.exitCode)
        assertTrue(r.output.contains("hello"))
        assertTrue(r.output.contains("oops"))
        assertFalse(r.success)
        assertTrue(c.exec("true").success)
    }

    @Test fun wrongPasswordIsAuthFailed() {
        connectTrusting(server.passwordTarget()).close()
        assertThrows(SshError.AuthFailed::class.java) {
            SshConnector.connect(server.passwordTarget("wrong"), hostKeys)
        }
    }

    @Test fun missingPasswordAsksForIt() {
        assertThrows(SshError.PasswordRequired::class.java) {
            SshConnector.connect(server.passwordTarget(null), hostKeys)
        }
    }

    @Test fun generatedEd25519KeyAuthenticates() {
        val key = KeyTools.generate(KeyAlgorithm.ED25519, "phone")
        assertEquals("ssh-ed25519", key.info.type)
        assertTrue(key.info.publicKey.endsWith(" phone"))
        server.allow(key.info.publicKey)
        assertTrue(connectTrusting(server.keyTarget(key.privateKey)).exec("true").success)
    }

    @Test fun generatedRsaKeyAuthenticates() {
        val key = KeyTools.generate(KeyAlgorithm.RSA, "")
        assertEquals("ssh-rsa", key.info.type)
        server.allow(key.info.publicKey)
        assertTrue(connectTrusting(server.keyTarget(key.privateKey)).exec("true").success)
    }

    @Test fun keyNotAuthorizedIsAuthFailed() {
        val key = KeyTools.generate(KeyAlgorithm.ED25519, "")
        connectTrusting(server.passwordTarget()).close()
        assertThrows(SshError.AuthFailed::class.java) {
            SshConnector.connect(server.keyTarget(key.privateKey), hostKeys)
        }
    }

    @Test fun encryptedKeyNeedsTheRightPassphrase() {
        val jsch = JSch()
        val pair = KeyPair.genKeyPair(jsch, KeyPair.RSA, 2048)
        val out = ByteArrayOutputStream()
        pair.writePrivateKey(out, "open sesame".toByteArray())
        val encrypted = out.toString("UTF-8")

        assertThrows(SshError.PassphraseRequired::class.java) { KeyTools.inspect(encrypted, null) }
        assertThrows(SshError.WrongPassphrase::class.java) { KeyTools.inspect(encrypted, "nope") }
        val info = KeyTools.inspect(encrypted, "open sesame")
        assertTrue(info.encrypted)

        server.allow(info.publicKey)
        assertTrue(connectTrusting(server.keyTarget(encrypted, "open sesame")).exec("true").success)
        assertThrows(SshError.WrongPassphrase::class.java) {
            SshConnector.connect(server.keyTarget(encrypted, "nope"), hostKeys)
        }
    }

    @Test fun garbageIsNotAKey() {
        assertThrows(SshError.BadPrivateKey::class.java) { KeyTools.inspect("definitely not a key", null) }
        assertThrows(SshError.BadPrivateKey::class.java) { KeyTools.inspect("", null) }
    }

    @Test fun inspectMatchesGeneratedPublicKey() {
        val key = KeyTools.generate(KeyAlgorithm.ED25519, "c")
        val info = KeyTools.inspect(key.privateKey, null, "c")
        assertEquals(key.info.publicKey, info.publicKey)
        assertEquals(key.info.fingerprint, info.fingerprint)
        assertFalse(info.encrypted)
    }

    // ---- network errors ----

    @Test fun closedPortIsConnectionRefused() {
        val free = ServerSocket(0).use { it.localPort }
        assertThrows(SshError.ConnectionRefused::class.java) {
            SshConnector.connect(SshTarget("127.0.0.1", free, "u", password = "p"), hostKeys)
        }
    }

    @Test fun unresolvableHostIsHostNotFound() {
        assertThrows(SshError.HostNotFound::class.java) {
            SshConnector.connect(SshTarget("no-such-host.invalid", 22, "u", password = "p"), hostKeys, 5000)
        }
    }

    @Test fun silentPeerTimesOut() {
        ServerSocket(0).use { silent -> // accepts TCP but never speaks SSH
            assertThrows(SshError.Timeout::class.java) {
                SshConnector.connect(SshTarget("127.0.0.1", silent.localPort, "u", password = "p"), hostKeys, 1500)
            }
        }
    }

    // ---- exec ----

    @Test fun execTimeoutAndOutputCap() {
        val c = connectTrusting(server.passwordTarget())
        val slow = c.exec("sleep 5", timeoutMs = 300)
        assertTrue(slow.timedOut)
        assertNull(slow.exitCode)
        val big = c.exec("head -c 100000 /dev/zero | tr '\\0' 'x'", maxOutputBytes = 1000)
        assertTrue(big.truncated)
        assertEquals(1000, big.output.length)
        assertTrue(c.exec("echo still-alive").output.contains("still-alive"))
    }

    @Test fun execOnDroppedConnectionIsDisconnected() {
        val c = connectTrusting(server.passwordTarget())
        c.close()
        assertThrows(SshError.Disconnected::class.java) { c.exec("true") }
    }

    // ---- scripts ----

    @Test fun sequentialScriptStopsOnError() = runBlocking {
        val c = connectTrusting(server.passwordTarget())
        val updates = ArrayList<List<CommandStatus>>()
        val r = ScriptRunner.run(c, listOf("echo one", "false", "echo three"), RunMode.SEQUENTIAL, stopOnError = true) {
            synchronized(updates) { updates.add(it.map { x -> x.status }) }
        }
        assertEquals(listOf(CommandStatus.OK, CommandStatus.FAILED, CommandStatus.SKIPPED), r.map { it.status })
        assertEquals("one", r[0].output.trim())
        assertEquals(1, r[1].exitCode)
        assertTrue(updates.first().all { it == CommandStatus.PENDING })
        assertTrue(updates.any { it[0] == CommandStatus.RUNNING })
    }

    @Test fun sequentialScriptCanContinueAfterError() = runBlocking {
        val c = connectTrusting(server.passwordTarget())
        val r = ScriptRunner.run(c, listOf("false", "echo after"), RunMode.SEQUENTIAL, stopOnError = false)
        assertEquals(listOf(CommandStatus.FAILED, CommandStatus.OK), r.map { it.status })
    }

    @Test fun parallelScriptReallyOverlaps() = runBlocking {
        val c = connectTrusting(server.passwordTarget())
        val commands = List(4) { "sleep 1; echo done$it" }
        val started = System.currentTimeMillis()
        val r = ScriptRunner.run(c, commands, RunMode.PARALLEL, stopOnError = false)
        val elapsed = System.currentTimeMillis() - started
        assertTrue(r.all { it.status == CommandStatus.OK })
        assertEquals(List(4) { "done$it" }, r.map { it.output.trim() })
        assertTrue("took ${elapsed}ms", elapsed < 3500) // 4 × 1 s sequentially would be ≥ 4 s
    }

    @Test fun moreParallelCommandsThanChannelLimitStillAllRun() = runBlocking {
        val c = connectTrusting(server.passwordTarget())
        val r = ScriptRunner.run(c, List(12) { "echo n$it" }, RunMode.PARALLEL, stopOnError = false)
        assertEquals(List(12) { "n$it" }, r.map { it.output.trim() })
    }

    // ---- shell ----

    private fun ShellSession.awaitText(needle: String) = runBlocking {
        withTimeout(10_000) { screen.first { s -> s.lines.any { needle in it } } }
    }

    @Test fun interactiveShellKeepsStateBetweenCommands() {
        val shell = connectTrusting(server.passwordTarget()).openShell()
        shell.sendLine("cd /tmp && FOO=bar")
        shell.sendLine("echo \"dir=\$(pwd) foo=\$FOO\"")
        shell.awaitText("dir=/tmp foo=bar")
        shell.sendLine("exit")
        runBlocking { withTimeout(10_000) { shell.closed.first { it } } }
    }

    // ---- sftp ----

    @Test fun sftpRoundTrip() {
        val sftp = connectTrusting(server.passwordTarget()).openSftp()
        val home = sftp.home()
        val payload = ByteArray(300_000) { (it % 251).toByte() }
        val progress = ArrayList<Long>()

        sftp.mkdir(home.trimEnd('/') + "/docs")
        sftp.upload(ByteArrayInputStream(payload), "/docs/data.bin", payload.size.toLong(), { done, _ -> progress.add(done) })
        sftp.upload(ByteArrayInputStream("привет".toByteArray()), "/docs/Заметка.txt", -1)
        assertEquals(payload.size.toLong(), progress.last())

        val listing = sftp.list("/")
        assertEquals(listOf("docs"), listing.map { it.name })
        assertTrue(listing[0].isDirectory)
        val files = sftp.list("/docs")
        assertEquals(setOf("data.bin", "Заметка.txt"), files.map { it.name }.toSet())
        assertEquals(payload.size.toLong(), files.first { it.name == "data.bin" }.size)

        val back = ByteArrayOutputStream()
        sftp.download("/docs/data.bin", back)
        assertTrue(payload.contentEquals(back.toByteArray()))

        sftp.rename("/docs/data.bin", "/docs/renamed.bin")
        assertTrue(sftp.exists("/docs/renamed.bin"))
        assertFalse(sftp.exists("/docs/data.bin"))

        sftp.delete("/docs") // recursive
        assertTrue(sftp.list("/").isEmpty())
    }

    @Test fun sftpErrorsAreTyped() {
        val sftp = connectTrusting(server.passwordTarget()).openSftp()
        assertThrows(SshError.NoSuchFile::class.java) { sftp.list("/nope") }
        assertThrows(SshError.NoSuchFile::class.java) { sftp.download("/nope.txt", ByteArrayOutputStream()) }
    }

    @Test fun cancelledUploadLeavesNoPartialFile() {
        val sftp = connectTrusting(server.passwordTarget()).openSftp()
        val payload = ByteArray(2_000_000)
        assertThrows(SshError.Cancelled::class.java) {
            sftp.upload(ByteArrayInputStream(payload), "/big.bin", payload.size.toLong(), isCancelled = { true })
        }
        assertFalse(sftp.exists("/big.bin"))
    }

    @Test fun recursiveDeleteDoesNotFollowSymlinks() {
        val keep = tmp.newFolder("keep")
        java.io.File(keep, "precious.txt").writeText("x")
        val victim = tmp.newFolder("victim")
        java.nio.file.Files.createSymbolicLink(victim.toPath().resolve("link"), keep.toPath())
        val sftp = connectTrusting(server.passwordTarget()).openSftp()
        sftp.delete("/victim")
        assertFalse(victim.exists())
        assertTrue(java.io.File(keep, "precious.txt").exists())
    }

    // ---- session manager ----

    @Test fun sessionManagerFlow() = runBlocking {
        val scope = CoroutineScope(Dispatchers.Default)
        try {
            val manager = SessionManager(hostKeys, scope)
            val s = manager.session("p1")
            s.connect(server.passwordTarget())
            val failed = withTimeout(10_000) { s.state.first { it is ConnState.Failed } } as ConnState.Failed
            val unknown = failed.error as SshError.UnknownHostKey
            s.trustHostKeyAndRetry(unknown.key)
            withTimeout(10_000) { s.state.first { it is ConnState.Connected } }
            assertEquals(setOf("p1"), manager.connectedIds.value)
            assertEquals("/", s.sftp().realPath("."))
            assertTrue(s.shell() === s.shell())

            server.close() // server goes away -> session must notice
            val lost = withTimeout(30_000) { s.state.first { it is ConnState.Failed } } as ConnState.Failed
            assertTrue(lost.error is SshError.Disconnected)
            assertTrue(manager.connectedIds.value.isEmpty())
        } finally {
            scope.cancel()
        }
    }
}
