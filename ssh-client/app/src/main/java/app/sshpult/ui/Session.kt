package app.sshpult.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
    // A typed password is stored only after it has actually opened the session.
    var pendingRemember by remember { mutableStateOf<String?>(null) }

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
    LaunchedEffect(current) {
        val pw = pendingRemember
        if (current is ConnState.Connected && pw != null) {
            app.repository.rememberPassword(profileId, pw)
            pendingRemember = null
        }
    }
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
            onSubmit = { password, remember ->
                askPassword = false
                typedPassword = password
                pendingRemember = if (remember) password else null
                start(password)
            },
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
        if (progress) SafabAvatar(76.dp, animated = true)
        if (warning) Icon(Icons.Default.Warning, null, tint = MaterialTheme.colorScheme.error)
        Text(text, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.widthIn(max = 480.dp))
        actions()
    }
}

@Composable
private fun PasswordDialog(profile: ConnectionProfile, onSubmit: (password: String, remember: Boolean) -> Unit, onCancel: () -> Unit) {
    var value by remember { mutableStateOf("") }
    var save by remember { mutableStateOf(true) }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(stringResource(R.string.password_prompt_title, profile.address)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                SecretField(
                    value, { value = it }, stringResource(R.string.field_password), Modifier.fillMaxWidth(),
                    onDone = { if (value.isNotEmpty()) onSubmit(value, save) },
                )
                Row(
                    Modifier.fillMaxWidth().toggleable(value = save, onValueChange = { save = it }, role = Role.Checkbox),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = save, onCheckedChange = null, modifier = Modifier.padding(12.dp))
                    Text(stringResource(R.string.password_remember))
                }
            }
        },
        confirmButton = {
            Button(onClick = { onSubmit(value, save) }, enabled = value.isNotEmpty()) { Text(stringResource(R.string.action_connect)) }
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
            else Button(onClick = onAccept) { Text(stringResource(R.string.hostkey_trust)) }
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
    val online by app.sessions.connectedIds.collectAsStateWithLifecycle()
    val profile = data.connections.firstOrNull { it.id == profileId }
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var menu by remember { mutableStateOf(false) }
    var pickScript by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            ScreenHeader(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier.size(8.dp).clip(CircleShape)
                                .background(if (profileId in online) StatusGreen else MaterialTheme.colorScheme.outline),
                        )
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(
                                profile?.title.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold,
                            )
                            if (profile != null && profile.name.isNotBlank()) {
                                Text(
                                    profile.address, style = MaterialTheme.typography.bodySmall, maxLines = 1,
                                    fontFamily = FontFamily.Monospace,
                                    overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                },
                navigationIcon = { BackButton(onBack) },
                actions = {
                    ModeSwitch(
                        labels = listOf(stringResource(R.string.session_tab_terminal), stringResource(R.string.session_tab_files)),
                        selected = tab, onSelect = { tab = it },
                    )
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
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            ConnectionGate(profileId, onClose = onBack) { session, _ ->
                if (tab == 0) TerminalPane(session) else FilesPane(session)
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

/** Compact two-or-three way switch: a hairline pill with the active part filled in ink. */
@Composable
fun ModeSwitch(labels: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier, fill: Boolean = false) {
    Row(
        modifier.then(if (fill) Modifier.fillMaxWidth() else Modifier).clip(RoundedCornerShape(12.dp))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp)).padding(3.dp),
    ) {
        labels.forEachIndexed { i, label ->
            val active = i == selected
            Box(
                Modifier.then(if (fill) Modifier.weight(1f) else Modifier).clip(RoundedCornerShape(9.dp))
                    .background(if (active) MaterialTheme.colorScheme.primary else Color.Transparent)
                    .selectable(selected = active, role = Role.Tab, onClick = { onSelect(i) })
                    .padding(horizontal = 12.dp, vertical = if (fill) 11.dp else 7.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label, style = MaterialTheme.typography.labelLarge,
                    color = if (active) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
