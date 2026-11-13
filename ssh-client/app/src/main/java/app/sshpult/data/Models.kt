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
data class AppData(
    val connections: List<ConnectionProfile> = emptyList(),
    val keys: List<SshKeyEntry> = emptyList(),
    val scripts: List<Script> = emptyList(),
    val knownHosts: List<KnownHost> = emptyList(),
)
