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

/**
 * Turns a raw byte stream into plain lines of text (the interactive terminal itself uses the
 * full [TerminalEmulator]; this light version is for simple, line-oriented output).
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
        return TerminalSnapshot(lines, revision, col)
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

/** An interactive login shell on a real PTY: output is emulated into a screen, input is sent as keystrokes. */
class ShellSession internal constructor(
    private val channel: ChannelShell,
    private val input: InputStream,
    private val output: OutputStream,
    cols: Int = 80, rows: Int = 24,
) : Closeable {
    private val emulator = TerminalEmulator(cols, rows, reply = { answer -> runCatching { send(answer) } })
    private val _screen = MutableStateFlow(emulator.snapshot())
    val screen: StateFlow<TerminalSnapshot> = _screen
    private val _closed = MutableStateFlow(false)
    /** Becomes true when the remote shell exits or the connection drops. */
    val closed: StateFlow<Boolean> = _closed

    private val reader = Thread({
        val buf = ByteArray(16384)
        try {
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                emulator.feed(buf, n)
                _screen.value = emulator.snapshot()
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

    /** Size the remote side currently sees. */
    val columns: Int get() = emulator.cols
    val rows: Int get() = emulator.rows

    fun sendLine(line: String) = send(line + "\r")

    /** Arrow keys depend on a mode full-screen programs switch on (vim, less, menus). */
    fun arrow(direction: Char): String = (if (emulator.applicationCursorKeys) "\u001bO" else "\u001b[") + direction

    /** Sends pasted text the way the remote program expects it (as one block, never run line by line by an editor). */
    fun paste(text: String) {
        val clean = text.replace("\r\n", "\r").replace('\n', '\r')
        send(if (emulator.bracketedPaste) "\u001b[200~$clean\u001b[201~" else clean)
    }

    fun resize(cols: Int, rows: Int) {
        val c = cols.coerceIn(TerminalEmulator.MIN_COLS, TerminalEmulator.MAX_COLS)
        val r = rows.coerceIn(TerminalEmulator.MIN_ROWS, TerminalEmulator.MAX_ROWS)
        if (c == emulator.cols && r == emulator.rows) return
        emulator.resize(c, r)
        _screen.value = emulator.snapshot()
        runCatching { channel.setPtySize(c, r, 0, 0) }
    }

    /** Drops the history and asks the shell to repaint (Ctrl+L). */
    fun clearScreen() {
        emulator.clearScrollback()
        _screen.value = emulator.snapshot()
        runCatching { send("\u000c") }
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
        const val ESC = "\u001b"
        const val BACKSPACE = "\u007f"
        const val ENTER = "\r"
        const val UP = "\u001b[A"
        const val DOWN = "\u001b[B"
        const val RIGHT = "\u001b[C"
        const val LEFT = "\u001b[D"
        const val HOME = "\u001b[H"
        const val END = "\u001b[F"
        const val PAGE_UP = "\u001b[5~"
        const val PAGE_DOWN = "\u001b[6~"

        /** Ctrl+letter as the byte a terminal would send (Ctrl+C -> 0x03); null if there is none. */
        fun control(c: Char): String? {
            val u = c.uppercaseChar()
            return if (u in '@'..'_') (u.code - 64).toChar().toString() else null
        }
    }
}
