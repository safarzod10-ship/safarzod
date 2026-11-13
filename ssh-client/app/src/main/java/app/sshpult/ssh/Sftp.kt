package app.sshpult.ssh

import com.jcraft.jsch.ChannelSftp
import com.jcraft.jsch.SftpATTRS
import com.jcraft.jsch.SftpException
import com.jcraft.jsch.SftpProgressMonitor
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream

data class RemoteFile(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val isSymlink: Boolean,
    val size: Long,
    val modifiedEpochSec: Long,
    val permissions: String,
)

object RemotePaths {
    fun join(dir: String, name: String): String = if (dir.endsWith("/")) dir + name else "$dir/$name"

    fun parent(path: String): String {
        val trimmed = path.trimEnd('/')
        if (trimmed.isEmpty()) return "/"
        val idx = trimmed.lastIndexOf('/')
        return if (idx <= 0) "/" else trimmed.substring(0, idx)
    }

    fun name(path: String): String = path.trimEnd('/').substringAfterLast('/')

    /** A single path component the user typed: no separators, not "." / "..". */
    fun isValidName(name: String): Boolean =
        name.isNotBlank() && '/' !in name && '\u0000' !in name && name != "." && name != ".."
}

/**
 * Thin, synchronized wrapper over one SFTP channel. All calls block.
 * Open a second instance for long transfers so browsing stays responsive.
 */
class SftpClient internal constructor(private val channel: ChannelSftp) : Closeable {
    val isOpen: Boolean get() = channel.isConnected

    @Synchronized
    fun home(): String = wrap("~") { channel.home }

    @Synchronized
    fun realPath(path: String): String = wrap(path) { channel.realpath(path) }

    @Synchronized
    fun list(path: String): List<RemoteFile> = wrap(path) {
        val result = ArrayList<RemoteFile>()
        for (entry in channel.ls(path)) {
            val name = entry.filename
            if (name == "." || name == "..") continue
            val attrs = entry.attrs
            val full = RemotePaths.join(path, name)
            val isDir = if (attrs.isLink) {
                try { channel.stat(full).isDir } catch (e: SftpException) { false } // dangling link
            } else attrs.isDir
            result.add(
                RemoteFile(name, full, isDir, attrs.isLink, attrs.size, attrs.mTime.toLong(), attrs.permissionsString),
            )
        }
        result.sortWith(compareBy<RemoteFile> { !it.isDirectory }.thenBy(String.CASE_INSENSITIVE_ORDER) { it.name })
        result
    }

    @Synchronized
    fun stat(path: String): SftpATTRS = wrap(path) { channel.stat(path) }

    @Synchronized
    fun exists(path: String): Boolean = try {
        channel.lstat(path); true
    } catch (e: SftpException) {
        if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) false else throw mapError(e, path)
    }

    @Synchronized
    fun mkdir(path: String) = wrap(path) { channel.mkdir(path) }

    @Synchronized
    fun rename(from: String, to: String) = wrap(from) { channel.rename(from, to) }

    /** Deletes a file, or a directory with everything inside it. Symlinks are removed, never followed. */
    @Synchronized
    fun delete(path: String) = wrap(path) { deleteRecursive(path, 0) }

    private fun deleteRecursive(path: String, depth: Int) {
        val attrs = channel.lstat(path)
        if (attrs.isDir && !attrs.isLink) {
            if (depth > 64) throw SshError.Other("Directory tree is too deep: $path")
            for (entry in channel.ls(path)) {
                val name = entry.filename
                if (name == "." || name == "..") continue
                deleteRecursive(RemotePaths.join(path, name), depth + 1)
            }
            channel.rmdir(path)
        } else {
            channel.rm(path)
        }
    }

    /** Streams a remote file into [out]. [onProgress] gets (bytesDone, totalBytes). */
    @Synchronized
    fun download(
        path: String, out: OutputStream,
        onProgress: (Long, Long) -> Unit = { _, _ -> },
        isCancelled: () -> Boolean = { false },
    ) = wrap(path) {
        val total = channel.stat(path).size
        val monitor = Monitor(total, onProgress, isCancelled)
        channel.get(path, out, monitor)
        out.flush()
        if (monitor.cancelled) throw SshError.Cancelled()
    }

    /** Streams [input] into a remote file, replacing it. [size] may be -1 when unknown. */
    @Synchronized
    fun upload(
        input: InputStream, remotePath: String, size: Long,
        onProgress: (Long, Long) -> Unit = { _, _ -> },
        isCancelled: () -> Boolean = { false },
    ) = wrap(remotePath) {
        val monitor = Monitor(size, onProgress, isCancelled)
        channel.put(input, remotePath, monitor, ChannelSftp.OVERWRITE)
        if (monitor.cancelled) {
            runCatching { channel.rm(remotePath) } // do not leave a half-written file behind
            throw SshError.Cancelled()
        }
    }

    private class Monitor(
        private val total: Long,
        private val onProgress: (Long, Long) -> Unit,
        private val isCancelled: () -> Boolean,
    ) : SftpProgressMonitor {
        private var done = 0L
        var cancelled = false
        override fun init(op: Int, src: String?, dest: String?, max: Long) = onProgress(0, total)
        override fun count(count: Long): Boolean {
            done += count
            onProgress(done, total)
            if (isCancelled()) cancelled = true
            return !cancelled
        }
        override fun end() = Unit
    }

    private inline fun <T> wrap(path: String, block: () -> T): T = try {
        block()
    } catch (e: SftpException) {
        throw mapError(e, path)
    }

    private fun mapError(e: SftpException, path: String): SshError = when {
        e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE -> SshError.NoSuchFile(path, e)
        e.id == ChannelSftp.SSH_FX_PERMISSION_DENIED -> SshError.PermissionDenied(path, e)
        !channel.isConnected -> SshError.Disconnected(e)
        else -> SshError.Other(e.message?.takeIf { it.isNotBlank() } ?: "SFTP error ${e.id}", e)
    }

    override fun close() {
        runCatching { channel.disconnect() }
    }
}
