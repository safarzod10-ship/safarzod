package app.sshpult.ssh

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.ConcurrentHashMap

sealed interface ConnState {
    data object Idle : ConnState
    data object Connecting : ConnState
    data class Connected(val connection: SshConnection) : ConnState
    data class Failed(val error: SshError) : ConnState
}

/** Keeps live SSH sessions for the whole app process, so screens and rotations can share them. */
class SessionManager(
    private val hostKeys: HostKeyStore,
    private val scope: CoroutineScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) {
    private val sessions = ConcurrentHashMap<String, ManagedSession>()
    private val _connectedIds = MutableStateFlow<Set<String>>(emptySet())
    /** Ids of profiles that currently have an open connection. */
    val connectedIds: StateFlow<Set<String>> = _connectedIds

    fun session(profileId: String): ManagedSession =
        sessions.getOrPut(profileId) { ManagedSession(profileId) }

    fun disconnect(profileId: String) {
        sessions[profileId]?.disconnect()
    }

    fun disconnectAll() = sessions.values.forEach { it.disconnect() }

    inner class ManagedSession internal constructor(val profileId: String) {
        private val _state = MutableStateFlow<ConnState>(ConnState.Idle)
        val state: StateFlow<ConnState> = _state

        private var job: Job? = null
        private var lastTarget: SshTarget? = null
        private val resources = Mutex()
        private var shell: ShellSession? = null
        private var browseSftp: SftpClient? = null
        private var transferSftp: SftpClient? = null

        /** Starts connecting unless a connection is already open or in progress. */
        @Synchronized
        fun connect(target: SshTarget) {
            val s = _state.value
            if (s is ConnState.Connecting || (s is ConnState.Connected && s.connection.isConnected)) return
            lastTarget = target
            _state.value = ConnState.Connecting
            job?.cancel()
            job = scope.launch {
                val connection = try {
                    runInterruptible(io) { SshConnector.connect(target, hostKeys) }
                } catch (e: SshError) {
                    _state.value = ConnState.Failed(e)
                    return@launch
                } catch (e: Exception) {
                    if (!isActive) throw e
                    _state.value = ConnState.Failed(SshError.Other(e.message ?: e.javaClass.simpleName, e))
                    return@launch
                }
                if (!isActive) {
                    connection.close()
                    return@launch
                }
                _connectedIds.update { it + profileId }
                _state.value = ConnState.Connected(connection)
                // Watch for the connection dropping (server reboot, network loss...).
                while (isActive && connection.isConnected) delay(1500)
                if (isActive) {
                    release()
                    _connectedIds.update { it - profileId }
                    _state.value = ConnState.Failed(SshError.Disconnected())
                }
            }
        }

        /** Saves the offered host key as trusted and retries the last connection attempt. */
        fun trustHostKeyAndRetry(key: SeenHostKey) {
            hostKeys.trust(key)
            lastTarget?.let { connect(it) }
        }

        @Synchronized
        fun disconnect() {
            job?.cancel()
            job = null
            val s = _state.value
            _state.value = ConnState.Idle
            _connectedIds.update { it - profileId }
            scope.launch(io) {
                release()
                (s as? ConnState.Connected)?.connection?.close()
            }
        }

        private fun connection(): SshConnection =
            (_state.value as? ConnState.Connected)?.connection ?: throw SshError.Disconnected()

        /** The single interactive shell of this session; reopened if the previous one ended. */
        suspend fun shell(): ShellSession = resources.withLock {
            shell?.takeIf { !it.closed.value } ?: runInterruptible(io) { connection().openShell() }.also {
                shell?.close()
                shell = it
            }
        }

        suspend fun sftp(): SftpClient = resources.withLock {
            browseSftp?.takeIf { it.isOpen } ?: runInterruptible(io) { connection().openSftp() }.also { browseSftp = it }
        }

        /** Separate channel for uploads/downloads so directory browsing is never blocked by them. */
        suspend fun transferSftp(): SftpClient = resources.withLock {
            transferSftp?.takeIf { it.isOpen } ?: runInterruptible(io) { connection().openSftp() }.also { transferSftp = it }
        }

        private fun release() {
            shell?.close(); shell = null
            browseSftp?.close(); browseSftp = null
            transferSftp?.close(); transferSftp = null
        }
    }
}
