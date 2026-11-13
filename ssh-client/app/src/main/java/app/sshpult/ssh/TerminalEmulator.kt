package app.sshpult.ssh

import java.nio.ByteBuffer
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

/** A run of equally styled characters inside a [StyledLine]. Colours are ARGB, 0 = terminal default. */
data class StyleRun(val start: Int, val end: Int, val fg: Int, val bg: Int, val flags: Int)

/** One immutable line of terminal text with its colours. */
class StyledLine(val text: String, val runs: List<StyleRun>) {
    companion object {
        val EMPTY = StyledLine("", emptyList())
    }
}

object TermFlags {
    const val BOLD = 1
    const val DIM = 2
    const val ITALIC = 4
    const val UNDERLINE = 8
    const val INVERSE = 16
}

/**
 * Immutable view of the terminal: scrollback followed by the visible screen.
 * [lines] is the plain text of [styled], kept for searching and copying.
 */
data class TerminalSnapshot(
    val lines: List<String>,
    val revision: Long,
    /** Index into the cursor's line text, and which line that is. */
    val cursorColumn: Int = 0,
    val cursorLine: Int = lines.lastIndex,
    val cursorVisible: Boolean = true,
    val styled: List<StyledLine> = emptyList(),
    /** A full-screen program (vim, htop, a dialog) owns the display. */
    val fullScreen: Boolean = false,
)

/**
 * An xterm-compatible terminal emulator (the subset real programs use): cursor addressing,
 * erase/insert/delete, scroll regions, alternate screen, 16/256/true colours, line-drawing
 * characters, auto-wrap, and the status replies programs ask for.
 *
 * Not thread-safe by itself: all public methods are synchronized.
 * @param reply sends an answer back to the remote program (cursor position reports etc.)
 */
class TerminalEmulator(
    cols: Int, rows: Int,
    private val maxScrollback: Int = 3000,
    private val reply: (String) -> Unit = {},
) {
    var cols = cols.coerceIn(MIN_COLS, MAX_COLS); private set
    var rows = rows.coerceIn(MIN_ROWS, MAX_ROWS); private set

    private class Row(n: Int) {
        var ch = CharArray(n) { ' ' }
        var fg = IntArray(n)
        var bg = IntArray(n)
        var fl = ByteArray(n)
        fun clear(from: Int, to: Int, bgColor: Int) {
            for (i in from.coerceAtLeast(0) until to.coerceAtMost(ch.size)) { ch[i] = ' '; fg[i] = 0; bg[i] = bgColor; fl[i] = 0 }
        }
        fun resized(n: Int): Row = Row(n).also { r ->
            val k = minOf(n, ch.size)
            System.arraycopy(ch, 0, r.ch, 0, k); System.arraycopy(fg, 0, r.fg, 0, k)
            System.arraycopy(bg, 0, r.bg, 0, k); System.arraycopy(fl, 0, r.fl, 0, k)
        }
    }

    private var main = Array(this.rows) { Row(this.cols) }
    private var alt = Array(this.rows) { Row(this.cols) }
    private var screen = main
    private val scrollback = ArrayList<StyledLine>()
    private var usingAlt = false

    private var cx = 0
    private var cy = 0
    private var wrapPending = false
    private var top = 0
    private var bottom = this.rows - 1
    private var fg = 0
    private var bg = 0
    private var flags = 0
    private var savedX = 0
    private var savedY = 0
    private var savedFg = 0
    private var savedBg = 0
    private var savedFlags = 0
    private var autoWrap = true
    private var originMode = false
    private var cursorVisible = true
    private var lineDrawing = false
    private var revision = 0L

    /** Arrow keys must be sent as `ESC O x` instead of `ESC [ x` while this is on. */
    @get:Synchronized var applicationCursorKeys = false; private set
    /** Pasted text must be wrapped in `ESC[200~ … ESC[201~` while this is on. */
    @get:Synchronized var bracketedPaste = false; private set

    private val decoder = Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPLACE).onUnmappableCharacter(CodingErrorAction.REPLACE)
    private var pending = ByteBuffer.allocate(0)

    private enum class State { GROUND, ESC, CSI, OSC, OSC_ESC, STRING, STRING_ESC, CHARSET, SKIP }
    private var state = State.GROUND
    private val params = StringBuilder()

    // ---- input ------------------------------------------------------------------------------

    @Synchronized
    fun feed(bytes: ByteArray, length: Int = bytes.size) {
        val input = ByteBuffer.allocate(pending.remaining() + length)
        input.put(pending).put(bytes, 0, length).flip()
        val chars = CharBuffer.allocate(input.remaining() + 4)
        decoder.decode(input, chars, false)
        pending = ByteBuffer.allocate(input.remaining()).put(input).apply { flip() }
        chars.flip()
        while (chars.hasRemaining()) accept(chars.get())
        revision++
    }

    @Synchronized
    fun feedText(text: String) {
        for (c in text) accept(c)
        revision++
    }

    private fun accept(c: Char) {
        when (state) {
            State.GROUND -> ground(c)
            State.ESC -> escape(c)
            State.CSI -> when {
                c in '@'..'~' -> { state = State.GROUND; csi(c) }
                c == '\u001b' -> state = State.ESC
                c < ' ' -> control(c)
                params.length < 64 -> params.append(c)
            }
            State.OSC -> when (c) {
                '\u0007' -> state = State.GROUND
                '\u001b' -> state = State.OSC_ESC
                else -> Unit
            }
            // ESC inside a string either ends it (ESC \) or starts a fresh sequence, as in xterm
            State.OSC_ESC, State.STRING_ESC -> if (c == '\\') state = State.GROUND else escape(c)
            State.STRING -> if (c == '\u001b') state = State.STRING_ESC else if (c == '\u0018' || c == '\u001a') state = State.GROUND
            State.CHARSET -> { lineDrawing = c == '0'; state = State.GROUND }
            State.SKIP -> state = State.GROUND
        }
    }

    private fun ground(c: Char) {
        if (c < ' ') control(c)
        else if (c != '\u007f') print(c)
    }

    private fun control(c: Char) {
        when (c) {
            '\u001b' -> state = State.ESC
            '\r' -> { cx = 0; wrapPending = false }
            '\n', '\u000b', '\u000c' -> lineFeed()
            '\b' -> { if (cx > 0) cx--; wrapPending = false }
            '\t' -> { cx = minOf(cols - 1, (cx / 8 + 1) * 8); wrapPending = false }
            else -> Unit // BEL, SO/SI and the rest
        }
    }

    private fun print(c0: Char) {
        var c = c0
        if (lineDrawing && c in '_'..'~') c = LINE_DRAWING[c - '_']
        if (wrapPending && autoWrap) {
            wrapPending = false
            cx = 0
            lineFeed()
        }
        val row = screen[cy]
        row.ch[cx] = c; row.fg[cx] = fg; row.bg[cx] = bg; row.fl[cx] = flags.toByte()
        if (isWide(c) && cx < cols - 1) {
            cx++
            row.ch[cx] = FILLER; row.fg[cx] = fg; row.bg[cx] = bg; row.fl[cx] = flags.toByte()
        }
        if (cx == cols - 1) wrapPending = true else cx++
    }

    private fun lineFeed() {
        wrapPending = false
        if (cy == bottom) scrollUp(1) else if (cy < rows - 1) cy++
    }

    private fun reverseIndex() {
        wrapPending = false
        if (cy == top) scrollDown(1) else if (cy > 0) cy--
    }

    private fun scrollUp(n: Int) {
        repeat(n.coerceIn(1, bottom - top + 1)) {
            val gone = screen[top]
            // Lines that leave the top of the normal screen become history.
            if (!usingAlt && top == 0) {
                scrollback.add(render(gone, -1).first)
                if (scrollback.size > maxScrollback) scrollback.subList(0, scrollback.size - maxScrollback).clear()
            }
            System.arraycopy(screen, top + 1, screen, top, bottom - top)
            screen[bottom] = Row(cols).also { it.clear(0, cols, bg) }
        }
    }

    private fun scrollDown(n: Int) {
        repeat(n.coerceIn(1, bottom - top + 1)) {
            System.arraycopy(screen, top, screen, top + 1, bottom - top)
            screen[top] = Row(cols).also { it.clear(0, cols, bg) }
        }
    }

    private fun escape(c: Char) {
        state = State.GROUND
        when (c) {
            '[' -> { state = State.CSI; params.setLength(0) }
            ']' -> state = State.OSC
            'P', '^', '_', 'X' -> state = State.STRING
            '(' -> state = State.CHARSET
            ')', '*', '+', '#', '%', ' ' -> state = State.SKIP
            '7' -> saveCursor()
            '8' -> restoreCursor()
            'D' -> lineFeed()
            'E' -> { cx = 0; lineFeed() }
            'M' -> reverseIndex()
            'c' -> reset()
            else -> Unit // keypad modes and anything unknown
        }
    }

    private fun saveCursor() { savedX = cx; savedY = cy; savedFg = fg; savedBg = bg; savedFlags = flags }
    private fun restoreCursor() {
        cx = savedX.coerceIn(0, cols - 1); cy = savedY.coerceIn(0, rows - 1)
        fg = savedFg; bg = savedBg; flags = savedFlags; wrapPending = false
    }

    private fun reset() {
        main = Array(rows) { Row(cols) }; alt = Array(rows) { Row(cols) }
        screen = main; usingAlt = false
        cx = 0; cy = 0; top = 0; bottom = rows - 1; fg = 0; bg = 0; flags = 0
        wrapPending = false; autoWrap = true; originMode = false; cursorVisible = true
        lineDrawing = false; applicationCursorKeys = false; bracketedPaste = false
    }

    // ---- CSI --------------------------------------------------------------------------------

    private fun csi(final: Char) {
        val raw = params.toString()
        val private = raw.startsWith("?")
        val secondary = raw.startsWith(">")
        val body = raw.trimStart('?', '>', '=', '<').filter { it.isDigit() || it == ';' || it == ':' }
        val args = if (body.isEmpty()) emptyList() else body.split(';')
        fun arg(i: Int, default: Int): Int =
            args.getOrNull(i)?.substringBefore(':')?.toIntOrNull()?.takeIf { it > 0 || default == 0 } ?: default
        if (raw.any { it in " !\"$'" } && final != 'm') return // sequences with intermediates we do not implement

        when (final) {
            'A' -> { cy = (cy - arg(0, 1)).coerceAtLeast(if (cy >= top) top else 0); wrapPending = false }
            'B', 'e' -> { cy = (cy + arg(0, 1)).coerceAtMost(if (cy <= bottom) bottom else rows - 1); wrapPending = false }
            'C', 'a' -> { cx = (cx + arg(0, 1)).coerceAtMost(cols - 1); wrapPending = false }
            'D' -> { cx = (cx - arg(0, 1)).coerceAtLeast(0); wrapPending = false }
            'E' -> { cy = (cy + arg(0, 1)).coerceAtMost(bottom); cx = 0; wrapPending = false }
            'F' -> { cy = (cy - arg(0, 1)).coerceAtLeast(top); cx = 0; wrapPending = false }
            'G', '`' -> { cx = (arg(0, 1) - 1).coerceIn(0, cols - 1); wrapPending = false }
            'd' -> { moveTo(arg(0, 1) - 1, cx) }
            'H', 'f' -> moveTo(arg(0, 1) - 1, arg(1, 1) - 1)
            'J' -> eraseDisplay(arg(0, 0))
            'K' -> when (arg(0, 0)) {
                0 -> screen[cy].clear(cx, cols, bg)
                1 -> screen[cy].clear(0, cx + 1, bg)
                2 -> screen[cy].clear(0, cols, bg)
            }
            'L' -> if (cy in top..bottom) { val keepTop = top; top = cy; scrollDown(arg(0, 1)); top = keepTop; cx = 0 }
            'M' -> if (cy in top..bottom) { val keepTop = top; top = cy; val a = usingAlt; usingAlt = true; scrollUp(arg(0, 1)); usingAlt = a; top = keepTop; cx = 0 }
            '@' -> shiftRight(arg(0, 1))
            'P' -> shiftLeft(arg(0, 1))
            'X' -> screen[cy].clear(cx, cx + arg(0, 1), bg)
            'S' -> if (!private) { val a = usingAlt; usingAlt = true; scrollUp(arg(0, 1)); usingAlt = a }
            'T' -> if (args.size <= 1) scrollDown(arg(0, 1))
            'r' -> if (!private) {
                val t = arg(0, 1) - 1
                val b = arg(1, rows) - 1
                if (t in 0 until b && b < rows) { top = t; bottom = b } else { top = 0; bottom = rows - 1 }
                moveTo(0, 0)
            }
            'm' -> if (!private && !secondary) sgr(body)
            'h' -> if (private) args.forEach { setPrivateMode(it.toIntOrNull() ?: 0, true) }
            'l' -> if (private) args.forEach { setPrivateMode(it.toIntOrNull() ?: 0, false) }
            'n' -> when (arg(0, 0)) {
                5 -> reply("\u001b[0n")
                6 -> reply("\u001b[${cy - (if (originMode) top else 0) + 1};${cx + 1}R")
            }
            'c' -> if (arg(0, 0) == 0) reply(if (secondary) "\u001b[>0;276;0c" else "\u001b[?1;2c")
            's' -> if (!private) saveCursor()
            'u' -> if (!private && body.isEmpty()) restoreCursor()
            else -> Unit
        }
    }

    private fun moveTo(row: Int, col: Int) {
        val base = if (originMode) top else 0
        val limit = if (originMode) bottom else rows - 1
        cy = (row + base).coerceIn(base, limit)
        cx = col.coerceIn(0, cols - 1)
        wrapPending = false
    }

    private fun eraseDisplay(mode: Int) {
        when (mode) {
            0 -> { screen[cy].clear(cx, cols, bg); for (y in cy + 1 until rows) screen[y].clear(0, cols, bg) }
            1 -> { for (y in 0 until cy) screen[y].clear(0, cols, bg); screen[cy].clear(0, cx + 1, bg) }
            2 -> for (y in 0 until rows) screen[y].clear(0, cols, bg)
            3 -> scrollback.clear()
        }
    }

    private fun shiftRight(n0: Int) {
        val n = n0.coerceAtMost(cols - cx)
        val r = screen[cy]
        System.arraycopy(r.ch, cx, r.ch, cx + n, cols - cx - n); System.arraycopy(r.fg, cx, r.fg, cx + n, cols - cx - n)
        System.arraycopy(r.bg, cx, r.bg, cx + n, cols - cx - n); System.arraycopy(r.fl, cx, r.fl, cx + n, cols - cx - n)
        r.clear(cx, cx + n, bg)
    }

    private fun shiftLeft(n0: Int) {
        val n = n0.coerceAtMost(cols - cx)
        val r = screen[cy]
        System.arraycopy(r.ch, cx + n, r.ch, cx, cols - cx - n); System.arraycopy(r.fg, cx + n, r.fg, cx, cols - cx - n)
        System.arraycopy(r.bg, cx + n, r.bg, cx, cols - cx - n); System.arraycopy(r.fl, cx + n, r.fl, cx, cols - cx - n)
        r.clear(cols - n, cols, bg)
    }

    private fun setPrivateMode(mode: Int, on: Boolean) {
        when (mode) {
            1 -> applicationCursorKeys = on
            6 -> { originMode = on; moveTo(0, 0) }
            7 -> autoWrap = on
            25 -> cursorVisible = on
            47, 1047 -> switchScreen(on, clear = on)
            1048 -> if (on) saveCursor() else restoreCursor()
            1049 -> {
                if (on) saveCursor()
                switchScreen(on, clear = on)
                if (!on) restoreCursor()
            }
            2004 -> bracketedPaste = on
        }
    }

    private fun switchScreen(toAlt: Boolean, clear: Boolean) {
        if (toAlt == usingAlt) return
        usingAlt = toAlt
        screen = if (toAlt) alt else main
        if (toAlt && clear) for (y in 0 until rows) screen[y].clear(0, cols, 0)
        top = 0; bottom = rows - 1; wrapPending = false
    }

    private fun sgr(body: String) {
        val p = (if (body.isEmpty()) "0" else body).split(';', ':').map { it.toIntOrNull() ?: 0 }
        var i = 0
        while (i < p.size) {
            when (val v = p[i]) {
                0 -> { fg = 0; bg = 0; flags = 0 }
                1 -> flags = flags or TermFlags.BOLD
                2 -> flags = flags or TermFlags.DIM
                3 -> flags = flags or TermFlags.ITALIC
                4 -> flags = flags or TermFlags.UNDERLINE
                7 -> flags = flags or TermFlags.INVERSE
                21, 22 -> flags = flags and (TermFlags.BOLD or TermFlags.DIM).inv()
                23 -> flags = flags and TermFlags.ITALIC.inv()
                24 -> flags = flags and TermFlags.UNDERLINE.inv()
                27 -> flags = flags and TermFlags.INVERSE.inv()
                in 30..37 -> fg = PALETTE[v - 30]
                39 -> fg = 0
                in 40..47 -> bg = PALETTE[v - 40]
                49 -> bg = 0
                in 90..97 -> fg = PALETTE[v - 90 + 8]
                in 100..107 -> bg = PALETTE[v - 100 + 8]
                38, 48 -> {
                    var color = 0
                    if (p.getOrNull(i + 1) == 5) { color = color256(p.getOrElse(i + 2) { 0 }); i += 2 }
                    else if (p.getOrNull(i + 1) == 2) {
                        // tolerate the colon form with an empty colour-space field
                        val o = if (p.size - i > 5) i + 3 else i + 2
                        color = rgb(p.getOrElse(o) { 0 }, p.getOrElse(o + 1) { 0 }, p.getOrElse(o + 2) { 0 })
                        i = o + 2
                    }
                    if (v == 38) fg = color else bg = color
                }
            }
            i++
        }
    }

    // ---- output -----------------------------------------------------------------------------

    @Synchronized
    fun resize(newCols0: Int, newRows0: Int) {
        val newCols = newCols0.coerceIn(MIN_COLS, MAX_COLS)
        val newRows = newRows0.coerceIn(MIN_ROWS, MAX_ROWS)
        if (newCols == cols && newRows == rows) return
        fun fit(old: Array<Row>, keepHistory: Boolean): Array<Row> {
            var src = old.toList()
            // When the screen gets shorter, lines above the cursor move into history.
            val overflow = (cy + 1 - newRows).coerceAtLeast(0)
            if (overflow > 0) {
                if (keepHistory) src.take(overflow).forEach { scrollback.add(render(it, -1).first) }
                src = src.drop(overflow)
                if (old === screen) cy -= overflow
            }
            return Array(newRows) { y -> src.getOrNull(y)?.resized(newCols) ?: Row(newCols) }
        }
        val wasAlt = usingAlt
        val newMain = if (!wasAlt) fit(main, true) else Array(newRows) { y -> main.getOrNull(y)?.resized(newCols) ?: Row(newCols) }
        val newAlt = if (wasAlt) fit(alt, false) else Array(newRows) { Row(newCols) }
        main = newMain; alt = newAlt; screen = if (wasAlt) alt else main
        cols = newCols; rows = newRows
        cx = cx.coerceIn(0, cols - 1); cy = cy.coerceIn(0, rows - 1)
        top = 0; bottom = rows - 1; wrapPending = false
        revision++
    }

    /** Every row of the visible screen as plain text (trailing blanks removed). */
    @Synchronized
    fun screenText(): List<String> = screen.map { render(it, -1).first.text.trimEnd() }

    /** Cursor position on the visible screen: row, column (both from 0). */
    @Synchronized
    fun cursor(): Pair<Int, Int> = cy to cx

    /** Forgets the history; the visible screen stays. */
    @Synchronized
    fun clearScrollback() { scrollback.clear(); revision++ }

    @Synchronized
    fun snapshot(): TerminalSnapshot {
        // The normal screen is shown down to its last used row; a full-screen program gets every row.
        var last = cy
        if (usingAlt) last = rows - 1
        else for (y in rows - 1 downTo cy + 1) if (screen[y].ch.any { it != ' ' }) { last = y; break }
        val styled = ArrayList<StyledLine>((if (usingAlt) 0 else scrollback.size) + last + 1)
        if (!usingAlt) styled.addAll(scrollback)
        var cursorIndex = 0
        for (y in 0..last) {
            val (line, index) = render(screen[y], if (y == cy) cx else -1)
            if (y == cy) cursorIndex = index
            styled.add(line)
        }
        return TerminalSnapshot(
            lines = styled.map { it.text }, revision = revision,
            cursorColumn = cursorIndex, cursorLine = styled.size - 1 - (last - cy),
            cursorVisible = cursorVisible, styled = styled, fullScreen = usingAlt,
        )
    }

    /** Converts a row to text + style runs; also maps [cursorCol] to an index in that text. */
    private fun render(row: Row, cursorCol: Int): Pair<StyledLine, Int> {
        var end = row.ch.size
        while (end > 0 && row.ch[end - 1] == ' ' && row.bg[end - 1] == 0 && row.fl[end - 1].toInt() and TermFlags.INVERSE == 0) end--
        val sb = StringBuilder(end)
        val runs = ArrayList<StyleRun>(4)
        var runStart = 0
        var cursorIndex = cursorCol.coerceAtLeast(0)
        var skipped = 0
        for (x in 0 until end) {
            if (x == cursorCol) cursorIndex = x - skipped
            if (row.ch[x] == FILLER) { skipped++; continue }
            val at = sb.length
            if (at > 0) {
                val px = x - 1 - (if (row.ch[x - 1] == FILLER) 1 else 0)
                if (px >= 0 && (row.fg[px] != row.fg[x] || row.bg[px] != row.bg[x] || row.fl[px] != row.fl[x])) {
                    if (row.fg[px] != 0 || row.bg[px] != 0 || row.fl[px].toInt() != 0) runs.add(StyleRun(runStart, at, row.fg[px], row.bg[px], row.fl[px].toInt()))
                    runStart = at
                }
            }
            sb.append(row.ch[x])
        }
        if (end > 0) {
            var lx = end - 1
            if (row.ch[lx] == FILLER && lx > 0) lx--
            if (row.fg[lx] != 0 || row.bg[lx] != 0 || row.fl[lx].toInt() != 0) runs.add(StyleRun(runStart, sb.length, row.fg[lx], row.bg[lx], row.fl[lx].toInt()))
        }
        if (cursorCol >= end) cursorIndex = cursorCol - skipped
        return StyledLine(sb.toString(), runs) to cursorIndex
    }

    companion object {
        const val MIN_COLS = 8
        const val MAX_COLS = 500
        const val MIN_ROWS = 2
        const val MAX_ROWS = 200
        private const val FILLER = '￿'

        private fun rgb(r: Int, g: Int, b: Int) = (0xFF shl 24) or ((r and 255) shl 16) or ((g and 255) shl 8) or (b and 255)

        /** The 16 base colours, tuned to sit well on the app's graphite terminal background. */
        val PALETTE = intArrayOf(
            rgb(0x3A, 0x3A, 0x37), rgb(0xF0, 0x5D, 0x5E), rgb(0x7F, 0xC8, 0x6A), rgb(0xE8, 0xC2, 0x5A),
            rgb(0x7A, 0xA6, 0xDA), rgb(0xC5, 0x8F, 0xD6), rgb(0x5F, 0xC4, 0xC0), rgb(0xD6, 0xD3, 0xCB),
            rgb(0x6E, 0x6B, 0x65), rgb(0xFF, 0x8A, 0x7A), rgb(0xA6, 0xE2, 0x8C), rgb(0xFF, 0xDB, 0x7A),
            rgb(0x9C, 0xC2, 0xF0), rgb(0xDD, 0xB0, 0xEC), rgb(0x8A, 0xE0, 0xDA), rgb(0xFF, 0xFF, 0xFF),
        )

        fun color256(n: Int): Int = when {
            n < 0 -> 0
            n < 16 -> PALETTE[n]
            n < 232 -> {
                val v = n - 16
                fun level(i: Int) = if (i == 0) 0 else 55 + 40 * i
                rgb(level(v / 36), level(v / 6 % 6), level(v % 6))
            }
            n < 256 -> (8 + 10 * (n - 232)).let { rgb(it, it, it) }
            else -> 0
        }

        /** DEC special graphics (box drawing), for characters `_` .. `~`. */
        private const val LINE_DRAWING = " ◆▒␉␌␍␊°±␤␋┘┐┌└┼⎺⎻─⎼⎽├┤┴┬│≤≥π≠£·"

        private fun isWide(c: Char): Boolean {
            val v = c.code
            return v in 0x1100..0x115F || v in 0x2E80..0xA4CF || v in 0xAC00..0xD7A3 ||
                v in 0xF900..0xFAFF || v in 0xFE30..0xFE4F || v in 0xFF00..0xFF60 || v in 0xFFE0..0xFFE6
        }
    }
}
