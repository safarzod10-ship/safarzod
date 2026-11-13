package app.sshpult.ssh

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

enum class RunMode { SEQUENTIAL, PARALLEL }

enum class CommandStatus { PENDING, RUNNING, OK, FAILED, SKIPPED }

data class CommandResult(
    val command: String,
    val status: CommandStatus = CommandStatus.PENDING,
    val exitCode: Int? = null,
    val output: String = "",
    val truncated: Boolean = false,
    val durationMs: Long = 0,
    /** Set when the command could not be run at all (connection lost, timeout...). */
    val error: SshError? = null,
)

object ScriptRunner {
    /** Servers usually allow 10 channels per connection (OpenSSH MaxSessions); stay well below. */
    const val MAX_PARALLEL = 4
    const val DEFAULT_COMMAND_TIMEOUT_MS = 10 * 60_000L

    /** One command per line; blank lines and lines starting with `#` are ignored. */
    fun parse(script: String): List<String> =
        script.lineSequence().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }.toList()

    /**
     * Runs [commands] over [connection], each in its own exec channel (so `cd` in one line
     * does not affect the next — chain with `&&` on a single line for that).
     * [onUpdate] is called with the full, current result list after every change.
     * Cancelling the coroutine aborts running commands.
     */
    suspend fun run(
        connection: SshConnection,
        commands: List<String>,
        mode: RunMode,
        stopOnError: Boolean,
        timeoutMs: Long = DEFAULT_COMMAND_TIMEOUT_MS,
        dispatcher: CoroutineDispatcher = Dispatchers.IO,
        onUpdate: (List<CommandResult>) -> Unit = {},
    ): List<CommandResult> {
        val results = commands.map { CommandResult(it) }.toMutableList()
        val lock = Any()
        fun set(i: Int, r: CommandResult) {
            val copy = synchronized(lock) { results[i] = r; results.toList() }
            onUpdate(copy)
        }
        onUpdate(results.toList())

        suspend fun runOne(i: Int): Boolean {
            set(i, CommandResult(commands[i], CommandStatus.RUNNING))
            val r = try {
                val e = runInterruptible(dispatcher) { connection.exec(commands[i], timeoutMs) }
                CommandResult(
                    commands[i], if (e.success) CommandStatus.OK else CommandStatus.FAILED,
                    e.exitCode, e.output, e.truncated, e.durationMs,
                    error = if (e.timedOut) SshError.Timeout() else null,
                )
            } catch (e: SshError) {
                CommandResult(commands[i], CommandStatus.FAILED, error = e)
            }
            set(i, r)
            return r.status == CommandStatus.OK
        }

        when (mode) {
            RunMode.SEQUENTIAL -> {
                var failed = false
                for (i in commands.indices) {
                    if (failed && stopOnError) set(i, CommandResult(commands[i], CommandStatus.SKIPPED))
                    else if (!runOne(i)) failed = true
                }
            }
            RunMode.PARALLEL -> coroutineScope {
                val gate = Semaphore(MAX_PARALLEL)
                commands.indices.map { i -> async { gate.withPermit { runOne(i) } } }.awaitAll()
            }
        }
        return synchronized(lock) { results.toList() }
    }
}
