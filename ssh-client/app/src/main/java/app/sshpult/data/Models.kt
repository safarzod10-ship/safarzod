package app.sshpult.data

import app.sshpult.ssh.RunMode
import app.sshpult.ssh.SeenHostKey
import kotlinx.serialization.Serializable

enum class AuthType { PASSWORD, KEY }

@Serializable
data class ConnectionProfile(
    val id: String,
    val name: String,
    val host: String,
    val port: Int = 22,
    val username: String,
    val authType: AuthType = AuthType.PASSWORD,
    /** Encrypted with the device keystore; null means "ask every time". */
    val passwordEnc: String? = null,
    val keyId: String? = null,
) {
    val title: String get() = name.ifBlank { "$username@$host" }
    val address: String get() = if (port == 22) "$username@$host" else "$username@$host:$port"
}

@Serializable
data class SshKeyEntry(
    val id: String,
    val name: String,
    val type: String,
    val publicKey: String,
    val fingerprint: String,
    /** Private key text, encrypted with the device keystore. */
    val privateKeyEnc: String,
    val passphraseEnc: String? = null,
)

@Serializable
data class Script(
    val id: String,
    val name: String,
    /** One command per line. */
    val commands: String,
    val mode: RunMode = RunMode.SEQUENTIAL,
    val stopOnError: Boolean = true,
)

@Serializable
data class KnownHost(val hostId: String, val type: String, val keyBase64: String) {
    fun toSeen() = SeenHostKey(hostId, type, keyBase64)
}

@Serializable
data class Settings(
    /** true: keystrokes go straight to the shell; false: commands are composed in a separate field. */
    val terminalDirectInput: Boolean = true,
)

/** Result of parsing a quick-connect line. */
data class QuickTarget(val username: String, val host: String, val port: Int)

/**
 * Understands what people paste or type when they just want to get in:
 * `login@host`, `login@host:2222`, `ssh login@host -p 2222`, `ssh://login@host:2222`.
 */
fun parseQuickTarget(input: String): QuickTarget? {
    var s = input.trim()
    s = s.removePrefix("ssh://")
    if (s.startsWith("ssh ")) s = s.removePrefix("ssh ").trim()
    val at = s.lastIndexOf('@')
    if (at <= 0 || at == s.lastIndex) return null
    val user = s.substring(0, at).trim()
    val rest = s.substring(at + 1).trim()
    var host = rest
    var port = 22
    val dashP = Regex("^(\\S+)\\s+-p\\s*(\\d{1,5})$").matchEntire(rest)
    if (dashP != null) {
        host = dashP.groupValues[1]
        port = dashP.groupValues[2].toInt()
    } else if (rest.count { it == ':' } == 1) {
        host = rest.substringBefore(':')
        port = rest.substringAfter(':').toIntOrNull() ?: return null
    }
    if (user.isEmpty() || user.any { it.isWhitespace() }) return null
    if (host.isEmpty() || host.any { it.isWhitespace() || it == '/' || it == '@' }) return null
    if (port !in 1..65535) return null
    return QuickTarget(user, host, port)
}

@Serializable
data class AppData(
    val connections: List<ConnectionProfile> = emptyList(),
    val keys: List<SshKeyEntry> = emptyList(),
    val scripts: List<Script> = emptyList(),
    val knownHosts: List<KnownHost> = emptyList(),
    val settings: Settings = Settings(),
)
