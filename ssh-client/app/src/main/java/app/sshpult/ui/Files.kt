package app.sshpult.ui

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.text.format.Formatter
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.sshpult.R
import app.sshpult.ssh.RemoteFile
import app.sshpult.ssh.RemotePaths
import app.sshpult.ssh.SessionManager
import app.sshpult.ssh.SftpClient
import app.sshpult.ssh.SshError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.atomic.AtomicBoolean

data class Transfer(val name: String, val upload: Boolean, val done: Long, val total: Long, val index: Int, val count: Int)

data class FilesUiState(
    val path: String = "",
    val entries: List<RemoteFile> = emptyList(),
    val loading: Boolean = true,
    /** Set only when nothing could be listed at all; later failures go to [FilesViewModel.messages]. */
    val error: Throwable? = null,
    val transfer: Transfer? = null,
)

sealed interface FilesMessage {
    data class Failure(val error: Throwable) : FilesMessage
    data class Info(val resId: Int, val arg: Any) : FilesMessage
}

class FilesViewModel(
    private val session: SessionManager.ManagedSession,
    private val appContext: Context,
) : ViewModel() {
    val state = MutableStateFlow(FilesUiState())
    private val _messages = Channel<FilesMessage>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    private var transferJob: Job? = null
    private val cancelFlag = AtomicBoolean(false)

    init { open(null) }

    /** Lists [path] (null = home directory) and makes it the current folder. */
    fun open(path: String?) {
        viewModelScope.launch {
            state.update { it.copy(loading = true, error = null) }
            try {
                val sftp = session.sftp()
                val (real, list) = runInterruptible(Dispatchers.IO) {
                    val real = sftp.realPath(path ?: sftp.home())
                    real to sftp.list(real)
                }
                state.update { it.copy(path = real, entries = list, loading = false) }
            } catch (e: SshError) {
                if (state.value.path.isEmpty()) state.update { it.copy(loading = false, error = e) }
                else {
                    state.update { it.copy(loading = false) }
                    _messages.trySend(FilesMessage.Failure(e))
                }
            }
        }
    }

    fun refresh() = open(state.value.path.ifEmpty { null })
    fun up() = open(RemotePaths.parent(state.value.path))

    private fun operation(block: (SftpClient) -> Unit) {
        viewModelScope.launch {
            try {
                val sftp = session.sftp()
                runInterruptible(Dispatchers.IO) { block(sftp) }
            } catch (e: SshError) {
                _messages.trySend(FilesMessage.Failure(e))
            }
            refresh()
        }
    }

    fun mkdir(name: String) = operation { it.mkdir(RemotePaths.join(state.value.path, name)) }
    fun rename(file: RemoteFile, newName: String) =
        operation { it.rename(file.path, RemotePaths.join(RemotePaths.parent(file.path), newName)) }
    fun delete(file: RemoteFile) = operation { it.delete(file.path) }

    fun cancelTransfer() = cancelFlag.set(true)

    private fun startTransfer(block: suspend (SftpClient) -> Unit) {
        if (transferJob?.isActive == true) {
            _messages.trySend(FilesMessage.Info(R.string.files_busy, ""))
            return
        }
        cancelFlag.set(false)
        transferJob = viewModelScope.launch {
            try {
                block(session.transferSftp())
            } catch (e: SshError.Cancelled) {
                _messages.trySend(FilesMessage.Info(R.string.files_transfer_cancelled, ""))
            } catch (e: SshError) {
                _messages.trySend(FilesMessage.Failure(e))
            } finally {
                state.update { it.copy(transfer = null) }
            }
        }
    }

    /** Progress callback that touches UI state at most ~10 times a second. */
    private fun progress(name: String, upload: Boolean, index: Int, count: Int): (Long, Long) -> Unit {
        var last = 0L
        return { done, total ->
            val now = System.nanoTime()
            if (done == 0L || done >= total || now - last > 100_000_000) {
                last = now
                state.update { it.copy(transfer = Transfer(name, upload, done, total, index, count)) }
            }
        }
    }

    /** Saves the remote [file] into the document the user created at [target]. */
    fun download(file: RemoteFile, target: Uri) = startTransfer { sftp ->
        var complete = false
        try {
            withContext(Dispatchers.IO) {
                val out = appContext.contentResolver.openOutputStream(target, "wt")
                    ?: throw SshError.Other(appContext.getString(R.string.files_local_error))
                out.use { sftp.download(file.path, it, progress(file.name, false, 1, 1)) { cancelFlag.get() } }
            }
            complete = true
            _messages.trySend(FilesMessage.Info(R.string.files_downloaded, file.name))
        } catch (e: java.io.IOException) {
            throw SshError.Other(appContext.getString(R.string.files_local_error), e)
        } catch (e: SecurityException) {
            throw SshError.Other(appContext.getString(R.string.files_local_error), e)
        } finally {
            // Never leave a truncated file that looks like a finished download.
            if (!complete) runCatching { DocumentsContract.deleteDocument(appContext.contentResolver, target) }
        }
    }

    /** Uploads the picked local documents into the current remote folder. */
    fun upload(sources: List<Uri>) = startTransfer { sftp ->
        val dir = state.value.path
        var uploaded = 0
        try {
            sources.forEachIndexed { i, uri ->
                withContext(Dispatchers.IO) {
                    val (rawName, size) = describe(uri)
                    val name = uniqueName(sftp, dir, sanitize(rawName))
                    val input = try {
                        appContext.contentResolver.openInputStream(uri)
                    } catch (e: Exception) {
                        null
                    } ?: throw SshError.Other(appContext.getString(R.string.files_local_error))
                    input.use {
                        sftp.upload(it, RemotePaths.join(dir, name), size, progress(name, true, i + 1, sources.size)) { cancelFlag.get() }
                    }
                }
                uploaded++
            }
            _messages.trySend(FilesMessage.Info(R.string.files_uploaded_n, uploaded))
        } finally {
            if (uploaded > 0 || sources.isNotEmpty()) refresh()
        }
    }

    private fun describe(uri: Uri): Pair<String, Long> {
        var name = uri.lastPathSegment?.substringAfterLast('/') ?: "file"
        var size = -1L
        runCatching {
            appContext.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getString(0)?.takeIf { it.isNotBlank() }?.let { name = it }
                    if (!c.isNull(1)) size = c.getLong(1)
                }
            }
        }
        return name to size
    }

    private fun sanitize(name: String): String =
        name.replace('/', '_').replace('\u0000', '_').trim().ifEmpty { "file" }.let { if (it == "." || it == "..") "file" else it }

    /** Avoids silently overwriting an existing remote file: "a.txt" becomes "a (2).txt". */
    private fun uniqueName(sftp: SftpClient, dir: String, name: String): String {
        if (!sftp.exists(RemotePaths.join(dir, name))) return name
        val dot = name.lastIndexOf('.')
        val (stem, ext) = if (dot > 0) name.substring(0, dot) to name.substring(dot) else name to ""
        for (n in 2..999) {
            val candidate = "$stem ($n)$ext"
            if (!sftp.exists(RemotePaths.join(dir, candidate))) return candidate
        }
        return "$stem (${System.currentTimeMillis()})$ext"
    }
}

@Composable
fun FilesPane(session: SessionManager.ManagedSession) {
    val context = LocalContext.current
    val appContext = context.applicationContext
    // Keyed by the session object so a re-opened connection starts with a fresh browser.
    val vm: FilesViewModel = viewModel(key = "files-${session.profileId}") { FilesViewModel(session, appContext) }
    val state by vm.state.collectAsStateWithLifecycle()
    val resources = LocalResources.current
    val snackbar = remember { SnackbarHostState() }

    var menuFor by remember { mutableStateOf<RemoteFile?>(null) }
    var renaming by remember { mutableStateOf<RemoteFile?>(null) }
    var deleting by remember { mutableStateOf<RemoteFile?>(null) }
    var creatingFolder by remember { mutableStateOf(false) }
    var downloading by remember { mutableStateOf<RemoteFile?>(null) }

    val saveAs = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("*/*")) { uri ->
        val file = downloading
        downloading = null
        if (uri != null && file != null) vm.download(file, uri)
    }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) vm.upload(uris)
    }
    LaunchedEffect(vm) {
        vm.messages.collect { m ->
            val text = when (m) {
                is FilesMessage.Failure -> errorText(context, m.error)
                is FilesMessage.Info -> resources.getString(m.resId, m.arg)
            }
            launch { snackbar.showSnackbar(text) }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Surface(tonalElevation = 2.dp) {
                Row(Modifier.fillMaxWidth().padding(start = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = vm::up, enabled = state.path.length > 1 && !state.loading) {
                        Icon(painterResource(R.drawable.ic_arrow_up), stringResource(R.string.files_up))
                    }
                    Text(
                        state.path.ifEmpty { "…" }, fontFamily = FontFamily.Monospace, maxLines = 1,
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f).horizontalScroll(rememberScrollState(), reverseScrolling = true),
                    )
                    IconButton(onClick = vm::refresh, enabled = !state.loading) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.files_refresh))
                    }
                    IconButton(onClick = { creatingFolder = true }, enabled = state.path.isNotEmpty()) {
                        Icon(painterResource(R.drawable.ic_new_folder), stringResource(R.string.files_new_folder))
                    }
                    IconButton(onClick = { pickFiles.launch(arrayOf("*/*")) }, enabled = state.path.isNotEmpty()) {
                        Icon(painterResource(R.drawable.ic_upload), stringResource(R.string.files_upload))
                    }
                }
            }
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth()) else HorizontalDivider()

            Box(Modifier.weight(1f).fillMaxWidth()) {
                val error = state.error
                when {
                    error != null -> StatusBox(errorText(context, error), warning = true) {
                        Button(onClick = vm::refresh) { Text(stringResource(R.string.action_retry)) }
                    }
                    state.entries.isEmpty() && !state.loading && state.path.isNotEmpty() ->
                        EmptyState(R.drawable.ic_folder, stringResource(R.string.files_empty), "")
                    else -> LazyColumn(Modifier.fillMaxSize()) {
                        items(state.entries, key = { it.path }) { f ->
                            FileRow(
                                file = f,
                                menuOpen = menuFor == f,
                                onClick = { if (f.isDirectory) vm.open(f.path) else menuFor = f },
                                onMenu = { menuFor = f },
                                onDismissMenu = { menuFor = null },
                                onDownload = { menuFor = null; downloading = f; saveAs.launch(f.name) },
                                onRename = { menuFor = null; renaming = f },
                                onDelete = { menuFor = null; deleting = f },
                            )
                        }
                    }
                }
            }
            state.transfer?.let { TransferBar(it, onCancel = vm::cancelTransfer) }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(bottom = if (state.transfer != null) 72.dp else 0.dp))
    }

    if (creatingFolder) {
        NameDialog(stringResource(R.string.files_new_folder), "", onDismiss = { creatingFolder = false }) {
            creatingFolder = false; vm.mkdir(it)
        }
    }
    renaming?.let { f ->
        NameDialog(stringResource(R.string.files_rename), f.name, onDismiss = { renaming = null }) {
            renaming = null; if (it != f.name) vm.rename(f, it)
        }
    }
    deleting?.let { f ->
        ConfirmDialog(
            title = stringResource(R.string.files_delete_title, f.name),
            text = stringResource(if (f.isDirectory && !f.isSymlink) R.string.files_delete_folder else R.string.files_delete_file),
            confirmLabel = stringResource(R.string.action_delete),
            onConfirm = { deleting = null; vm.delete(f) },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun FileRow(
    file: RemoteFile, menuOpen: Boolean, onClick: () -> Unit, onMenu: () -> Unit, onDismissMenu: () -> Unit,
    onDownload: () -> Unit, onRename: () -> Unit, onDelete: () -> Unit,
) {
    val context = LocalContext.current
    val linkLabel = stringResource(R.string.files_symlink)
    val details = remember(file, linkLabel) {
        buildList {
            if (!file.isDirectory) add(Formatter.formatShortFileSize(context, file.size))
            if (file.modifiedEpochSec > 0) {
                add(DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(file.modifiedEpochSec * 1000)))
            }
            add(file.permissions)
            if (file.isSymlink) add(linkLabel)
        }.joinToString(" · ")
    }
    ListItem(
        modifier = Modifier.clickable(onClick = onClick),
        leadingContent = {
            Icon(
                painterResource(if (file.isDirectory) R.drawable.ic_folder else R.drawable.ic_file), null,
                tint = if (file.isDirectory) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        headlineContent = { Text(file.name, maxLines = 1, overflow = TextOverflow.MiddleEllipsis) },
        supportingContent = { Text(details, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        trailingContent = {
            Box {
                IconButton(onClick = onMenu) { Icon(Icons.Default.MoreVert, stringResource(R.string.action_more)) }
                DropdownMenu(expanded = menuOpen, onDismissRequest = onDismissMenu) {
                    if (!file.isDirectory) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.files_download)) },
                            leadingIcon = { Icon(painterResource(R.drawable.ic_download), null) },
                            onClick = onDownload,
                        )
                    }
                    DropdownMenuItem(text = { Text(stringResource(R.string.files_rename)) }, onClick = onRename)
                    DropdownMenuItem(text = { Text(stringResource(R.string.action_delete)) }, onClick = onDelete)
                }
            }
        },
    )
}

@Composable
private fun TransferBar(t: Transfer, onCancel: () -> Unit) {
    Surface(tonalElevation = 6.dp) {
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                val context = LocalContext.current
                val label = when {
                    !t.upload -> stringResource(R.string.files_downloading, t.name)
                    t.count > 1 -> stringResource(R.string.files_uploading_n, t.name, t.index, t.count)
                    else -> stringResource(R.string.files_uploading, t.name)
                }
                Text(label, maxLines = 1, overflow = TextOverflow.MiddleEllipsis, style = MaterialTheme.typography.bodyMedium)
                if (t.total > 0) {
                    LinearProgressIndicator(
                        progress = { (t.done.toFloat() / t.total).coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    )
                    Text(
                        "${Formatter.formatShortFileSize(context, t.done)} / ${Formatter.formatShortFileSize(context, t.total)}",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = 4.dp))
                    Text(Formatter.formatShortFileSize(context, t.done), style = MaterialTheme.typography.bodySmall)
                }
            }
            IconButton(onClick = onCancel) { Icon(Icons.Default.Close, stringResource(R.string.action_cancel)) }
        }
    }
}

@Composable
private fun NameDialog(title: String, initial: String, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var value by remember { mutableStateOf(initial) }
    val valid = RemotePaths.isValidName(value.trim())
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value, onValueChange = { value = it }, singleLine = true,
                label = { Text(stringResource(R.string.files_name)) },
                isError = value.isNotEmpty() && !valid,
                supportingText = if (value.isNotEmpty() && !valid) { { Text(stringResource(R.string.files_name_invalid)) } } else null,
            )
        },
        confirmButton = { TextButton(enabled = valid, onClick = { onConfirm(value.trim()) }) { Text(stringResource(R.string.action_ok)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
