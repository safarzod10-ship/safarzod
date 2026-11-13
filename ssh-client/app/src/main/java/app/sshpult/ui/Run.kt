package app.sshpult.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import app.sshpult.R
import app.sshpult.data.Script
import app.sshpult.ssh.CommandResult
import app.sshpult.ssh.CommandStatus
import app.sshpult.ssh.ScriptRunner
import app.sshpult.ssh.SshConnection
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.Locale

/** How much of one command's output is rendered; the copy button always copies everything. */
private const val MAX_SHOWN_CHARS = 20_000

class ScriptRunViewModel(private val connection: SshConnection, private val script: Script) : ViewModel() {
    private val commands = ScriptRunner.parse(script.commands)
    val results = MutableStateFlow(commands.map { CommandResult(it) })
    val running = MutableStateFlow(false)
    private var job: Job? = null

    fun start() {
        if (running.value) return
        running.value = true
        job = viewModelScope.launch {
            try {
                ScriptRunner.run(connection, commands, script.mode, script.stopOnError) { results.value = it }
            } finally {
                // Reached on normal completion and on Stop: nothing may stay "running".
                results.update { list ->
                    list.map { if (it.status == CommandStatus.RUNNING || it.status == CommandStatus.PENDING) it.copy(status = CommandStatus.SKIPPED) else it }
                }
                running.value = false
            }
        }
    }

    fun stop() {
        job?.cancel()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScriptRunScreen(scriptId: String, connectionId: String, onBack: () -> Unit) {
    val app = LocalApp.current
    val script = remember(scriptId) { app.repository.script(scriptId) }
    val profile = remember(connectionId) { app.repository.connection(connectionId) }
    // A script starts by itself exactly once; after a reconnect the user must press Run again.
    var autoStarted by rememberSaveable { mutableStateOf(false) }

    Scaffold(
        topBar = {
            ScreenHeader(
                title = {
                    Text(
                        stringResource(R.string.run_title, script?.name.orEmpty(), profile?.title.orEmpty()),
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                },
                navigationIcon = { BackButton(onBack) },
            )
        },
    ) { inner ->
        Box(Modifier.padding(inner).consumeWindowInsets(inner).fillMaxSize()) {
            if (script == null) {
                StatusBox(stringResource(R.string.script_missing)) {
                    Button(onClick = onBack) { Text(stringResource(R.string.action_close)) }
                }
            } else ConnectionGate(connectionId, onClose = onBack) { _, connection ->
                val vm: ScriptRunViewModel = viewModel(key = "run-$scriptId-${System.identityHashCode(connection)}") {
                    ScriptRunViewModel(connection, script)
                }
                LaunchedEffect(vm) {
                    if (!autoStarted) {
                        autoStarted = true
                        vm.start()
                    }
                }
                RunContent(vm)
            }
        }
    }
}

@Composable
private fun RunContent(vm: ScriptRunViewModel) {
    val results by vm.results.collectAsStateWithLifecycle()
    val running by vm.running.collectAsStateWithLifecycle()
    val ok = results.count { it.status == CommandStatus.OK }
    val failed = results.count { it.status == CommandStatus.FAILED }
    val skipped = results.count { it.status == CommandStatus.SKIPPED }
    val untouched = results.all { it.status == CommandStatus.PENDING }

    Column(Modifier.fillMaxSize()) {
        Surface(tonalElevation = 2.dp) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    when {
                        running -> stringResource(R.string.run_summary_running, ok + failed, results.size)
                        untouched -> stringResource(R.string.run_status_pending)
                        else -> stringResource(R.string.run_summary_done, ok, failed, skipped)
                    },
                    Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium,
                )
                if (running) {
                    FilledTonalButton(onClick = vm::stop) {
                        Icon(painterResource(R.drawable.ic_stop), null, Modifier.size(18.dp))
                        Text(stringResource(R.string.action_stop), Modifier.padding(start = 8.dp))
                    }
                } else {
                    Button(onClick = vm::start) {
                        Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
                        Text(
                            stringResource(if (untouched) R.string.action_run else R.string.action_rerun),
                            Modifier.padding(start = 8.dp),
                        )
                    }
                }
            }
        }
        CenteredContent(maxWidth = 900) {
            LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                itemsIndexed(results) { _, r -> ResultCard(r) }
            }
        }
    }
}

@Composable
private fun ResultCard(r: CommandResult) {
    val context = LocalContext.current
    var expanded by rememberSaveable(r.command) { mutableStateOf(true) }
    val finished = r.status == CommandStatus.OK || r.status == CommandStatus.FAILED
    Panel(Modifier.fillMaxWidth()) {
        Column(Modifier.clickable(enabled = finished) { expanded = !expanded }.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
                    when (r.status) {
                        CommandStatus.OK -> Icon(Icons.Default.CheckCircle, null, tint = StatusGreen)
                        CommandStatus.FAILED -> Icon(Icons.Default.Warning, null, tint = MaterialTheme.colorScheme.error)
                        CommandStatus.RUNNING -> SafabLoader(24.dp)
                        CommandStatus.SKIPPED -> Icon(Icons.Default.Clear, null, tint = MaterialTheme.colorScheme.outline)
                        CommandStatus.PENDING -> Text("•", color = MaterialTheme.colorScheme.outline)
                    }
                }
                Column(Modifier.weight(1f)) {
                    Text(r.command, fontFamily = FontFamily.Monospace, fontSize = 14.sp, maxLines = if (expanded) 6 else 1, overflow = TextOverflow.Ellipsis)
                    val meta = buildList {
                        add(
                            stringResource(
                                when (r.status) {
                                    CommandStatus.PENDING -> R.string.run_status_pending
                                    CommandStatus.RUNNING -> R.string.run_status_running
                                    CommandStatus.OK -> R.string.run_status_ok
                                    CommandStatus.FAILED -> R.string.run_status_failed
                                    CommandStatus.SKIPPED -> R.string.run_status_skipped
                                },
                            ),
                        )
                        r.exitCode?.takeIf { it != 0 }?.let { add(stringResource(R.string.run_exit_code, it)) }
                        if (finished && r.error == null) {
                            add(stringResource(R.string.run_duration, String.format(Locale.getDefault(), "%.1f", r.durationMs / 1000.0)))
                        }
                    }.joinToString(" · ")
                    Text(
                        meta, style = MaterialTheme.typography.bodySmall,
                        color = if (r.status == CommandStatus.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (finished && r.output.isNotEmpty()) {
                    IconButton(onClick = { copyToClipboard(context, r.command, r.output) }) {
                        Icon(painterResource(R.drawable.ic_copy), stringResource(R.string.action_copy))
                    }
                }
            }
            r.error?.let { Text(errorText(context, it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            if (finished && expanded && (r.error == null || r.output.isNotEmpty())) {
                val shown = remember(r.output) { r.output.trimEnd().take(MAX_SHOWN_CHARS) }
                // Command output is tabular more often than not: keep lines intact and scroll sideways.
                Box(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(TerminalColors.background)
                        .horizontalScroll(rememberScrollState()).padding(10.dp),
                ) {
                    SelectionContainer {
                        Text(
                            shown.ifEmpty { stringResource(R.string.run_no_output) },
                            fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 16.sp, softWrap = false,
                            color = if (shown.isEmpty()) TerminalColors.dim else TerminalColors.text,
                        )
                    }
                }
                if (r.truncated || r.output.trimEnd().length > MAX_SHOWN_CHARS) {
                    Text(stringResource(R.string.run_truncated), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
