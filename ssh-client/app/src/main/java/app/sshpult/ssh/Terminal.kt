package app.sshpult.ssh

import com.jcraft.jsch.ChannelShell
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.Closeable
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

/** Immutable view of the terminal text. [revision] changes on every update. */
data class TerminalSnapshot(val lines: List<String>, val revision: Long)

/**
 * Turns the raw byte stream of a `TERM=dumb` shell into plain lines of text.
 *
 * This is deliberately not a full VT100 emulator: it understands newlines, carriage
 * returns, backspace, tabs, "erase line/screen" and silently drops every other escape
 * sequence (colours, cursor addressing). That is enough for a command console; full-screen
 * programs such as vim or htop are out of scope.
 */
class TerminalBuffer(private val maxLines: Int = 3000) {
    private val done = ArrayList<String>()
    private val current = StringBuilder()
    private var col = 0
    private var revision = 0L

    private val decoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPLACE)
        .onUnmappableCharacter(CodingErrorAction.REPLACE)
    private var pending = ByteBuffer.allocate(0)

    private enum class Esc { NONE, ESC, CSI, OSC, OSC_ESC, SKIP_ONE }
    private var esc = Esc.NONE
    private val csi = StringBuilder()

    @Synchronized
    fun feed(bytes: ByteArray, length: Int = bytes.size) {
        val input = ByteBuffer.allocate(pending.remaining() + length)
        input.put(pending).put(bytes, 0, length).flip()
        val chars = CharBuffer.allocate(input.remaining() + 4)
        decoder.decode(input, chars, false)
        pending = ByteBuffer.allocate(input.remaining()).put(input).apply { flip() } // incomplete UTF-8 tail
        chars.flip()
        while (chars.hasRemaining()) accept(chars.get())
        revision++
    }

    @Synchronized
    fun feedText(text: String) {
        for (c in text) accept(c)
        revision++
    }

    @Synchronized
    fun clear() {
        done.clear(); current.setLength(0); col = 0; revision++
    }

    @Synchronized
    fun snapshot(): TerminalSnapshot {
        val lines = ArrayList<String>(done.size + 1)
        lines.addAll(done)
        lines.add(current.toString())
        return TerminalSnapshot(lines, revision)
    }

    private fun accept(c: Char) {
        when (esc) {
            Esc.NONE -> plain(c)
            Esc.ESC -> when (c) {
                '[' -> { esc = Esc.CSI; csi.setLength(0) }
                ']' -> esc = Esc.OSC
                '(', ')', '#', '%' -> esc = Esc.SKIP_ONE
                else -> esc = Esc.NONE
            }
            Esc.SKIP_ONE -> esc = Esc.NONE
            Esc.CSI -> if (c in '@'..'~') { esc = Esc.NONE; applyCsi(c) } else if (csi.length < 32) csi.append(c)
            Esc.OSC -> when (c) {
                '\u0007' -> esc = Esc.NONE
                '\u001b' -> esc = Esc.OSC_ESC
                else -> Unit
            }
            Esc.OSC_ESC -> esc = if (c == '\\') Esc.NONE else Esc.OSC
        }
    }

    private fun plain(c: Char) {
        when (c) {
            '\u001b' -> esc = Esc.ESC
            '\n' -> newLine()
            '\r' -> col = 0
            '\b' -> if (col > 0) col--
            '\t' -> { val target = (col / 8 + 1) * 8; while (col < target) put(' ') }
            else -> if (c >= ' ' && c != '\u007f') put(c)
        }
    }

    private fun put(c: Char) {
        while (current.length < col) current.append(' ')
        if (col < current.length) current.setCharAt(col, c) else current.append(c)
        col++
    }

    private fun newLine() {
        done.add(current.toString())
        current.setLength(0)
        col = 0
        if (done.size > maxLines) done.subList(0, done.size - maxLines).clear()
    }

    private fun applyCsi(final: Char) {
        val n = csi.toString().takeWhile { it.isDigit() }.toIntOrNull()
        when (final) {
            'K' -> when (n ?: 0) {
                0 -> if (col < current.length) current.setLength(col)
                2 -> { current.setLength(0) }
            }
            'J' -> if (n == 2 || n == 3) { done.clear(); current.setLength(0); col = 0 }
            'C' -> col += (n ?: 1).coerceIn(1, 500)
            'D' -> col = (col - (n ?: 1)).coerceAtLeast(0)
            'G' -> col = ((n ?: 1) - 1).coerceIn(0, 500)
        }
    }
}

/** An interactive login shell: output is exposed as text, input is sent as keystrokes. */
class ShellSession internal constructor(
    private val channel: ChannelShell,
    private val input: InputStream,
    private val output: OutputStream,
) : Closeable {
    private val buffer = TerminalBuffer()
    private val _screen = MutableStateFlow(buffer.snapshot())
    val screen: StateFlow<TerminalSnapshot> = _screen
    private val _closed = MutableStateFlow(false)
    /** Becomes true when the remote shell exits or the connection drops. */
    val closed: StateFlow<Boolean> = _closed

    private val reader = Thread({
        val buf = ByteArray(8192)
        try {
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                buffer.feed(buf, n)
                _screen.value = buffer.snapshot()
            }
        } catch (e: Exception) {
            // stream closed: fall through
        } finally {
            _closed.value = true
        }
    }, "ssh-shell-reader").apply { isDaemon = true; start() }

    /** Sends raw text (no newline added). Blocking. */
    fun send(text: String) {
        synchronized(output) {
            try {
                output.write(text.toByteArray(Charsets.UTF_8))
                output.flush()
            } catch (e: Exception) {
                _closed.value = true
                throw SshError.Disconnected(e)
            }
        }
    }

    fun sendLine(line: String) = send(line + "\r")

    fun resize(cols: Int, rows: Int) {
        runCatching { channel.setPtySize(cols.coerceIn(20, 500), rows.coerceIn(5, 200), 0, 0) }
    }

    fun clearScreen() {
        buffer.clear()
        _screen.value = buffer.snapshot()
    }

    override fun close() {
        runCatching { channel.disconnect() }
        reader.interrupt()
    }

    companion object {
        const val CTRL_C = "\u0003"
        const val CTRL_D = "\u0004"
        const val CTRL_Z = "\u001a"
        const val TAB = "\t"
    }
}
