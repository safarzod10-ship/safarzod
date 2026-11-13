package app.sshpult

import app.sshpult.ssh.TermFlags
import app.sshpult.ssh.TerminalEmulator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

class TerminalEmulatorTest {
    private fun resource(name: String) =
        javaClass.getResourceAsStream("/term/$name") ?: error("missing fixture $name (run tools/gen_terminal_fixtures.py)")

    /**
     * Replays what a real program wrote to an 80x24 xterm and expects exactly the screen a
     * reference emulator (pyte) produced — fed in random-sized chunks, the way a network delivers it.
     */
    private fun replay(name: String, compareCursor: Boolean = true) {
        val raw = resource("$name.raw").readBytes()
        val expected = resource("$name.screen").bufferedReader(Charsets.UTF_8).readText().trimEnd('\n').split("\n")
            .let { it + List(24 - it.size) { "" } }
        for (seed in 1..3) {
            val emulator = TerminalEmulator(80, 24)
            val random = Random(seed)
            var offset = 0
            while (offset < raw.size) {
                val n = minOf(raw.size - offset, if (seed == 1) raw.size else random.nextInt(1, 400))
                emulator.feed(raw.copyOfRange(offset, offset + n))
                offset += n
            }
            val actual = emulator.screenText()
            for (row in 0 until 24) assertEquals("$name row $row (seed $seed)", expected[row], actual[row])
            if (compareCursor) {
                val (y, x) = resource("$name.cursor").bufferedReader().readText().trim().split(" ").map { it.toInt() }
                // the reference parks a cursor that is "past the last column" one cell further right
                assertEquals("$name cursor", y to minOf(x, 79), emulator.cursor())
            }
        }
    }

    @Test fun vimEditing() = replay("vim_edit")
    @Test fun vimScrollingAndSearch() = replay("vim_scroll")
    @Test fun nano() = replay("nano")
    @Test fun less() = replay("less")
    @Test fun htop() = replay("htop")
    @Test fun top() = replay("top")
    @Test fun midnightCommander() = replay("mc")
    // On exit mc leaves the alternate screen; xterm then puts the cursor back where it was before mc
    // started. The reference emulator has no alternate screen, so only the screens are compared.
    @Test fun midnightCommanderMenus() = replay("mc_lines", compareCursor = false)
    @Test fun bashSession() = replay("bash")
    @Test fun cursorAddressingInsertDeleteAndScrollRegions() = replay("tput")

    private fun term(cols: Int = 20, rows: Int = 5, replies: MutableList<String>? = null) =
        TerminalEmulator(cols, rows, reply = { replies?.add(it) })

    private fun TerminalEmulator.type(s: String) = feed(s.toByteArray())

    @Test fun historyKeepsWhatScrolledOffAndSnapshotEndsAtTheCursorLine() {
        val t = term()
        t.type((1..12).joinToString("") { "row $it\r\n" } + "$ ")
        val s = t.snapshot()
        assertEquals((1..12).map { "row $it" } + "$", s.lines) // trailing blanks are not part of the text
        assertEquals(s.lines.lastIndex, s.cursorLine)
        assertEquals(2, s.cursorColumn)
        assertFalse(s.fullScreen)
    }

    @Test fun fullScreenProgramDoesNotPolluteHistory() {
        val t = term()
        t.type("before\r\n$ vim\r\n")
        t.type("\u001b[?1049h\u001b[2J\u001b[Hfile contents\u001b[5;1H-- INSERT --")
        val inside = t.snapshot()
        assertTrue(inside.fullScreen)
        assertEquals(5, inside.lines.size)                  // exactly the screen, no history above it
        assertEquals("file contents", inside.lines[0])
        assertEquals("-- INSERT --", inside.lines[4])
        t.type("\u001b[?1049l")
        val after = t.snapshot()
        assertFalse(after.fullScreen)
        assertEquals(listOf("before", "$ vim", ""), after.lines)
    }

    @Test fun programsGetAnswersToTheirQuestions() {
        val replies = ArrayList<String>()
        val t = term(replies = replies)
        t.type("ab\r\ncd\u001b[6n\u001b[5n\u001b[c")
        assertEquals(listOf("\u001b[2;3R", "\u001b[0n", "\u001b[?1;2c"), replies)
    }

    @Test fun modesThatChangeHowKeysAreSent() {
        val t = term()
        assertFalse(t.applicationCursorKeys)
        assertFalse(t.bracketedPaste)
        t.type("\u001b[?1h\u001b[?2004h")
        assertTrue(t.applicationCursorKeys)
        assertTrue(t.bracketedPaste)
        t.type("\u001b[?1l\u001b[?2004l")
        assertFalse(t.applicationCursorKeys)
    }

    @Test fun coloursBecomeStyleRuns() {
        val t = term(cols = 40)
        t.type("plain \u001b[1;31mred\u001b[0m \u001b[38;5;46mg\u001b[38;2;1;2;3mt\u001b[0;7minv\u001b[0m")
        val line = t.snapshot().styled.last()
        assertEquals("plain red gtinv", line.text)
        val red = line.runs.single { it.start == 6 }
        assertEquals(9, red.end)
        assertEquals(TerminalEmulator.PALETTE[1], red.fg)
        assertTrue(red.flags and TermFlags.BOLD != 0)
        assertEquals(TerminalEmulator.color256(46), line.runs.single { it.start == 10 }.fg)
        assertEquals(0xFF010203.toInt(), line.runs.single { it.start == 11 }.fg)
        assertTrue(line.runs.single { it.start == 12 }.flags and TermFlags.INVERSE != 0)
    }

    @Test fun longLinesWrapAtTheRightEdge() {
        val t = term(cols = 10, rows = 4)
        t.type("0123456789ABCDEF\r\nz")
        assertEquals(listOf("0123456789", "ABCDEF", "z"), t.snapshot().lines)
    }

    @Test fun wideCharactersTakeTwoCellsAndCursorIndexStaysInText() {
        val t = term(cols = 10)
        t.type("日本x")
        val s = t.snapshot()
        assertEquals("日本x", s.lines.last())
        assertEquals(5, t.cursor().second)   // two wide characters = four cells, plus one
        assertEquals(3, s.cursorColumn)      // but three characters into the text
    }

    @Test fun utf8SplitAcrossReads() {
        val t = term()
        for (b in "Привет €".toByteArray()) t.feed(byteArrayOf(b))
        assertEquals("Привет €", t.snapshot().lines.last())
    }

    @Test fun shrinkingMovesTopRowsIntoHistoryAndGrowingKeepsContent() {
        val t = term(cols = 20, rows = 5)
        t.type("a\r\nb\r\nc\r\nd\r\ne")
        t.resize(10, 3)                       // keyboard opened: fewer rows
        assertEquals(listOf("c", "d", "e"), t.screenText())
        assertEquals(listOf("a", "b", "c", "d", "e"), t.snapshot().lines)
        t.resize(30, 6)
        assertEquals(listOf("a", "b", "c", "d", "e"), t.snapshot().lines)
        t.type("\r\nf")
        assertEquals("f", t.snapshot().lines.last())
    }

    @Test fun garbageNeverCrashes() {
        val random = Random(7)
        val t = term(cols = 30, rows = 8)
        repeat(300) {
            val junk = ByteArray(random.nextInt(1, 200)) {
                when (random.nextInt(6)) { 0 -> 0x1b; 1 -> '['.code.toByte(); 2 -> ';'.code.toByte(); else -> random.nextInt(256).toByte() }
            }
            t.feed(junk)
            if (it % 40 == 0) t.resize(random.nextInt(1, 90), random.nextInt(1, 40))
        }
        t.type("\u001bc\r\nok")
        assertEquals("ok", t.snapshot().lines.last())
    }
}
