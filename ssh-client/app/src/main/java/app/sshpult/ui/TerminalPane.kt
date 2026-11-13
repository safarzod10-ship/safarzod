package app.sshpult.ui

import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextDecoration
import app.sshpult.data.AppRepository
import app.sshpult.ssh.StyledLine
import app.sshpult.ssh.TermFlags
import kotlinx.coroutines.delay
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.neverEqualPolicy
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.key.utf16CodePoint
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sshpult.R
import app.sshpult.ssh.SessionManager
import app.sshpult.ssh.ShellSession
import app.sshpult.ssh.SshError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private fun terminalStyle(size: TextUnit) = TextStyle(
    fontFamily = FontFamily.Monospace, fontSize = size, lineHeight = size * 1.3f, color = TerminalColors.text,
)

/** Terminal line as styled text, with a block cursor at [cursor] (or -1 for none). */
private fun StyledLine.toAnnotated(cursor: Int): AnnotatedString = buildAnnotatedString {
    val padded = if (cursor >= text.length) text.padEnd(cursor + 1, ' ') else text.ifEmpty { " " }
    append(padded)
    for (r in runs) {
        val inverse = r.flags and TermFlags.INVERSE != 0
        var fg = if (r.fg != 0) Color(r.fg) else TerminalColors.text
        var bg = if (r.bg != 0) Color(r.bg) else Color.Unspecified
        if (inverse) {
            val f = fg
            fg = if (r.bg != 0) Color(r.bg) else TerminalColors.background
            bg = f
        }
        if (r.flags and TermFlags.DIM != 0) fg = fg.copy(alpha = 0.6f)
        addStyle(
            SpanStyle(
                color = fg, background = bg,
                fontWeight = if (r.flags and TermFlags.BOLD != 0) FontWeight.Bold else null,
                fontStyle = if (r.flags and TermFlags.ITALIC != 0) FontStyle.Italic else null,
                textDecoration = if (r.flags and TermFlags.UNDERLINE != 0) TextDecoration.Underline else null,
            ),
            r.start, r.end.coerceAtMost(padded.length),
        )
    }
    if (cursor in padded.indices) addStyle(SpanStyle(background = TerminalColors.cursor, color = TerminalColors.background), cursor, cursor + 1)
}

@Composable
fun TerminalPane(session: SessionManager.ManagedSession) {
    val context = LocalContext.current
    var generation by remember { mutableIntStateOf(0) }
    var shell by remember { mutableStateOf<ShellSession?>(null) }
    var failure by remember { mutableStateOf<SshError?>(null) }
    LaunchedEffect(session, generation) {
        failure = null
        try {
            shell = session.shell()
        } catch (e: SshError) {
            failure = e
        }
    }
    val sh = shell
    when {
        sh != null -> TerminalContent(sh, onReopen = { generation++ })
        failure != null -> StatusBox(errorText(context, failure!!), warning = true) {
            Button(onClick = { generation++ }) { Text(stringResource(R.string.action_retry)) }
        }
        else -> StatusBox(stringResource(R.string.terminal_opening), progress = true)
    }
}

/**
 * The terminal has two ways to type, switched with one key:
 *  - direct: every keystroke goes straight to the shell, like a desktop terminal
 *    (Tab completion, shell history with the arrows, passwords are not shown);
 *  - compose: the command is written and edited in a separate field and sent as a whole.
 */
@Composable
private fun TerminalContent(shell: ShellSession, onReopen: () -> Unit) {
    val app = LocalApp.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val data by app.repository.data.collectAsStateWithLifecycle()
    val direct = data.settings.terminalDirectInput
    val screen by shell.screen.collectAsStateWithLifecycle()
    val closed by shell.closed.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    var stickToBottom by remember { mutableStateOf(true) }
    var ctrlArmed by remember { mutableStateOf(false) }
    val history = remember { mutableStateListOf<String>() }
    val directFocus = remember { FocusRequester() }
    val composeFocus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var fontSp by remember { mutableFloatStateOf(data.settings.terminalFontSize) }
    var currentCols by remember { mutableIntStateOf(80) }

    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
            if (!scrolling) stickToBottom = !listState.canScrollForward
        }
    }
    LaunchedEffect(screen.revision) {
        if (stickToBottom && screen.lines.isNotEmpty()) listState.scrollToItem(screen.lines.lastIndex)
    }

    fun send(text: String) {
        if (text.isEmpty()) return
        stickToBottom = true
        scope.launch(Dispatchers.IO) { runCatching { shell.send(text) } }
    }
    /** Applies a pending Ctrl to typed text: Ctrl then "c" sends 0x03. */
    fun typed(text: String) {
        if (ctrlArmed && text.length == 1) {
            ctrlArmed = false
            send(ShellSession.control(text[0]) ?: text)
        } else send(text)
    }
    fun focusInput() {
        runCatching { (if (direct) directFocus else composeFocus).requestFocus() }
        keyboard?.show()
    }

    Column(Modifier.fillMaxSize().background(TerminalColors.background)) {
        BoxWithConstraints(
            Modifier.weight(1f).fillMaxWidth().testTag("terminal-output")
                // Two fingers: pinch to change the font size (and with it how many columns fit).
                .pointerInput(Unit) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        do {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            if (event.changes.count { it.pressed } >= 2) {
                                val zoom = event.calculateZoom()
                                if (zoom != 1f) fontSp = (fontSp * zoom).coerceIn(AppRepository.MIN_FONT, AppRepository.MAX_FONT)
                                event.changes.forEach { it.consume() }
                            }
                        } while (event.changes.any { it.pressed })
                    }
                }
                .pointerInput(direct) { detectTapGestures(onTap = { focusInput() }) },
        ) {
            val measurer = rememberTextMeasurer()
            val density = LocalDensity.current
            // The size is in dp, not sp: the terminal has its own zoom and must not shrink to a
            // handful of columns just because the system font is set to "large".
            val style = remember(fontSp, density) { terminalStyle(with(density) { fontSp.dp.toSp() }) }
            val probe = remember(density, style) { measurer.measure("MMMMMMMMMMMMMMMMMMMM", style, softWrap = false) }
            val cellWidth = probe.size.width / 20f
            val padPx = with(density) { 6.dp.roundToPx() }
            val cols = ((constraints.maxWidth - 2 * padPx) / cellWidth.coerceAtLeast(1f)).toInt()
            val rows = (constraints.maxHeight - padPx) / probe.size.height.coerceAtLeast(1)
            currentCols = cols
            LaunchedEffect(shell, cols, rows) { withContext(Dispatchers.IO) { shell.resize(cols, rows) } }
            SelectionContainer {
                LazyColumn(state = listState, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 3.dp), modifier = Modifier.fillMaxSize()) {
                    items(count = screen.styled.size) { i ->
                        val line = screen.styled[i]
                        val cursor = if (i == screen.cursorLine && screen.cursorVisible && !closed) screen.cursorColumn else -1
                        Text(remember(line, cursor) { line.toAnnotated(cursor) }, style = style, softWrap = false, maxLines = 1)
                    }
                }
            }
            // While zooming, show what the remote side now sees as the window size.
            var sizeHint by remember { mutableStateOf(false) }
            LaunchedEffect(fontSp) {
                if (fontSp != data.settings.terminalFontSize) {
                    sizeHint = true
                    delay(450)
                    app.repository.setTerminalFontSize(fontSp)
                    delay(900)
                }
                sizeHint = false
            }
            if (sizeHint) {
                Text(
                    "$cols × $rows", color = TerminalColors.background, fontFamily = FontFamily.Monospace, fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.align(Alignment.TopEnd).padding(10.dp).clip(RoundedCornerShape(10.dp))
                        .background(TerminalColors.cursor).padding(horizontal = 10.dp, vertical = 5.dp),
                )
            }
            if (direct && !closed) DirectInput(directFocus, onText = ::typed, onKey = ::send, arrow = shell::arrow)
        }

        if (closed) {
            Row(
                Modifier.fillMaxWidth().background(TerminalColors.keys).padding(start = 14.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.terminal_closed), Modifier.weight(1f), color = TerminalColors.text, fontSize = 14.sp)
                TextButton(onClick = onReopen) { Text(stringResource(R.string.terminal_reopen), color = TerminalColors.cursor) }
            }
        }

        var recall by remember { mutableStateOf<String?>(null) }
        var historyIndex by remember { mutableIntStateOf(-1) }
        fun recallStep(step: Int) {
            if (history.isEmpty()) return
            val next = when {
                historyIndex == -1 && step < 0 -> history.lastIndex
                historyIndex == -1 -> return
                else -> historyIndex + step
            }
            if (next > history.lastIndex) { historyIndex = -1; recall = "" }
            else { historyIndex = next.coerceAtLeast(0); recall = history[historyIndex] }
        }

        KeyRow(
            direct = direct, enabled = !closed, ctrlArmed = ctrlArmed,
            onToggleMode = { app.repository.setTerminalDirectInput(!direct) },
            onCtrl = { ctrlArmed = !ctrlArmed },
            onSend = { ctrlArmed = false; send(it) },
            onSymbol = { if (direct) typed(it) else recall = "\u0000$it" }, // \u0000 prefix = "append"
            onUp = { if (direct) send(shell.arrow('A')) else recallStep(-1) },
            onDown = { if (direct) send(shell.arrow('B')) else recallStep(1) },
            arrow = shell::arrow,
            // Shrink (or grow) the font so that exactly 80 columns fit — what most programs expect.
            onFit80 = { fontSp = (fontSp * currentCols / 80.6f).coerceIn(AppRepository.MIN_FONT, AppRepository.MAX_FONT) },
            onPaste = {
                val clip = (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
                val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString().orEmpty()
                if (text.isNotEmpty()) {
                    stickToBottom = true
                    scope.launch(Dispatchers.IO) { runCatching { shell.paste(text) } }
                }
            },
            onKeyboard = ::focusInput,
            onClear = { shell.clearScreen() },
            onCopy = { copyToClipboard(context, "terminal", screen.lines.joinToString("\n").trimEnd()) },
        )
        if (!direct) {
            ComposeBar(
                enabled = !closed, history = history, focus = composeFocus, ctrlArmed = ctrlArmed,
                incoming = recall, onIncomingConsumed = { recall = null },
                onControl = { c -> ctrlArmed = false; send(ShellSession.control(c) ?: c.toString()) },
                onSubmit = { line, secret ->
                    if (!secret && line.isNotBlank() && history.lastOrNull() != line) history.add(line)
                    historyIndex = -1
                    send(line + ShellSession.ENTER)
                },
            )
        }
    }
}

/** What the invisible field holds between keystrokes, so that Backspace always has something to delete. */
private const val SENTINEL = "  "
private fun sentinelValue() = TextFieldValue(SENTINEL, TextRange(SENTINEL.length))

/**
 * Invisible text field that turns soft-keyboard and hardware-keyboard input into terminal
 * keystrokes. It is reset after every change, so it never accumulates text.
 */
@Composable
private fun DirectInput(focus: FocusRequester, onText: (String) -> Unit, onKey: (String) -> Unit, arrow: (Char) -> String) {
    // neverEqualPolicy: writing the same sentinel again must still push it back to the keyboard.
    var value by remember { mutableStateOf(sentinelValue(), neverEqualPolicy()) }
    val label = stringResource(R.string.terminal_direct_input)
    BasicTextField(
        value = value,
        onValueChange = { v ->
            val t = v.text
            when {
                t.length < SENTINEL.length -> repeat(SENTINEL.length - t.length) { onKey(ShellSession.BACKSPACE) }
                t.startsWith(SENTINEL) && t.length > SENTINEL.length ->
                    onText(t.substring(SENTINEL.length).replace("\n", ShellSession.ENTER))
            }
            value = sentinelValue()
        },
        singleLine = true,
        // "Password" keyboards deliver every key immediately, without word prediction rewriting text.
        keyboardOptions = KeyboardOptions(
            capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
            keyboardType = KeyboardType.Password, imeAction = ImeAction.Send,
        ),
        keyboardActions = KeyboardActions(onSend = { onKey(ShellSession.ENTER) }),
        textStyle = TextStyle(color = Color.Transparent, fontSize = 1.sp),
        cursorBrush = SolidColor(Color.Transparent),
        modifier = Modifier.size(1.dp).alpha(0f).focusRequester(focus).testTag("direct-input")
            .semantics { contentDescription = label }
            .onPreviewKeyEvent { e ->
                if (e.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                val seq = when (e.key) {
                    Key.Enter, Key.NumPadEnter -> ShellSession.ENTER
                    Key.Tab -> ShellSession.TAB
                    Key.Escape -> ShellSession.ESC
                    Key.Backspace -> ShellSession.BACKSPACE
                    Key.DirectionUp -> arrow('A')
                    Key.DirectionDown -> arrow('B')
                    Key.DirectionLeft -> arrow('D')
                    Key.DirectionRight -> arrow('C')
                    Key.MoveHome -> ShellSession.HOME
                    Key.MoveEnd -> ShellSession.END
                    Key.PageUp -> ShellSession.PAGE_UP
                    Key.PageDown -> ShellSession.PAGE_DOWN
                    else -> if (e.isCtrlPressed && e.utf16CodePoint in 32..126) ShellSession.control(e.utf16CodePoint.toChar()) else null
                }
                if (seq != null) onKey(seq)
                seq != null
            },
    )
}

@Composable
private fun TermKey(
    label: String? = null, icon: Int? = null, description: String? = null,
    enabled: Boolean = true, active: Boolean = false, onClick: () -> Unit,
) {
    val fg = when {
        !enabled -> TerminalColors.dim.copy(alpha = 0.45f)
        active -> TerminalColors.background
        else -> TerminalColors.text
    }
    Box(
        Modifier.height(36.dp).defaultMinSize(minWidth = 40.dp).clip(RoundedCornerShape(8.dp))
            .background(if (active) TerminalColors.cursor else Color.Transparent)
            .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (icon != null) Icon(painterResource(icon), description, Modifier.size(18.dp), tint = fg)
        else Text(label.orEmpty(), color = fg, fontFamily = FontFamily.Monospace, fontSize = 13.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun KeyRow(
    direct: Boolean, enabled: Boolean, ctrlArmed: Boolean,
    onToggleMode: () -> Unit, onCtrl: () -> Unit, onSend: (String) -> Unit, onSymbol: (String) -> Unit,
    onUp: () -> Unit, onDown: () -> Unit, onKeyboard: () -> Unit, onClear: () -> Unit, onCopy: () -> Unit,
    arrow: (Char) -> String, onPaste: () -> Unit, onFit80: () -> Unit,
) {
    Column {
        Box(Modifier.fillMaxWidth().height(1.dp).background(TerminalColors.line))
        Row(Modifier.fillMaxWidth().background(TerminalColors.keys), verticalAlignment = Alignment.CenterVertically) {
            // Mode switch stays put; the rest scrolls.
            TermKey(
                icon = if (direct) R.drawable.ic_compose else R.drawable.ic_keyboard,
                description = stringResource(if (direct) R.string.terminal_mode_compose else R.string.terminal_mode_direct),
                onClick = onToggleMode,
            )
            Box(Modifier.width(1.dp).height(20.dp).background(TerminalColors.line))
            Row(
                Modifier.weight(1f).horizontalScroll(rememberScrollState()).padding(horizontal = 4.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically,
            ) {
                TermKey("esc", enabled = enabled) { onSend(ShellSession.ESC) }
                TermKey("tab", enabled = enabled) { onSend(ShellSession.TAB) }
                TermKey("ctrl", enabled = enabled, active = ctrlArmed, onClick = onCtrl)
                TermKey("^C", enabled = enabled) { onSend(ShellSession.CTRL_C) }
                TermKey("^D", enabled = enabled) { onSend(ShellSession.CTRL_D) }
                TermKey(icon = R.drawable.ic_arrow_up, description = stringResource(R.string.terminal_history_prev), enabled = enabled, onClick = onUp)
                TermKey(icon = R.drawable.ic_arrow_down, description = stringResource(R.string.terminal_history_next), enabled = enabled, onClick = onDown)
                if (direct) {
                    TermKey("←", enabled = enabled) { onSend(arrow('D')) }
                    TermKey("→", enabled = enabled) { onSend(arrow('C')) }
                    TermKey("home", enabled = enabled) { onSend(ShellSession.HOME) }
                    TermKey("end", enabled = enabled) { onSend(ShellSession.END) }
                    TermKey("pgup", enabled = enabled) { onSend(ShellSession.PAGE_UP) }
                    TermKey("pgdn", enabled = enabled) { onSend(ShellSession.PAGE_DOWN) }
                }
                TermKey(stringResource(R.string.terminal_paste).lowercase(), enabled = enabled, onClick = onPaste)
                for (symbol in listOf("/", "-", "|", "~", "$", "&", "*", ".")) TermKey(symbol, enabled = enabled) { onSymbol(symbol) }
                if (direct) TermKey(icon = R.drawable.ic_keyboard, description = stringResource(R.string.terminal_keyboard), enabled = enabled, onClick = onKeyboard)
                TermKey("80⇔", onClick = onFit80)
                TermKey(icon = R.drawable.ic_copy, description = stringResource(R.string.terminal_copy_all), onClick = onCopy)
                TermKey(stringResource(R.string.terminal_clear).lowercase(), onClick = onClear)
            }
        }
    }
}

/**
 * The separate command field: prompt mark, monospace text, history suggestions while typing,
 * one-shot "secret" mode for passwords, and a solid send key.
 */
@Composable
private fun ComposeBar(
    enabled: Boolean, history: List<String>, focus: FocusRequester, ctrlArmed: Boolean,
    incoming: String?, onIncomingConsumed: () -> Unit,
    onControl: (Char) -> Unit, onSubmit: (line: String, secret: Boolean) -> Unit,
) {
    var value by remember { mutableStateOf(TextFieldValue("")) }
    var secret by remember { mutableStateOf(false) }

    // Text pushed in from the key row: a recalled history entry, or a symbol to append.
    LaunchedEffect(incoming) {
        val text = incoming ?: return@LaunchedEffect
        val next = if (text.startsWith("\u0000")) value.text + text.drop(1) else text
        value = TextFieldValue(next, TextRange(next.length))
        onIncomingConsumed()
    }
    fun submit() {
        val line = value.text
        onSubmit(line, secret)
        value = TextFieldValue("")
        secret = false
    }
    val suggestions = remember(value.text, history.size, secret) {
        val q = value.text.trim()
        if (secret || q.isEmpty()) emptyList()
        else history.asReversed().filter { it != q && it.contains(q, ignoreCase = true) }.distinct().take(3)
    }

    Column(Modifier.fillMaxWidth().background(TerminalColors.keys).padding(start = 8.dp, end = 8.dp, bottom = 8.dp, top = 2.dp)) {
        if (suggestions.isNotEmpty()) {
            Row(
                Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                suggestions.forEach { s ->
                    Surface(
                        onClick = { value = TextFieldValue(s, TextRange(s.length)) },
                        shape = RoundedCornerShape(8.dp), color = Color.Transparent,
                        border = BorderStroke(1.dp, TerminalColors.line),
                    ) {
                        Text(
                            s, Modifier.padding(horizontal = 10.dp, vertical = 6.dp), color = TerminalColors.dim,
                            fontFamily = FontFamily.Monospace, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
        Row(verticalAlignment = Alignment.Bottom) {
            Surface(
                modifier = Modifier.weight(1f), shape = RoundedCornerShape(12.dp), color = TerminalColors.background,
                border = BorderStroke(1.dp, if (enabled) TerminalColors.line else TerminalColors.line.copy(alpha = 0.5f)),
            ) {
                Row(Modifier.heightIn(min = 46.dp).padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("❯", color = TerminalColors.cursor, fontFamily = FontFamily.Monospace, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.width(10.dp))
                    Box(Modifier.weight(1f).padding(vertical = 10.dp), contentAlignment = Alignment.CenterStart) {
                        if (value.text.isEmpty()) {
                            Text(
                                stringResource(if (secret) R.string.terminal_secret_hint else R.string.terminal_input_hint),
                                color = TerminalColors.dim, fontFamily = FontFamily.Monospace, fontSize = 15.sp, maxLines = 1,
                            )
                        }
                        BasicTextField(
                            value = value,
                            onValueChange = { v ->
                                // Ctrl is armed: the next typed character becomes a control key instead of text.
                                if (ctrlArmed && v.text.length == value.text.length + 1 && v.selection.end > 0) {
                                    onControl(v.text[v.selection.end - 1])
                                } else value = v
                            },
                            enabled = enabled, maxLines = 4,
                            textStyle = TextStyle(color = TerminalColors.text, fontFamily = FontFamily.Monospace, fontSize = 15.sp, lineHeight = 20.sp),
                            cursorBrush = SolidColor(TerminalColors.cursor),
                            visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
                                keyboardType = if (secret) KeyboardType.Password else KeyboardType.Ascii,
                                imeAction = ImeAction.Send,
                            ),
                            keyboardActions = KeyboardActions(onSend = { submit() }),
                            modifier = Modifier.fillMaxWidth().focusRequester(focus).testTag("compose-input"),
                        )
                    }
                    Box(
                        Modifier.size(44.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled = enabled) { secret = !secret },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            painterResource(if (secret) R.drawable.ic_eye_off else R.drawable.ic_eye),
                            stringResource(if (secret) R.string.terminal_show_input else R.string.terminal_hide_input),
                            Modifier.size(20.dp), tint = if (secret) TerminalColors.cursor else TerminalColors.dim,
                        )
                    }
                }
            }
            Spacer(Modifier.width(8.dp))
            Box(
                Modifier.size(46.dp).clip(RoundedCornerShape(12.dp))
                    .background(if (enabled) TerminalColors.cursor else TerminalColors.line)
                    .clickable(enabled = enabled, onClick = ::submit),
                contentAlignment = Alignment.Center,
            ) {
                Icon(painterResource(R.drawable.ic_return), stringResource(R.string.terminal_send), Modifier.size(22.dp), tint = TerminalColors.background)
            }
        }
    }
}
