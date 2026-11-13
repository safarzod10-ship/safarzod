package app.sshpult.ssh

import com.jcraft.jsch.ChannelExec
import com.jcraft.jsch.ChannelSftp
import com.jcraft.jsch.ChannelShell
import com.jcraft.jsch.HostKey
import com.jcraft.jsch.HostKeyRepository
import com.jcraft.jsch.JSch
import com.jcraft.jsch.JSchException
import com.jcraft.jsch.Session
import com.jcraft.jsch.UIKeyboardInteractive
import com.jcraft.jsch.UserInfo
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.Base64

/** Everything needed to open one SSH session. Secrets are already decrypted here. */
data class SshTarget(
    val host: String,
    val port: Int,
    val username: String,
    val password: String? = null,
    val privateKey: String? = null,
    val passphrase: String? = null,
)

/** A server host key as seen during a connection attempt. */
data class SeenHostKey(
    /** `host` for port 22, `[host]:port` otherwise (same convention as OpenSSH known_hosts). */
    val hostId: String,
    val type: String,
    val keyBase64: String,
) {
    val fingerprint: String get() = sha256Fingerprint(Base64.getDecoder().decode(keyBase64))
}

/** Persistent storage of trusted host keys. Implementations must be thread-safe. */
interface HostKeyStore {
    fun knownKeys(hostId: String): List<SeenHostKey>
    /** Trust [key]; replaces any stored key of the same type for the same host. */
    fun trust(key: SeenHostKey)
}

/** Typed failures, so the UI can show a precise, localized message for each. */
sealed class SshError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class UnknownHostKey(val key: SeenHostKey) : SshError("Unknown host key for ${key.hostId}")
    class HostKeyChanged(val key: SeenHostKey) : SshError("Host key changed for ${key.hostId}")
    class PasswordRequired : SshError("Password required")
    class AuthFailed(cause: Throwable? = null) : SshError("Authentication failed", cause)
    class HostNotFound(val host: String, cause: Throwable? = null) : SshError("Host not found: $host", cause)
    class ConnectionRefused(cause: Throwable? = null) : SshError("Connection refused", cause)
    class Unreachable(cause: Throwable? = null) : SshError("Network unreachable", cause)
    class Timeout(cause: Throwable? = null) : SshError("Timed out", cause)
    class BadPrivateKey(cause: Throwable? = null) : SshError("Invalid private key", cause)
    class PassphraseRequired : SshError("Key passphrase required")
    class WrongPassphrase : SshError("Wrong key passphrase")
    class Disconnected(cause: Throwable? = null) : SshError("Connection lost", cause)
    class PermissionDenied(val path: String, cause: Throwable? = null) : SshError("Permission denied: $path", cause)
    class NoSuchFile(val path: String, cause: Throwable? = null) : SshError("No such file: $path", cause)
    class Cancelled : SshError("Cancelled")
    class Other(val detail: String, cause: Throwable? = null) : SshError(detail, cause)
}

fun sha256Fingerprint(keyBlob: ByteArray): String =
    "SHA256:" + Base64.getEncoder().withoutPadding()
        .encodeToString(MessageDigest.getInstance("SHA-256").digest(keyBlob))

/** Reads the algorithm name (first length-prefixed string) out of an SSH public key blob. */
fun keyTypeOf(keyBlob: ByteArray): String = try {
    val buf = ByteBuffer.wrap(keyBlob)
    val len = buf.int
    require(len in 1..64 && len <= buf.remaining())
    String(keyBlob, 4, len, Charsets.US_ASCII)
} catch (e: Exception) {
    "unknown"
}

fun hostIdOf(host: String, port: Int): String = if (port == 22) host else "[$host]:$port"

/** Bridges our [HostKeyStore] into JSch and remembers the key that got rejected, if any. */
private class StoreHostKeyRepository(private val store: HostKeyStore) : HostKeyRepository {
    @Volatile var rejected: SeenHostKey? = null
    @Volatile var rejectedBecauseChanged = false

    override fun check(host: String, key: ByteArray): Int {
        val seen = SeenHostKey(host, keyTypeOf(key), Base64.getEncoder().encodeToString(key))
        val sameType = store.knownKeys(host).filter { it.type == seen.type }
        return when {
            sameType.any { it.keyBase64 == seen.keyBase64 } -> HostKeyRepository.OK
            sameType.isEmpty() -> {
                rejected = seen; rejectedBecauseChanged = false
                HostKeyRepository.NOT_INCLUDED
            }
            else -> {
                rejected = seen; rejectedBecauseChanged = true
                HostKeyRepository.CHANGED
            }
        }
    }

    // Trust decisions are made by the user through HostKeyStore, never implicitly by JSch.
    override fun add(hostkey: HostKey, ui: UserInfo?) = Unit
    override fun remove(host: String, type: String?) = Unit
    override fun remove(host: String, type: String?, key: ByteArray?) = Unit
    override fun getKnownHostsRepositoryID(): String = "sshpult"
    override fun getHostKey(): Array<HostKey> = emptyArray()

    /** Lets JSch prefer the key algorithm we already trust for this host. */
    override fun getHostKey(host: String?, type: String?): Array<HostKey> {
        if (host == null) return emptyArray()
        return store.knownKeys(host)
            .filter { type == null || it.type == type }
            .mapNotNull {
                try { HostKey(host, Base64.getDecoder().decode(it.keyBase64)) } catch (e: Exception) { null }
            }
            .toTypedArray()
    }
}

private class PasswordUserInfo(private val password: String?) : UserInfo, UIKeyboardInteractive {
    override fun getPassphrase(): String? = null
    override fun getPassword(): String? = password
    override fun promptPassword(message: String?): Boolean = password != null
    override fun promptPassphrase(message: String?): Boolean = false
    override fun promptYesNo(message: String?): Boolean = false
    override fun showMessage(message: String?) = Unit
    override fun promptKeyboardInteractive(
        destination: String?, name: String?, instruction: String?,
        prompt: Array<out String>, echo: BooleanArray,
    ): Array<String>? {
        if (prompt.isEmpty()) return emptyArray()
        val pw = password ?: return null
        // Only answer hidden (password-like) prompts; never send the password to an echoed one.
        if (echo.any { it }) return null
        return Array(prompt.size) { pw }
    }
}

object SshConnector {
    const val DEFAULT_TIMEOUT_MS = 15_000

    /**
     * Routes Ed25519 signatures and Curve25519 key exchange through the bundled BouncyCastle
     * classes. Android's own crypto providers do not offer them on every OS version, so the
     * app calls this once at start-up to behave the same on all devices.
     */
    fun useBundledCrypto() {
        JSch.setConfig("xdh", "com.jcraft.jsch.bc.XDH")
        JSch.setConfig("keypairgen.eddsa", "com.jcraft.jsch.bc.KeyPairGenEdDSA")
        JSch.setConfig("keypairgen_fromprivate.eddsa", "com.jcraft.jsch.bc.KeyPairGenEdDSA")
        JSch.setConfig("ssh-ed25519", "com.jcraft.jsch.bc.SignatureEd25519")
        JSch.setConfig("ssh-ed448", "com.jcraft.jsch.bc.SignatureEd448")
    }

    /**
     * Opens an authenticated session. Blocking — call from a background thread.
     * @throws SshError with a specific subtype for every expected failure.
     */
    fun connect(
        target: SshTarget, hostKeys: HostKeyStore, timeoutMs: Int = DEFAULT_TIMEOUT_MS,
        extraConfig: Map<String, String> = emptyMap(),
    ): SshConnection {
        if (target.privateKey == null && target.password == null) throw SshError.PasswordRequired()
        val jsch = JSch()
        val repo = StoreHostKeyRepository(hostKeys)
        jsch.hostKeyRepository = repo
        if (target.privateKey != null) {
            KeyTools.inspect(target.privateKey, target.passphrase) // throws precise key errors early
            try {
                jsch.addIdentity(
                    "key", target.privateKey.toByteArray(), null,
                    target.passphrase?.takeIf { it.isNotEmpty() }?.toByteArray(),
                )
            } catch (e: JSchException) {
                throw SshError.BadPrivateKey(e)
            }
        }
        val session: Session = try {
            jsch.getSession(target.username, target.host, target.port)
        } catch (e: JSchException) {
            throw SshError.Other(e.message ?: "Invalid connection settings", e)
        }
        session.setConfig("StrictHostKeyChecking", "yes")
        session.setConfig(
            "PreferredAuthentications",
            if (target.privateKey != null) "publickey,keyboard-interactive,password"
            else "password,keyboard-interactive",
        )
        target.password?.let { session.setPassword(it) }
        session.userInfo = PasswordUserInfo(target.password)
        extraConfig.forEach { (k, v) -> session.setConfig(k, v) }
        session.setServerAliveInterval(20_000)
        session.setServerAliveCountMax(3)
        try {
            session.connect(timeoutMs)
        } catch (e: Exception) {
            runCatching { session.disconnect() }
            throw mapConnectError(e, repo, target)
        }
        return SshConnection(session)
    }

    private fun mapConnectError(e: Exception, repo: StoreHostKeyRepository, target: SshTarget): SshError {
        repo.rejected?.let {
            return if (repo.rejectedBecauseChanged) SshError.HostKeyChanged(it) else SshError.UnknownHostKey(it)
        }
        val chain = generateSequence<Throwable>(e) { it.cause }.take(8).toList()
        val msg = chain.joinToString(" | ") { it.message.orEmpty() }
        return when {
            chain.any { it is UnknownHostException } || "UnknownHostException" in msg ->
                SshError.HostNotFound(target.host, e)
            chain.any { it is NoRouteToHostException } || "unreachable" in msg.lowercase() ->
                SshError.Unreachable(e)
            chain.any { it is SocketTimeoutException } || "timeout" in msg.lowercase() ||
                "timed out" in msg.lowercase() -> SshError.Timeout(e)
            chain.any { it is ConnectException } || "Connection refused" in msg -> SshError.ConnectionRefused(e)
            "Auth fail" in msg || "Auth cancel" in msg || "USERAUTH fail" in msg ||
                "Too many authentication failures" in msg -> SshError.AuthFailed(e)
            "invalid privatekey" in msg -> SshError.BadPrivateKey(e)
            // The peer hung up mid-handshake (not an SSH server, or it dropped us).
            "End of IO Stream" in msg || "closed by foreign host" in msg || "Connection reset" in msg ->
                SshError.Disconnected(e)
            else -> SshError.Other(e.message ?: e.javaClass.simpleName, e)
        }
    }
}

data class ExecResult(
    val exitCode: Int?,
    val output: String,
    val truncated: Boolean,
    val timedOut: Boolean,
    val durationMs: Long,
) {
    val success: Boolean get() = exitCode == 0 && !timedOut
}

/** An open, authenticated SSH session. All methods block; use a background thread. */
class SshConnection internal constructor(private val session: Session) : Closeable {
    val isConnected: Boolean get() = session.isConnected
    val serverVersion: String get() = session.serverVersion.orEmpty()

    /**
     * Runs one command in its own channel and collects stdout+stderr.
     * Interrupting the calling thread aborts the command.
     */
    fun exec(command: String, timeoutMs: Long = 0, maxOutputBytes: Int = 256 * 1024): ExecResult {
        val started = System.nanoTime()
        val channel = try {
            session.openChannel("exec") as ChannelExec
        } catch (e: JSchException) {
            throw channelError(e)
        }
        val collected = ByteArrayOutputStream()
        var truncated = false
        var timedOut = false
        try {
            channel.setCommand(command)
            channel.setInputStream(null)
            val out = channel.inputStream
            val err = channel.extInputStream
            channel.connect(SshConnector.DEFAULT_TIMEOUT_MS)
            val buf = ByteArray(8192)
            fun drain(stream: java.io.InputStream): Boolean {
                var any = false
                while (stream.available() > 0) {
                    val n = stream.read(buf)
                    if (n < 0) break
                    any = true
                    val room = maxOutputBytes - collected.size()
                    if (n <= room) collected.write(buf, 0, n)
                    else {
                        if (room > 0) collected.write(buf, 0, room)
                        truncated = true
                    }
                }
                return any
            }
            while (true) {
                val got = drain(out) or drain(err)
                if (channel.isClosed) {
                    if (out.available() > 0 || err.available() > 0) continue
                    break
                }
                if (!session.isConnected) throw SshError.Disconnected()
                if (timeoutMs > 0 && (System.nanoTime() - started) / 1_000_000 > timeoutMs) {
                    timedOut = true
                    break
                }
                if (!got) Thread.sleep(25)
            }
            val exit = if (timedOut || channel.exitStatus < 0) null else channel.exitStatus
            return ExecResult(
                exit, collected.toString(Charsets.UTF_8.name()), truncated, timedOut,
                (System.nanoTime() - started) / 1_000_000,
            )
        } catch (e: JSchException) {
            throw channelError(e)
        } catch (e: java.io.IOException) {
            throw SshError.Disconnected(e)
        } finally {
            runCatching { channel.disconnect() }
        }
    }

    fun openShell(cols: Int = 80, rows: Int = 24): ShellSession {
        try {
            val channel = session.openChannel("shell") as ChannelShell
            channel.setPtyType("xterm-256color", cols, rows, 0, 0)
            channel.setPty(true)
            // Enter is sent as CR, like a real terminal; ask the server side to map it to a newline
            // (ICRNL = opcode 36, the default on every normal PTY, stated explicitly here).
            channel.setTerminalMode(byteArrayOf(36, 0, 0, 0, 1, 0))
            val input = channel.inputStream
            val output = channel.outputStream
            channel.connect(SshConnector.DEFAULT_TIMEOUT_MS)
            return ShellSession(channel, input, output, cols, rows)
        } catch (e: JSchException) {
            throw channelError(e)
        }
    }

    fun openSftp(): SftpClient {
        try {
            val channel = session.openChannel("sftp") as ChannelSftp
            channel.connect(SshConnector.DEFAULT_TIMEOUT_MS)
            return SftpClient(channel)
        } catch (e: JSchException) {
            throw channelError(e)
        }
    }

    private fun channelError(e: JSchException): SshError =
        if (!session.isConnected) SshError.Disconnected(e)
        else SshError.Other(e.message ?: "Channel error", e)

    override fun close() {
        runCatching { session.disconnect() }
    }
}
