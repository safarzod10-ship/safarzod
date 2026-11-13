package app.sshpult

import app.sshpult.ssh.RemotePaths
import app.sshpult.ssh.ScriptRunner
import app.sshpult.ssh.TerminalBuffer
import app.sshpult.ssh.hostIdOf
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CoreUnitTest {
    private fun render(vararg chunks: String): List<String> {
        val t = TerminalBuffer()
        chunks.forEach { t.feed(it.toByteArray()) }
        return t.snapshot().lines
    }

    @Test fun plainLines() = assertEquals(listOf("a", "b", ""), render("a\r\nb\r\n"))

    @Test fun bareNewlineStartsAtColumnZero() = assertEquals(listOf("abc", "d"), render("abc\nd"))

    @Test fun carriageReturnOverwrites() = assertEquals(listOf("50% done"), render("10% done\r50%"))

    @Test fun backspaceAndEraseLine() = assertEquals(listOf("\$ ls"), render("\$ lx\b\u001b[Ks"))

    @Test fun coloursAndTitlesAreStripped() =
        assertEquals(listOf("red plain"), render("\u001b]0;title\u0007\u001b[1;31mred\u001b[0m plain"))

    @Test fun escapeSplitAcrossChunks() = assertEquals(listOf("ab"), render("a\u001b[3", "1mb"))

    @Test fun clearScreen() = assertEquals(listOf("new"), render("old\r\nmore\u001b[H\u001b[2Jnew"))

    @Test fun tabsAlignToEight() = assertEquals(listOf("a       b"), render("a\tb"))

    @Test fun utf8SplitAcrossChunks() {
        val bytes = "Привет, мир €".toByteArray()
        val t = TerminalBuffer()
        for (b in bytes) t.feed(byteArrayOf(b))
        assertEquals(listOf("Привет, мир €"), t.snapshot().lines)
    }

    @Test fun scrollbackIsBounded() {
        val t = TerminalBuffer(maxLines = 10)
        repeat(100) { t.feed("line $it\n".toByteArray()) }
        val lines = t.snapshot().lines
        assertEquals(11, lines.size)
        assertEquals("line 90", lines.first())
    }

    @Test fun binaryGarbageDoesNotCrash() {
        val t = TerminalBuffer()
        val junk = ByteArray(4096) { (it * 31 + 7).toByte() }
        t.feed(junk)
        t.feed("\nok".toByteArray())
        assertEquals("ok", t.snapshot().lines.last())
    }

    @Test fun scriptParsing() = assertEquals(
        listOf("uname -a", "cd /tmp && ls"),
        ScriptRunner.parse("# header\n\n  uname -a  \r\n#skip\ncd /tmp && ls\n"),
    )

    @Test fun remotePaths() {
        assertEquals("/a/b", RemotePaths.join("/a", "b"))
        assertEquals("/b", RemotePaths.join("/", "b"))
        assertEquals("/a", RemotePaths.parent("/a/b"))
        assertEquals("/", RemotePaths.parent("/a"))
        assertEquals("/", RemotePaths.parent("/"))
        assertEquals("/a", RemotePaths.parent("/a/b/"))
        assertEquals("b", RemotePaths.name("/a/b/"))
        assertTrue(RemotePaths.isValidName("file.txt"))
        assertFalse(RemotePaths.isValidName("../etc"))
        assertFalse(RemotePaths.isValidName(".."))
        assertFalse(RemotePaths.isValidName(" "))
    }

    @Test fun hostIds() {
        assertEquals("example.com", hostIdOf("example.com", 22))
        assertEquals("[example.com]:2222", hostIdOf("example.com", 2222))
    }
}
