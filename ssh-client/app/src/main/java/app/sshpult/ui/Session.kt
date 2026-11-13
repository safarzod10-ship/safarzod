package app.sshpult.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sshpult.R
import app.sshpult.data.AuthType
import app.sshpult.data.ConnectionProfile
import app.sshpult.ssh.ConnState
import app.sshpult.ssh.SessionManager
import app.sshpult.ssh.ShellSession
import app.sshpult.ssh.SshConnection
import app.sshpult.ssh.SshError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Connects to [profileId] and shows [content] once the session is open. Everything that can
 * happen on the way — password prompt, first-time host key, changed host key, network and
 * sign-in errors, a dropped connection — is handled here, for every screen that needs a session.
 */
@Composable
fun ConnectionGate(
    profileId: String,
    onClose: () -> Unit,
    content: @Composable (SessionManager.ManagedSession, SshConnection) -> Unit,
) {
    val app = LocalApp.current
    val context = LocalContext.current
    val data by app.repository.data.collectAsStateWithLifecycle()
    val profile = data.connections.firstOrNull { it.id == profileId }
    if (profile == null) {
        StatusBox(stringResource(R.string.connection_missing)) {
            Button(onClick = onClose) { Text(stringResource(R.string.action_close)) }
        }
        return
    }
    val session = remember(profileId) { app.sessions.session(profileId) }
    val state by session.state.collectAsStateWithLifecycle()
    // Kept only in memory, only while this screen is open.
    var typedPassword by remember { mutableStateOf<String?>(null) }
    var localError by remember { mutableStateOf<SshError?>(null) }
    var askPassword by remember { mutableStateOf(false) }

    fun start(password: String? = typedPassword) {
        localError = null
        try {
            session.connect(app.repository.targetFor(profile, password))
        } catch (e: SshError.PasswordRequired) {
            askPassword = true
        } catch (e: SshError) {
            localError = e
        }
    }
    LaunchedEffect(profileId) { if (session.state.value is ConnState.Idle) start() }

    val current = state
    val error = localError ?: (current as? ConnState.Failed)?.error
    when {
        current is ConnState.Connected && localError == null -> content(session, current.connection)
        current is ConnState.Connecting -> StatusBox(stringResource(R.string.connecting_to, profile.address), progress = true) {
            OutlinedButton(onClick = { session.disconnect(); onClose() }) { Text(stringResource(R.string.action_cancel)) }
        }
        error is SshError.UnknownHostKey -> {
            StatusBox(stringResource(R.string.connecting_to, profile.address), progress = true)
            HostKeyDialog(error.key.hostId, error.key.type, error.key.fingerprint, changed = false,
                onAccept = { session.trustHostKeyAndRetry(error.key) }, onReject = { session.disconnect(); onClose() })
        }
        error is SshError.HostKeyChanged -> {
            StatusBox(stringResource(R.string.err_host_key), warning = true)
            HostKeyDialog(error.key.hostId, error.key.type, error.key.fingerprint, changed = true,
                onAccept = { session.trustHostKeyAndRetry(error.key) }, onReject = { session.disconnect(); onClose() })
        }
        error != null -> {
            val keyAuth = profile.authType == AuthType.KEY
            StatusBox(errorText(context, error, keyAuth), warning = true) {
                Button(onClick = { start() }) {
                    Text(stringResource(if (error is SshError.Disconnected) R.string.action_reconnect else R.string.action_retry))
                }
                if (error is SshError.AuthFailed && !keyAuth) {
                    OutlinedButton(onClick = { askPassword = true }) { Text(stringResource(R.string.err_enter_password)) }
                }
                TextButton(onClick = { session.disconnect(); onClose() }) { Text(stringResource(R.string.action_close)) }
            }
        }
        else -> StatusBox(stringResource(R.string.session_disconnected)) {
            if (!askPassword) Button(onClick = { start() }) { Text(stringResource(R.string.action_connect)) }
        }
    }
    if (askPassword) {
        PasswordDialog(
            profile = profile,
            onSubmit = { askPassword = false; typedPassword = it; start(it) },
            onCancel = { askPassword = false; if (session.state.value is ConnState.Idle) onClose() },
        )
    }
}

@Composable
internal fun StatusBox(
    text: String, progress: Boolean = false, warning: Boolean = false,
    actions: @Composable () -> Unit = {},
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(32.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (progress) CircularProgressIndicator()
        if (warning) Icon(Icons.Default.Warning, null, tint = MaterialTheme.colorScheme.error)
        Text(text, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.widthIn(max = 480.dp))
        actions()
    }
}

@Composable
private fun PasswordDialog(profile: ConnectionProfile, onSubmit: (String) -> Unit, onCancel: () -> Unit) {
    var value by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(stringResource(R.string.password_prompt_title, profile.address)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SecretField(value, { value = it }, stringResource(R.string.field_password), Modifier.fillMaxWidth())
                Text(stringResource(R.string.password_prompt_text), style = MaterialTheme.typography.bodySmall)
            }
        },
        confirmButton = {
            TextButton(onClick = { onSubmit(value) }, enabled = value.isNotEmpty()) { Text(stringResource(R.string.action_connect)) }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun HostKeyDialog(
    hostId: String, type: String, fingerprint: String, changed: Boolean,
    onAccept: () -> Unit, onReject: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onReject,
        icon = if (changed) { { Icon(Icons.Default.Warning, null, tint = MaterialTheme.colorScheme.error) } } else null,
        title = { Text(stringResource(if (changed) R.string.hostkey_changed_title else R.string.hostkey_new_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(if (changed) R.string.hostkey_changed_text else R.string.hostkey_new_text, hostId))
                Text(stringResource(R.string.hostkey_fingerprint, type), style = MaterialTheme.typography.labelLarge)
                SelectionContainer { Text(fingerprint, fontFamily = FontFamily.Monospace, fontSize = 13.sp) }
            }
        },
        // For a changed key the safe choice (cancel) is the prominent one.
        confirmButton = {
            if (changed) Button(onClick = onReject) { Text(stringResource(R.string.action_cancel)) }
            else TextButton(onClick = onAccept) { Text(stringResource(R.string.hostkey_trust)) }
        },
        dismissButton = {
            if (changed) TextButton(onClick = onAccept) {
                Text(stringResource(R.string.hostkey_replace), color = MaterialTheme.colorScheme.error)
            } else TextButton(onClick = onReject) { Text(stringResource(R.string.action_cancel)) }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionScreen(profileId: String, onBack: () -> Unit, onRunScript: (String) -> Unit) {
    val app = LocalApp.current
    val data by app.repository.data.collectAsStateWithLifecycle()
    val profile = data.connections.firstOrNull { it.id == profileId }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf(false) }
    var pickScript by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(profile?.title.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (profile != null && profile.name.isNotBlank()) {
                            Text(
                                profile.address, style = MaterialTheme.typography.bodySmall, maxLines = 1,
                                overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                navigationIcon = { BackButton(onBack) },
                actions = {
                    IconButton(onClick = { menu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.action_more))
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.session_run_script)) },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_script), null) },
                            onClick = { menu = false; pickScript = true },
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.action_disconnect)) },
                            onClick = { menu = false; app.sessions.disconnect(profileId); onBack() },
                        )
                    }
                },
            )
        },
    ) { inner ->
        Column(Modifier.padding(inner).consumeWindowInsets(inner).imePadding().fillMaxSize()) {
            ConnectionGate(profileId, onClose = onBack) { session, _ ->
                Column(Modifier.fillMaxSize()) {
                    PrimaryTabRow(selectedTabIndex = tab) {
                        Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text(stringResource(R.string.session_tab_terminal)) })
                        Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text(stringResource(R.string.session_tab_files)) })
                    }
                    if (tab == 0) TerminalPane(session) else FilesPane(session)
                }
            }
        }
    }
    if (pickScript) {
        PickerDialog(
            title = stringResource(R.string.session_run_script),
            emptyText = stringResource(R.string.session_no_scripts),
            items = data.scripts, headline = { it.name },
            supporting = { it.commands.lineSequence().firstOrNull { l -> l.isNotBlank() && !l.trim().startsWith("#") }.orEmpty() },
            onPick = { pickScript = false; onRunScript(it.id) },
            onDismiss = { pickScript = false },
        )
    }
}

// ---- Terminal ----------------------------------------------------------------------------

private val TerminalStyle = TextStyle(
    fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 17.sp, color = TerminalColors.text,
)

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

@Composable
private fun TerminalContent(shell: ShellSession, onReopen: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val screen by shell.screen.collectAsStateWithLifecycle()
    val closed by shell.closed.collectAsStateWithLifecycle()
    val listState = rememberLazyListState()
    var stickToBottom by remember { mutableStateOf(true) }
    var input by remember { mutableStateOf("") }
    var hideInput by remember { mutableStateOf(false) }
    val history = remember { mutableStateListOf<String>() }
    var historyIndex by remember { mutableIntStateOf(-1) }

    LaunchedEffect(listState) {
        snapshotFlow { listState.isScrollInProgress }.collect { scrolling ->
            if (!scrolling) stickToBottom = !listState.canScrollForward
        }
    }
    LaunchedEffect(screen.revision) {
        if (stickToBottom && screen.lines.isNotEmpty()) listState.scrollToItem(screen.lines.lastIndex)
    }

    fun sendRaw(text: String) {
        scope.launch(Dispatchers.IO) { runCatching { shell.send(text) } }
    }
    fun submit() {
        val line = input
        if (!hideInput && line.isNotBlank() && history.lastOrNull() != line) history.add(line)
        historyIndex = -1
        input = ""
        hideInput = false
        stickToBottom = true
        scope.launch(Dispatchers.IO) { runCatching { shell.sendLine(line) } }
    }
    fun recall(step: Int) {
        if (history.isEmpty()) return
        val next = when {
            historyIndex == -1 && step < 0 -> history.lastIndex
            historyIndex == -1 -> return
            else -> historyIndex + step
        }
        if (next > history.lastIndex) { historyIndex = -1; input = "" }
        else { historyIndex = next.coerceAtLeast(0); input = history[historyIndex] }
    }

    Column(Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().background(TerminalColors.background)) {
            val measurer = rememberTextMeasurer()
            val density = LocalDensity.current
            val cell = remember(density) { measurer.measure("M", TerminalStyle).size }
            val padPx = with(density) { 8.dp.roundToPx() }
            val cols = ((constraints.maxWidth - 2 * padPx) / cell.width.coerceAtLeast(1))
            val rows = (constraints.maxHeight / cell.height.coerceAtLeast(1))
            LaunchedEffect(shell, cols, rows) { withContext(Dispatchers.IO) { shell.resize(cols, rows) } }
            SelectionContainer {
                LazyColumn(state = listState, contentPadding = PaddingValues(8.dp), modifier = Modifier.fillMaxSize()) {
                    items(count = screen.lines.size) { i -> Text(screen.lines[i].ifEmpty { " " }, style = TerminalStyle) }
                }
            }
        }
        Surface(tonalElevation = 3.dp) {
            Column {
                if (closed) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(stringResource(R.string.terminal_closed), Modifier.weight(1f))
                        TextButton(onClick = onReopen) { Text(stringResource(R.string.terminal_reopen)) }
                    }
                }
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    AssistChip(onClick = { sendRaw(ShellSession.CTRL_C) }, enabled = !closed, label = { Text("Ctrl+C") })
                    AssistChip(onClick = { sendRaw(ShellSession.CTRL_D) }, enabled = !closed, label = { Text("Ctrl+D") })
                    AssistChip(onClick = { sendRaw(ShellSession.TAB) }, enabled = !closed, label = { Text("Tab") })
                    AssistChip(
                        onClick = { recall(-1) }, enabled = history.isNotEmpty(),
                        label = { Icon(painterResource(R.drawable.ic_arrow_up), stringResource(R.string.terminal_history_prev)) },
                    )
                    AssistChip(
                        onClick = { recall(1) }, enabled = historyIndex != -1,
                        label = { Icon(painterResource(R.drawable.ic_arrow_down), stringResource(R.string.terminal_history_next)) },
                    )
                    AssistChip(onClick = { shell.clearScreen() }, label = { Text(stringResource(R.string.terminal_clear)) })
                    AssistChip(
                        onClick = { copyToClipboard(context, "terminal", screen.lines.joinToString("\n").trimEnd()) },
                        label = { Text(stringResource(R.string.terminal_copy_all)) },
                    )
                }
                Row(
                    Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    OutlinedTextField(
                        value = input, onValueChange = { input = it }, singleLine = true, enabled = !closed,
                        placeholder = { Text(stringResource(R.string.terminal_input_hint)) },
                        modifier = Modifier.weight(1f),
                        textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 15.sp),
                        visualTransformation = if (hideInput) PasswordVisualTransformation() else VisualTransformation.None,
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
                            keyboardType = if (hideInput) KeyboardType.Password else KeyboardType.Ascii,
                            imeAction = ImeAction.Send,
                        ),
                        keyboardActions = KeyboardActions(onSend = { submit() }),
                        trailingIcon = {
                            IconButton(onClick = { hideInput = !hideInput }) {
                                Icon(
                                    painterResource(if (hideInput) R.drawable.ic_eye_off else R.drawable.ic_eye),
                                    stringResource(if (hideInput) R.string.terminal_show_input else R.string.terminal_hide_input),
                                )
                            }
                        },
                    )
                    Spacer(Modifier.padding(start = 8.dp))
                    FilledIconButton(onClick = ::submit, enabled = !closed) {
                        Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.terminal_send))
                    }
                }
            }
        }
    }
}
