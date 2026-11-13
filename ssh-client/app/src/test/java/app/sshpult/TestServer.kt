package app.sshpult

import app.sshpult.ssh.HostKeyStore
import app.sshpult.ssh.SeenHostKey
import app.sshpult.ssh.SshTarget
import org.apache.sshd.common.config.keys.AuthorizedKeyEntry
import org.apache.sshd.common.config.keys.KeyUtils
import org.apache.sshd.common.file.virtualfs.VirtualFileSystemFactory
import org.apache.sshd.common.keyprovider.KeyPairProvider
import org.apache.sshd.server.SshServer
import org.apache.sshd.server.shell.InteractiveProcessShellFactory
import org.apache.sshd.server.shell.ProcessShellCommandFactory
import org.apache.sshd.sftp.server.SftpSubsystemFactory
import java.nio.file.Path
import java.security.KeyPairGenerator
import java.security.PublicKey

class MemoryHostKeys : HostKeyStore {
    val keys = ArrayList<SeenHostKey>()
    @Synchronized override fun knownKeys(hostId: String) = keys.filter { it.hostId == hostId }
    @Synchronized override fun trust(key: SeenHostKey) {
        keys.removeAll { it.hostId == key.hostId && it.type == key.type }
        keys.add(key)
    }
}

/** A real SSH server on a random local port: password + public-key auth, /bin/sh commands, SFTP. */
class TestServer(root: Path, fixedPort: Int = 0) : AutoCloseable {
    val user = "tester"
    val password = "s3cret pass"
    val allowedKeys = ArrayList<PublicKey>()
    private val server: SshServer = SshServer.setUpDefaultServer()

    init {
        server.host = "127.0.0.1"
        server.port = fixedPort
        setHostKey("EC", 256)
        server.setPasswordAuthenticator { u, p, _ -> u == user && p == password }
        server.setPublickeyAuthenticator { u, key, _ -> u == user && allowedKeys.any { KeyUtils.compareKeys(it, key) } }
        server.commandFactory = ProcessShellCommandFactory.INSTANCE
        server.shellFactory = InteractiveProcessShellFactory.INSTANCE
        server.subsystemFactories = listOf(SftpSubsystemFactory.Builder().build())
        server.fileSystemFactory = VirtualFileSystemFactory(root)
        server.start()
    }

    val port: Int get() = server.port

    fun setHostKey(algorithm: String, bits: Int) {
        val pair = if (algorithm == "Ed25519") {
            KeyUtils.generateKeyPair("ssh-ed25519", 256) // server-side EdDSA implementation
        } else {
            KeyPairGenerator.getInstance(algorithm).apply { initialize(bits) }.generateKeyPair()
        }
        server.keyPairProvider = KeyPairProvider.wrap(pair)
    }

    fun allow(publicKeyLine: String) {
        allowedKeys.add(AuthorizedKeyEntry.parseAuthorizedKeyEntry(publicKeyLine).resolvePublicKey(null, null))
    }

    fun passwordTarget(pw: String? = password) = SshTarget("127.0.0.1", port, user, password = pw)
    fun keyTarget(privateKey: String, passphrase: String? = null) =
        SshTarget("127.0.0.1", port, user, privateKey = privateKey, passphrase = passphrase)

    override fun close() = server.stop(true)
}
