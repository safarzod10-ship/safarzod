package app.sshpult.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sshpult.R
import app.sshpult.data.AuthType
import app.sshpult.data.ConnectionProfile
import app.sshpult.data.Script
import app.sshpult.data.parseQuickTarget
import app.sshpult.ssh.RunMode
import app.sshpult.ssh.ScriptRunner

private val PlainKeyboard = KeyboardOptions(
    capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
    keyboardType = KeyboardType.Uri, imeAction = ImeAction.Next,
)

@Composable
private fun RadioRow(selected: Boolean, onClick: () -> Unit, label: String, sublabel: String? = null) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp)
            .selectable(selected = selected, onClick = onClick, role = Role.RadioButton),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null, modifier = Modifier.padding(horizontal = 12.dp))
        Column {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (sublabel != null) {
                Text(sublabel, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConnectionEditScreen(connectionId: String?, onDone: () -> Unit, onConnect: (String) -> Unit) {
    val app = LocalApp.current
    val data by app.repository.data.collectAsStateWithLifecycle()
    val existing = remember(connectionId) { connectionId?.let { app.repository.connection(it) } }

    var name by rememberSaveable { mutableStateOf(existing?.name.orEmpty()) }
    var host by rememberSaveable { mutableStateOf(existing?.host.orEmpty()) }
    var port by rememberSaveable { mutableStateOf((existing?.port ?: 22).toString()) }
    var username by rememberSaveable { mutableStateOf(existing?.username.orEmpty()) }
    var authType by rememberSaveable { mutableStateOf(existing?.authType ?: AuthType.PASSWORD) }
    var keyId by rememberSaveable { mutableStateOf(existing?.keyId) }
    // The typed password deliberately lives in plain remember: it must not be written to saved state.
    var password by remember { mutableStateOf("") }
    var forgetPassword by rememberSaveable { mutableStateOf(false) }
    var showErrors by rememberSaveable { mutableStateOf(false) }

    val hasSavedPassword = existing?.passwordEnc != null && !forgetPassword
    val portNumber = port.toIntOrNull()
    val hostError = when {
        host.isBlank() -> R.string.err_field_required
        host.trim().any { it.isWhitespace() || it == '/' || it == '@' } -> R.string.err_host_invalid
        else -> null
    }
    val portError = if (portNumber == null || portNumber !in 1..65535) R.string.err_port_invalid else null
    val userError = if (username.isBlank()) R.string.err_field_required else null
    val keyError = if (authType == AuthType.KEY && data.keys.none { it.id == keyId }) R.string.err_key_required else null
    val valid = hostError == null && portError == null && userError == null && keyError == null

    fun save(connect: Boolean = false) {
        showErrors = true
        if (!valid) return
        val profile = ConnectionProfile(
            id = existing?.id ?: app.repository.newId(),
            name = name.trim(), host = host.trim(), port = portNumber!!, username = username.trim(),
            authType = authType, keyId = keyId,
        )
        val newPassword = when {
            password.isNotEmpty() -> password
            forgetPassword -> ""
            else -> null // keep whatever is stored
        }
        app.repository.saveConnection(profile, newPassword)
        // Settings of an open session may be stale now; next open reconnects with the new ones.
        if (existing != null) app.sessions.disconnect(existing.id)
        if (connect) onConnect(profile.id) else onDone()
    }

    Scaffold(
        topBar = {
            ScreenHeader(
                title = { Text(stringResource(if (existing == null) R.string.connection_new else R.string.connection_edit)) },
                navigationIcon = { BackButton(onDone) },
                actions = { TextButton(onClick = { save() }) { Text(stringResource(R.string.action_save)) } },
            )
        },
    ) { inner ->
        CenteredContent(Modifier.padding(inner).consumeWindowInsets(inner).imePadding()) {
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SafabField(
                    value = name, onValueChange = { name = it }, singleLine = true,
                    label = { Text(stringResource(R.string.field_name)) }, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    SafabField(
                        value = host, singleLine = true,
                        onValueChange = { typed ->
                            val pasted = parseQuickTarget(typed)
                            if (pasted != null) {
                                host = pasted.host
                                username = pasted.username
                                if (pasted.port != 22 || ':' in typed) port = pasted.port.toString()
                            } else host = typed
                        },
                        label = { Text(stringResource(R.string.field_host)) }, modifier = Modifier.weight(1f),
                        keyboardOptions = PlainKeyboard,
                        isError = showErrors && hostError != null,
                        supportingText = hostError?.takeIf { showErrors }?.let { { Text(stringResource(it)) } },
                    )
                    SafabField(
                        value = port, onValueChange = { v -> port = v.filter { it.isDigit() }.take(5) }, singleLine = true,
                        label = { Text(stringResource(R.string.field_port)) }, modifier = Modifier.width(104.dp),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Next),
                        isError = showErrors && portError != null,
                    )
                }
                if (showErrors && portError != null) {
                    Text(stringResource(portError), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                }
                SafabField(
                    value = username, onValueChange = { username = it }, singleLine = true,
                    label = { Text(stringResource(R.string.field_username)) }, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = PlainKeyboard.copy(keyboardType = KeyboardType.Ascii),
                    isError = showErrors && userError != null,
                    supportingText = userError?.takeIf { showErrors }?.let { { Text(stringResource(it)) } },
                )

                Caption(stringResource(R.string.field_auth), Modifier.padding(top = 10.dp))
                ModeSwitch(
                    labels = listOf(stringResource(R.string.auth_password), stringResource(R.string.auth_key)),
                    selected = if (authType == AuthType.PASSWORD) 0 else 1,
                    onSelect = { authType = if (it == 0) AuthType.PASSWORD else AuthType.KEY },
                    fill = true,
                )

                if (authType == AuthType.PASSWORD) {
                    SecretField(
                        value = password, onValueChange = { password = it },
                        label = stringResource(R.string.field_password), modifier = Modifier.fillMaxWidth(),
                        supportingText = stringResource(
                            if (hasSavedPassword) R.string.password_hint_saved else R.string.password_hint_new,
                        ),
                    )
                    if (hasSavedPassword) {
                        TextButton(onClick = { forgetPassword = true; password = "" }) {
                            Text(stringResource(R.string.password_forget))
                        }
                    }
                } else if (data.keys.isEmpty()) {
                    Text(
                        stringResource(R.string.key_none_available),
                        color = if (showErrors) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Text(
                        stringResource(R.string.key_choose), style = MaterialTheme.typography.bodyMedium,
                        color = if (showErrors && keyError != null) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Column(Modifier.selectableGroup()) {
                        data.keys.forEach { k ->
                            RadioRow(selected = keyId == k.id, onClick = { keyId = k.id }, label = k.name, sublabel = k.type)
                        }
                    }
                }
                if (existing == null && authType == AuthType.PASSWORD) {
                    Text(
                        stringResource(R.string.host_paste_hint), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Button(
                    onClick = { save(connect = true) }, shape = MaterialTheme.shapes.medium,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 50.dp),
                ) { Text(stringResource(R.string.action_save_connect)) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScriptEditScreen(scriptId: String?, onDone: () -> Unit) {
    val app = LocalApp.current
    val existing = remember(scriptId) { scriptId?.let { app.repository.script(it) } }
    var name by rememberSaveable { mutableStateOf(existing?.name.orEmpty()) }
    var commands by rememberSaveable { mutableStateOf(existing?.commands.orEmpty()) }
    var mode by rememberSaveable { mutableStateOf(existing?.mode ?: RunMode.SEQUENTIAL) }
    var stopOnError by rememberSaveable { mutableStateOf(existing?.stopOnError ?: true) }
    var showErrors by rememberSaveable { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }

    val nameError = name.isBlank()
    val commandsError = remember(commands) { ScriptRunner.parse(commands).isEmpty() }

    fun save() {
        showErrors = true
        if (nameError || commandsError) return
        app.repository.saveScript(
            Script(existing?.id ?: app.repository.newId(), name.trim(), commands.trimEnd(), mode, stopOnError),
        )
        onDone()
    }

    Scaffold(
        topBar = {
            ScreenHeader(
                title = { Text(stringResource(if (existing == null) R.string.script_new else R.string.script_edit)) },
                navigationIcon = { BackButton(onDone) },
                actions = {
                    if (existing != null) {
                        IconButton(onClick = { confirmDelete = true }) {
                            Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.action_delete))
                        }
                    }
                    TextButton(onClick = ::save) { Text(stringResource(R.string.action_save)) }
                },
            )
        },
    ) { inner ->
        CenteredContent(Modifier.padding(inner).consumeWindowInsets(inner).imePadding()) {
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                SafabField(
                    value = name, onValueChange = { name = it }, singleLine = true,
                    label = { Text(stringResource(R.string.script_name)) }, modifier = Modifier.fillMaxWidth(),
                    isError = showErrors && nameError,
                    supportingText = if (showErrors && nameError) { { Text(stringResource(R.string.err_field_required)) } } else null,
                )
                SafabField(
                    value = commands, onValueChange = { commands = it },
                    label = { Text(stringResource(R.string.script_commands)) },
                    modifier = Modifier.fillMaxWidth(), minLines = 7,
                    textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 14.sp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    isError = showErrors && commandsError,
                    supportingText = {
                        Text(stringResource(if (showErrors && commandsError) R.string.script_no_commands else R.string.script_commands_hint))
                    },
                )
                Caption(stringResource(R.string.script_mode), Modifier.padding(top = 10.dp))
                Column(Modifier.selectableGroup()) {
                    RadioRow(mode == RunMode.SEQUENTIAL, { mode = RunMode.SEQUENTIAL }, stringResource(R.string.script_mode_sequential))
                    RadioRow(mode == RunMode.PARALLEL, { mode = RunMode.PARALLEL }, stringResource(R.string.script_mode_parallel))
                }
                if (mode == RunMode.SEQUENTIAL) {
                    Row(
                        Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .toggleable(value = stopOnError, onValueChange = { stopOnError = it }, role = Role.Switch)
                            .padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(stringResource(R.string.script_stop_on_error), Modifier.weight(1f))
                        Switch(checked = stopOnError, onCheckedChange = null)
                    }
                }
                Button(
                    onClick = ::save, shape = MaterialTheme.shapes.medium,
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp).heightIn(min = 50.dp),
                ) { Text(stringResource(R.string.action_save)) }
            }
        }
    }
    if (confirmDelete && existing != null) {
        ConfirmDialog(
            title = stringResource(R.string.delete_script_title),
            text = stringResource(R.string.delete_script_text, existing.name),
            confirmLabel = stringResource(R.string.action_delete),
            onConfirm = { app.repository.deleteScript(existing.id); onDone() },
            onDismiss = { confirmDelete = false },
        )
    }
}
