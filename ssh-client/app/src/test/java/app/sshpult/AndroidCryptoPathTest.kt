package app.sshpult

import app.sshpult.ssh.KeyAlgorithm
import app.sshpult.ssh.KeyTools
import app.sshpult.ssh.SshConnector
import app.sshpult.ssh.SshError
import com.jcraft.jsch.JSch
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * On a phone JSch cannot use the desktop JDK's Ed25519 / X25519, so the app switches it to the
 * bundled BouncyCastle implementations (SshConnector.useBundledCrypto). This test runs a full
 * connection through exactly those classes: curve25519 key exchange, an ed25519 server host
 * key and ed25519 public-key sign-in.
 */
class AndroidCryptoPathTest {
    @get:Rule val tmp = TemporaryFolder()
    private val keys = listOf("xdh", "keypairgen.eddsa", "keypairgen_fromprivate.eddsa", "ssh-ed25519", "ssh-ed448")
    private lateinit var saved: Map<String, String?>

    @Before fun switchToBundledCrypto() {
        saved = keys.associateWith { JSch.getConfig(it) }
        SshConnector.useBundledCrypto()
    }

    @After fun restore() = saved.forEach { (k, v) -> if (v != null) JSch.setConfig(k, v) }

    @Test fun fullConnectionThroughBouncyCastle() {
        assertEquals("com.jcraft.jsch.bc.SignatureEd25519", JSch.getConfig("ssh-ed25519"))
        TestServer(tmp.root.toPath()).use { server ->
            server.setHostKey("Ed25519", 255)
            val key = KeyTools.generate(KeyAlgorithm.ED25519, "phone")
            server.allow(key.info.publicKey)
            val hostKeys = MemoryHostKeys()
            val forced = mapOf("kex" to "curve25519-sha256", "server_host_key" to "ssh-ed25519")
            val unknown = try {
                SshConnector.connect(server.keyTarget(key.privateKey), hostKeys, extraConfig = forced)
                throw AssertionError("host key must not be trusted implicitly")
            } catch (e: SshError.UnknownHostKey) {
                e
            }
            assertEquals("ssh-ed25519", unknown.key.type)
            hostKeys.trust(unknown.key)
            SshConnector.connect(server.keyTarget(key.privateKey), hostKeys, extraConfig = forced).use { c ->
                assertTrue(c.exec("echo ok").output.contains("ok"))
            }
        }
    }
}
