package app.sshpult.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.adaptive.navigationsuite.NavigationSuiteScaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sshpult.R
import app.sshpult.data.AuthType
import app.sshpult.data.ConnectionProfile
import app.sshpult.data.Script
import app.sshpult.ssh.RunMode
import app.sshpult.ssh.ScriptRunner

private enum class HomeTab(val label: Int, val icon: Int) {
    CONNECTIONS(R.string.tab_connections, R.drawable.ic_server),
    SCRIPTS(R.string.tab_scripts, R.drawable.ic_script),
    KEYS(R.string.tab_keys, R.drawable.ic_key),
}

/** Padding that keeps the last list item clear of the floating action button. */
private val ListPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onOpenSession: (String) -> Unit,
    onEditConnection: (String?) -> Unit,
    onEditScript: (String?) -> Unit,
    onRunScript: (scriptId: String, connectionId: String) -> Unit,
) {
    var tab by rememberSaveable { mutableStateOf(HomeTab.CONNECTIONS) }
    var showAbout by rememberSaveable { mutableStateOf(false) }
    var keyMenu by remember { mutableStateOf(false) }
    var keyAction by remember { mutableStateOf<KeyAction?>(null) }

    // Bottom bar on phones, side rail on tablets / landscape — chosen automatically.
    NavigationSuiteScaffold(
        navigationSuiteItems = {
            HomeTab.entries.forEach { t ->
                item(
                    selected = tab == t,
                    onClick = { tab = t },
                    icon = { Icon(painterResource(t.icon), contentDescription = null) },
                    label = { Text(stringResource(t.label)) },
                )
            }
        },
    ) {
        Scaffold(
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(tab.label)) },
                    actions = {
                        IconButton(onClick = { showAbout = true }) {
                            Icon(Icons.Default.Info, contentDescription = stringResource(R.string.action_about))
                        }
                    },
                )
            },
            floatingActionButton = {
                Box {
                    FloatingActionButton(onClick = {
                        when (tab) {
                            HomeTab.CONNECTIONS -> onEditConnection(null)
                            HomeTab.SCRIPTS -> onEditScript(null)
                            HomeTab.KEYS -> keyMenu = true
                        }
                    }) { Icon(Icons.Default.Add, contentDescription = stringResource(R.string.action_add)) }
                    KeyAddMenu(expanded = keyMenu, onDismiss = { keyMenu = false }, onAction = { keyAction = it })
                }
            },
        ) { inner ->
            Box(Modifier.padding(inner).fillMaxSize()) {
                when (tab) {
                    HomeTab.CONNECTIONS -> ConnectionsTab(onOpenSession, onEditConnection)
                    HomeTab.SCRIPTS -> ScriptsTab(onEditScript, onRunScript)
                    HomeTab.KEYS -> KeysTab(pendingAction = keyAction, onActionHandled = { keyAction = null })
                }
            }
        }
    }
    if (showAbout) AboutDialog(onDismiss = { showAbout = false })
}

@Composable
private fun AboutDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val version = remember {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "1.0"
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.app_name)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.about_version, version), style = MaterialTheme.typography.labelLarge)
                Text(stringResource(R.string.about_text))
                Text(
                    stringResource(R.string.about_libraries),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) } },
    )
}

// ---- Connections tab ---------------------------------------------------------------------

@Composable
private fun ConnectionsTab(onOpen: (String) -> Unit, onEdit: (String?) -> Unit) {
    val app = LocalApp.current
    val data by app.repository.data.collectAsStateWithLifecycle()
    val online by app.sessions.connectedIds.collectAsStateWithLifecycle()
    var deleting by remember { mutableStateOf<ConnectionProfile?>(null) }
    val copySuffix = stringResource(R.string.copy_suffix)

    if (data.connections.isEmpty()) {
        EmptyState(
            R.drawable.ic_server,
            stringResource(R.string.connections_empty_title),
            stringResource(R.string.connections_empty_text),
        )
    } else {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 300.dp),
            contentPadding = ListPadding,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(data.connections, key = { it.id }) { c ->
                ConnectionCard(
                    profile = c,
                    online = c.id in online,
                    onOpen = { onOpen(c.id) },
                    onEdit = { onEdit(c.id) },
                    onDuplicate = { app.repository.duplicateConnection(c.id, copySuffix) },
                    onDelete = { deleting = c },
                )
            }
        }
    }
    deleting?.let { c ->
        ConfirmDialog(
            title = stringResource(R.string.delete_connection_title),
            text = stringResource(R.string.delete_connection_text, c.title),
            confirmLabel = stringResource(R.string.action_delete),
            onConfirm = {
                app.sessions.disconnect(c.id)
                app.repository.deleteConnection(c.id)
                deleting = null
            },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun ConnectionCard(
    profile: ConnectionProfile, online: Boolean,
    onOpen: () -> Unit, onEdit: () -> Unit, onDuplicate: () -> Unit, onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    ElevatedCard(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = CircleShape,
                color = if (online) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer,
                contentColor = if (online) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSecondaryContainer,
                modifier = Modifier.size(44.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        painterResource(if (profile.authType == AuthType.KEY) R.drawable.ic_key else R.drawable.ic_terminal),
                        contentDescription = null, modifier = Modifier.size(24.dp),
                    )
                }
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(profile.title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    profile.address, style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (online) {
                    Text(
                        stringResource(R.string.connection_online),
                        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            Box {
                IconButton(onClick = { menu = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.action_more))
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.action_edit)) }, onClick = { menu = false; onEdit() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.action_duplicate)) }, onClick = { menu = false; onDuplicate() })
                    DropdownMenuItem(text = { Text(stringResource(R.string.action_delete)) }, onClick = { menu = false; onDelete() })
                }
            }
        }
    }
}

// ---- Scripts tab -------------------------------------------------------------------------

@Composable
private fun ScriptsTab(onEdit: (String?) -> Unit, onRun: (String, String) -> Unit) {
    val app = LocalApp.current
    val data by app.repository.data.collectAsStateWithLifecycle()
    var running by remember { mutableStateOf<Script?>(null) }

    if (data.scripts.isEmpty()) {
        EmptyState(
            R.drawable.ic_script,
            stringResource(R.string.scripts_empty_title),
            stringResource(R.string.scripts_empty_text),
        )
    } else {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 300.dp),
            contentPadding = ListPadding,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(data.scripts, key = { it.id }) { s ->
                val count = remember(s.commands) { ScriptRunner.parse(s.commands).size }
                ElevatedCard(onClick = { onEdit(s.id) }, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(s.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                stringResource(
                                    if (s.mode == RunMode.PARALLEL) R.string.script_commands_count_par
                                    else R.string.script_commands_count_seq,
                                    count,
                                ),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        FilledTonalIconButton(onClick = { running = s }, enabled = count > 0) {
                            Icon(Icons.Default.PlayArrow, contentDescription = stringResource(R.string.action_run))
                        }
                    }
                }
            }
        }
    }
    running?.let { script ->
        PickerDialog(
            title = stringResource(R.string.script_choose_connection),
            emptyText = stringResource(R.string.script_no_connections),
            items = data.connections,
            headline = { it.title },
            supporting = { it.address },
            onPick = { running = null; onRun(script.id, it.id) },
            onDismiss = { running = null },
        )
    }
}

/** A simple "choose one from the list" dialog. */
@Composable
fun <T> PickerDialog(
    title: String, emptyText: String, items: List<T>,
    headline: (T) -> String, supporting: (T) -> String,
    onPick: (T) -> Unit, onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            if (items.isEmpty()) Text(emptyText)
            else LazyVerticalGrid(columns = GridCells.Fixed(1), modifier = Modifier.height((items.size.coerceAtMost(5) * 64).dp)) {
                items(items) { item ->
                    ListItem(
                        headlineContent = { Text(headline(item), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = { Text(supporting(item), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        colors = androidx.compose.material3.ListItemDefaults.colors(containerColor = androidx.compose.ui.graphics.Color.Transparent),
                        modifier = Modifier.clickable { onPick(item) },
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
