package app.sshpult.ui

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sshpult.R
import app.sshpult.data.SshKeyEntry
import app.sshpult.ssh.KeyAlgorithm
import app.sshpult.ssh.KeyTools
import app.sshpult.ssh.SshError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class KeyAction { GENERATE, IMPORT_FILE, PASTE }

private const val MAX_KEY_FILE_BYTES = 64 * 1024

@Composable
fun KeyAddMenu(expanded: Boolean, onDismiss: () -> Unit, onAction: (KeyAction) -> Unit) {
    DropdownMenu(expanded = expanded, onDismissRequest = onDismiss) {
        DropdownMenuItem(
            text = { Text(stringResource(R.string.key_generate)) },
            leadingIcon = { Icon(painterResource(R.drawable.ic_key), null) },
            onClick = { onDismiss(); onAction(KeyAction.GENERATE) },
        )
        DropdownMenuItem(
            text = { Text(stringResource(R.string.key_import_file)) },
            leadingIcon = { Icon(painterResource(R.drawable.ic_file), null) },
            onClick = { onDismiss(); onAction(KeyAction.IMPORT_FILE) },
        )
        DropdownMenuItem(
            text = { Text(stringResource(R.string.key_paste)) },
            leadingIcon = { Icon(painterResource(R.drawable.ic_copy), null) },
            onClick = { onDismiss(); onAction(KeyAction.PASTE) },
        )
    }
}

/** Reads a small text file chosen by the user; null when it is unreadable or too big. */
private fun readKeyFile(context: Context, uri: Uri): String? = try {
    context.contentResolver.openInputStream(uri)?.use { input ->
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() <= MAX_KEY_FILE_BYTES) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
        }
        if (out.size() > MAX_KEY_FILE_BYTES) null else out.toString("UTF-8")
    }
} catch (e: Exception) {
    null
}

fun shareText(context: Context, text: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    runCatching { context.startActivity(Intent.createChooser(send, null)) }
}

@Composable
fun KeysTab(pendingAction: KeyAction?, onActionHandled: () -> Unit) {
    val app = LocalApp.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val data by app.repository.data.collectAsStateWithLifecycle()

    var generating by remember { mutableStateOf(false) }
    var importText by remember { mutableStateOf<String?>(null) }
    var showPublic by remember { mutableStateOf<SshKeyEntry?>(null) }
    var deleting by remember { mutableStateOf<SshKeyEntry?>(null) }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) scope.launch {
            val text = withContext(Dispatchers.IO) { readKeyFile(context, uri) }
            if (text == null) Toast.makeText(context, R.string.key_file_too_large, Toast.LENGTH_LONG).show()
            else importText = text
        }
    }
    LaunchedEffect(pendingAction) {
        when (pendingAction) {
            KeyAction.GENERATE -> generating = true
            KeyAction.IMPORT_FILE -> filePicker.launch(arrayOf("*/*"))
            KeyAction.PASTE -> importText = ""
            null -> return@LaunchedEffect
        }
        onActionHandled()
    }

    if (data.keys.isEmpty()) {
        EmptyState(R.drawable.ic_key, stringResource(R.string.keys_empty_title), stringResource(R.string.keys_empty_text), Modifier.padding(bottom = 96.dp))
    } else {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 300.dp),
            contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 120.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(data.keys, key = { it.id }) { k ->
                Panel(Modifier.fillMaxWidth(), onClick = { showPublic = k }) {
                    Column(Modifier.padding(start = 18.dp, end = 10.dp, top = 16.dp, bottom = 6.dp)) {
                        Text(k.name, style = MaterialTheme.typography.titleMedium, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(k.type, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            k.fingerprint, style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.MiddleEllipsis,
                        )
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { deleting = k }) {
                                Text(stringResource(R.string.action_delete), color = MaterialTheme.colorScheme.error)
                            }
                            TextButton(onClick = { copyToClipboard(context, k.name, k.publicKey) }) {
                                Text(stringResource(R.string.key_copy_public))
                            }
                        }
                    }
                }
            }
        }
    }

    if (generating) GenerateKeyDialog(onDismiss = { generating = false }, onCreated = { generating = false; showPublic = it })
    importText?.let { text ->
        ImportKeyDialog(initialText = text, onDismiss = { importText = null }, onImported = { importText = null; showPublic = it })
    }
    showPublic?.let { PublicKeyDialog(it, onDismiss = { showPublic = null }) }
    deleting?.let { k ->
        val users = remember(k.id) { app.repository.connectionsUsingKey(k.id) }
        val base = stringResource(R.string.delete_key_text, k.name)
        val warn = if (users.isEmpty()) "" else "\n\n" + stringResource(R.string.delete_key_in_use, users.joinToString { it.title })
        ConfirmDialog(
            title = stringResource(R.string.delete_key_title), text = base + warn,
            confirmLabel = stringResource(R.string.action_delete),
            onConfirm = { app.repository.deleteKey(k.id); deleting = null },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun GenerateKeyDialog(onDismiss: () -> Unit, onCreated: (SshKeyEntry) -> Unit) {
    val app = LocalApp.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var algorithm by remember { mutableStateOf(KeyAlgorithm.ED25519) }
    var busy by remember { mutableStateOf(false) }
    var showErrors by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    val context = LocalContext.current

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.key_generate)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SafabField(
                    value = name, onValueChange = { name = it }, singleLine = true, enabled = !busy,
                    label = { Text(stringResource(R.string.key_name)) }, modifier = Modifier.fillMaxWidth(),
                    isError = showErrors && name.isBlank(),
                    supportingText = if (showErrors && name.isBlank()) { { Text(stringResource(R.string.err_field_required)) } } else null,
                )
                Text(stringResource(R.string.key_algorithm), style = MaterialTheme.typography.labelLarge)
                Column(Modifier.selectableGroup()) {
                    listOf(KeyAlgorithm.ED25519 to R.string.key_algo_ed25519, KeyAlgorithm.RSA to R.string.key_algo_rsa).forEach { (a, label) ->
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .selectable(selected = algorithm == a, enabled = !busy, role = Role.RadioButton, onClick = { algorithm = a }),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(selected = algorithm == a, onClick = null, modifier = Modifier.padding(end = 12.dp))
                            Text(stringResource(label))
                        }
                    }
                }
                if (busy) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        SafabLoader(28.dp)
                        Text(stringResource(R.string.key_generating))
                    }
                }
                failure?.let { Text(errorText(context, it), color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                showErrors = true
                if (name.isBlank()) return@TextButton
                busy = true
                failure = null
                scope.launch {
                    try {
                        val key = withContext(Dispatchers.Default) { KeyTools.generate(algorithm, name.trim()) }
                        onCreated(
                            app.repository.addKey(name.trim(), key.info.type, key.info.publicKey, key.info.fingerprint, key.privateKey, null),
                        )
                    } catch (e: SshError) {
                        failure = e
                    } finally {
                        busy = false
                    }
                }
            }) { Text(stringResource(R.string.action_add)) }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun ImportKeyDialog(initialText: String, onDismiss: () -> Unit, onImported: (SshKeyEntry) -> Unit) {
    val app = LocalApp.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var text by remember { mutableStateOf(initialText) }
    var passphrase by remember { mutableStateOf("") }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    var showErrors by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(stringResource(R.string.key_import_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SafabField(
                    value = name, onValueChange = { name = it }, singleLine = true,
                    label = { Text(stringResource(R.string.key_name)) }, modifier = Modifier.fillMaxWidth(),
                    isError = showErrors && name.isBlank(),
                    supportingText = if (showErrors && name.isBlank()) { { Text(stringResource(R.string.err_field_required)) } } else null,
                )
                SafabField(
                    value = text, onValueChange = { text = it; failure = null },
                    label = { Text(stringResource(R.string.key_private_text)) },
                    modifier = Modifier.fillMaxWidth(), minLines = 4, maxLines = 6,
                    textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 11.sp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                    isError = failure is SshError.BadPrivateKey,
                )
                SecretField(
                    value = passphrase, onValueChange = { passphrase = it; failure = null },
                    label = stringResource(R.string.key_passphrase), modifier = Modifier.fillMaxWidth(),
                    isError = failure is SshError.PassphraseRequired || failure is SshError.WrongPassphrase,
                )
                failure?.let { Text(errorText(context, it), color = MaterialTheme.colorScheme.error) }
            }
        },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                showErrors = true
                if (name.isBlank()) return@TextButton
                busy = true
                scope.launch {
                    try {
                        val info = withContext(Dispatchers.Default) { KeyTools.inspect(text, passphrase, name.trim()) }
                        onImported(
                            app.repository.addKey(
                                name.trim(), info.type, info.publicKey, info.fingerprint, text.trim() + "\n",
                                passphrase.takeIf { info.encrypted },
                            ),
                        )
                    } catch (e: SshError) {
                        failure = e
                    } finally {
                        busy = false
                    }
                }
            }) { Text(stringResource(R.string.action_add)) }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

@Composable
private fun PublicKeyDialog(key: SshKeyEntry, onDismiss: () -> Unit) {
    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.key_public_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.key_public_hint))
                SelectionContainer {
                    Text(key.publicKey, fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { copyToClipboard(context, key.name, key.publicKey) }) { Text(stringResource(R.string.action_copy)) }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) }
                TextButton(onClick = { shareText(context, key.publicKey) }) { Text(stringResource(R.string.action_share)) }
            }
        },
    )
}
