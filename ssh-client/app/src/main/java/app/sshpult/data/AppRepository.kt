package app.sshpult.data

import app.sshpult.ssh.HostKeyStore
import app.sshpult.ssh.RunMode
import app.sshpult.ssh.SeenHostKey
import app.sshpult.ssh.SshError
import app.sshpult.ssh.SshTarget
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import java.io.File
import java.util.UUID
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Single source of truth for everything the user saves: connections, keys, scripts and
 * trusted host keys. Kept in memory as an immutable [AppData] and mirrored to one JSON file.
 * Secrets inside it are always encrypted with [cipher].
 */
class AppRepository(
    private val file: File,
    private val cipher: SecretCipher,
    private val writer: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "sshpult-store").apply { isDaemon = true }
    },
) : HostKeyStore {
    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; prettyPrint = false }
    private val _data = MutableStateFlow(load())
    val data: StateFlow<AppData> = _data

    private fun load(): AppData {
        if (!file.exists()) return AppData(scripts = listOf(sampleScript()))
        return try {
            json.decodeFromString(AppData.serializer(), file.readText())
        } catch (e: Exception) {
            // Keep the unreadable file for manual recovery instead of silently overwriting it.
            runCatching { file.copyTo(File(file.parentFile, file.name + ".corrupt"), overwrite = true) }
            AppData()
        }
    }

    private fun sampleScript() = Script(
        id = newId(), name = "System info",
        commands = "# One command per line\nuname -a\nuptime\ndf -h\nfree -m",
        mode = RunMode.SEQUENTIAL, stopOnError = false,
    )

    @Synchronized
    private fun update(transform: (AppData) -> AppData) {
        val next = transform(_data.value)
        if (next == _data.value) return
        _data.value = next
        writer.execute { persist(next) }
    }

    private fun persist(snapshot: AppData) {
        if (snapshot !== _data.value) return // a newer snapshot is already queued
        try {
            file.parentFile?.mkdirs()
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(json.encodeToString(AppData.serializer(), snapshot))
            if (!tmp.renameTo(file)) {
                tmp.copyTo(file, overwrite = true)
                tmp.delete()
            }
        } catch (e: Exception) {
            // Disk full or similar: data stays in memory; the next change retries the write.
        }
    }

    /** Blocks until pending writes hit the disk (used by tests and on app shutdown). */
    fun flush() {
        writer.submit {}.get()
    }

    fun newId(): String = UUID.randomUUID().toString()

    companion object {
        const val MIN_FONT = 5f
        const val MAX_FONT = 28f
    }

    // ---- Connections -------------------------------------------------------------------

    fun connection(id: String): ConnectionProfile? = _data.value.connections.firstOrNull { it.id == id }

    /**
     * Inserts or replaces a profile. [password]: null keeps the stored one, "" clears it
     * (ask on every connect), anything else is encrypted and stored.
     */
    fun saveConnection(profile: ConnectionProfile, password: String?) = update { d ->
        val old = d.connections.firstOrNull { it.id == profile.id }
        val enc = when {
            profile.authType != AuthType.PASSWORD -> null
            password == null -> old?.passwordEnc
            password.isEmpty() -> null
            else -> cipher.encrypt(password)
        }
        val saved = profile.copy(
            passwordEnc = enc,
            keyId = profile.keyId.takeIf { profile.authType == AuthType.KEY },
        )
        if (old == null) d.copy(connections = d.connections + saved)
        else d.copy(connections = d.connections.map { if (it.id == saved.id) saved else it })
    }

    /** Returns the saved profile for this login/host/port, creating a password-less one if needed. */
    fun findOrCreateConnection(target: QuickTarget): ConnectionProfile {
        _data.value.connections.firstOrNull {
            it.username == target.username && it.host.equals(target.host, ignoreCase = true) && it.port == target.port
        }?.let { return it }
        val created = ConnectionProfile(newId(), "", target.host, target.port, target.username)
        saveConnection(created, "")
        return created
    }

    /** Stores [password] for an existing password-auth profile ("remember password" at sign-in). */
    fun rememberPassword(id: String, password: String) {
        val profile = connection(id) ?: return
        if (profile.authType == AuthType.PASSWORD && password.isNotEmpty()) saveConnection(profile, password)
    }

    fun setTerminalDirectInput(direct: Boolean) = update { it.copy(settings = it.settings.copy(terminalDirectInput = direct)) }

    fun setTerminalFontSize(size: Float) = update { it.copy(settings = it.settings.copy(terminalFontSize = size.coerceIn(MIN_FONT, MAX_FONT))) }

    fun deleteConnection(id: String) = update { d -> d.copy(connections = d.connections.filterNot { it.id == id }) }

    fun duplicateConnection(id: String, nameSuffix: String) = update { d ->
        val src = d.connections.firstOrNull { it.id == id } ?: return@update d
        d.copy(connections = d.connections + src.copy(id = newId(), name = src.title + nameSuffix))
    }

    /**
     * Builds the decrypted connection parameters for [profile].
     * @param typedPassword password the user just entered, used when none is stored.
     */
    fun targetFor(profile: ConnectionProfile, typedPassword: String? = null): SshTarget {
        return when (profile.authType) {
            AuthType.PASSWORD -> {
                val pw = typedPassword ?: profile.passwordEnc?.let { cipher.decrypt(it) }
                    ?: throw SshError.PasswordRequired()
                SshTarget(profile.host, profile.port, profile.username, password = pw)
            }
            AuthType.KEY -> {
                val key = _data.value.keys.firstOrNull { it.id == profile.keyId } ?: throw SshError.BadPrivateKey()
                val private = cipher.decrypt(key.privateKeyEnc) ?: throw SshError.BadPrivateKey()
                SshTarget(
                    profile.host, profile.port, profile.username,
                    privateKey = private,
                    passphrase = key.passphraseEnc?.let { cipher.decrypt(it) },
                )
            }
        }
    }

    // ---- Keys --------------------------------------------------------------------------

    fun addKey(name: String, type: String, publicKey: String, fingerprint: String, privateKey: String, passphrase: String?): SshKeyEntry {
        val entry = SshKeyEntry(
            id = newId(), name = name, type = type, publicKey = publicKey, fingerprint = fingerprint,
            privateKeyEnc = cipher.encrypt(privateKey),
            passphraseEnc = passphrase?.takeIf { it.isNotEmpty() }?.let { cipher.encrypt(it) },
        )
        update { it.copy(keys = it.keys + entry) }
        return entry
    }

    fun deleteKey(id: String) = update { d -> d.copy(keys = d.keys.filterNot { it.id == id }) }

    fun connectionsUsingKey(id: String): List<ConnectionProfile> =
        _data.value.connections.filter { it.authType == AuthType.KEY && it.keyId == id }

    // ---- Scripts -----------------------------------------------------------------------

    fun script(id: String): Script? = _data.value.scripts.firstOrNull { it.id == id }

    fun saveScript(script: Script) = update { d ->
        if (d.scripts.any { it.id == script.id }) d.copy(scripts = d.scripts.map { if (it.id == script.id) script else it })
        else d.copy(scripts = d.scripts + script)
    }

    fun deleteScript(id: String) = update { d -> d.copy(scripts = d.scripts.filterNot { it.id == id }) }

    // ---- Trusted host keys -------------------------------------------------------------

    override fun knownKeys(hostId: String): List<SeenHostKey> =
        _data.value.knownHosts.filter { it.hostId == hostId }.map { it.toSeen() }

    override fun trust(key: SeenHostKey) = update { d ->
        val kept = d.knownHosts.filterNot { it.hostId == key.hostId && it.type == key.type }
        d.copy(knownHosts = kept + KnownHost(key.hostId, key.type, key.keyBase64))
    }

    fun forgetHost(hostId: String) = update { d -> d.copy(knownHosts = d.knownHosts.filterNot { it.hostId == hostId }) }
}
