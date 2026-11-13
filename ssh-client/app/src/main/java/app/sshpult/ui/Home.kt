package app.sshpult.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.sp
import app.sshpult.data.QuickTarget
import app.sshpult.data.parseQuickTarget
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
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
private val ListPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp)

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

    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)
            .windowInsetsPadding(WindowInsets.safeDrawing),
    ) {
        // Brand row: the wordmark opens "About"; "+" adds whatever the current section holds.
        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            val about = stringResource(R.string.action_about)
            SafabWordmark(
                Modifier.clip(MaterialTheme.shapes.small)
                    .clickable(onClickLabel = about, role = Role.Button) { showAbout = true }
                    .padding(vertical = 4.dp, horizontal = 2.dp),
            )
            Spacer(Modifier.weight(1f))
            Box {
                SquareButton(
                    R.drawable.ic_plus, stringResource(R.string.action_add), filled = true,
                    onClick = {
                        when (tab) {
                            HomeTab.CONNECTIONS -> onEditConnection(null)
                            HomeTab.SCRIPTS -> onEditScript(null)
                            HomeTab.KEYS -> keyMenu = true
                        }
                    },
                )
                KeyAddMenu(expanded = keyMenu, onDismiss = { keyMenu = false }, onAction = { keyAction = it })
            }
        }
        // Sections as large type: the active one in ink, the others quiet.
        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 18.dp, end = 12.dp, top = 14.dp, bottom = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(18.dp), verticalAlignment = Alignment.Bottom,
        ) {
            HomeTab.entries.forEach { t ->
                val active = t == tab
                Column(
                    Modifier.clip(MaterialTheme.shapes.extraSmall).selectable(selected = active, role = Role.Tab, onClick = { tab = t }),
                    horizontalAlignment = Alignment.Start,
                ) {
                    Text(
                        stringResource(t.label), fontSize = 22.sp, fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        color = if (active) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline,
                    )
                    Box(Modifier.padding(top = 4.dp).size(width = 18.dp, height = 3.dp).clip(CircleShape).background(if (active) accent else Color.Transparent))
                }
            }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (tab) {
                HomeTab.CONNECTIONS -> ConnectionsTab(onOpenSession, onEditConnection)
                HomeTab.SCRIPTS -> ScriptsTab(onEditScript, onRunScript)
                HomeTab.KEYS -> KeysTab(pendingAction = keyAction, onActionHandled = { keyAction = null })
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
    fun openTelegram() {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(DEVELOPER_TELEGRAM_URL))) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { SafabAvatar(72.dp, animated = true) },
        title = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(APP_NAME, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, letterSpacing = 4.sp)
                Text(
                    stringResource(R.string.about_version, version), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Text(stringResource(R.string.about_text))
                Panel(Modifier.fillMaxWidth(), onClick = ::openTelegram) {
                    Column(Modifier.padding(horizontal = 14.dp, vertical = 12.dp)) {
                        Caption(stringResource(R.string.about_developer))
                        Text(
                            "@$DEVELOPER_TELEGRAM", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold,
                            fontSize = 17.sp, modifier = Modifier.padding(top = 4.dp),
                        )
                        Text(
                            stringResource(R.string.about_telegram), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                Text(
                    stringResource(R.string.about_libraries),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        confirmButton = { Button(onClick = ::openTelegram) { Text(stringResource(R.string.about_write)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_close)) } },
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

    Column(Modifier.fillMaxSize()) {
        QuickConnectBar(onConnect = { onOpen(app.repository.findOrCreateConnection(it).id) })
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
                horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                // open sessions first, then the saved order
                items(data.connections.sortedByDescending { it.id in online }, key = { it.id }) { c ->
                    ConnectionRow(
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

/** One line to get in: `login@host[:port]`, Enter. The server is saved for next time. */
@Composable
private fun QuickConnectBar(onConnect: (QuickTarget) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    var invalid by rememberSaveable { mutableStateOf(false) }
    fun go() {
        val target = parseQuickTarget(text)
        if (target == null) invalid = true
        else {
            text = ""
            invalid = false
            onConnect(target)
        }
    }
    Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 6.dp)) {
        Surface(
            shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceContainerLowest,
            border = BorderStroke(1.dp, if (invalid) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outlineVariant),
        ) {
            Row(Modifier.heightIn(min = 52.dp).padding(start = 14.dp, end = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("❯", color = accent, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Spacer(Modifier.width(10.dp))
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                    if (text.isEmpty()) {
                        Text(
                            stringResource(R.string.quick_hint), color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontFamily = FontFamily.Monospace, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    }
                    val label = stringResource(R.string.quick_title)
                    BasicTextField(
                        value = text, onValueChange = { text = it; invalid = false }, singleLine = true,
                        textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontFamily = FontFamily.Monospace, fontSize = 15.sp),
                        cursorBrush = SolidColor(accent),
                        keyboardOptions = KeyboardOptions(
                            capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
                            keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go,
                        ),
                        keyboardActions = KeyboardActions(onGo = { go() }),
                        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
                    )
                }
                Box(
                    Modifier.size(42.dp).clip(MaterialTheme.shapes.small)
                        .background(if (text.isBlank()) Color.Transparent else MaterialTheme.colorScheme.primary)
                        .clickable(enabled = text.isNotBlank(), onClick = ::go),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        painterResource(R.drawable.ic_arrow_right), stringResource(R.string.action_connect), Modifier.size(20.dp),
                        tint = if (text.isBlank()) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.onPrimary,
                    )
                }
            }
        }
        if (invalid) {
            Text(
                stringResource(R.string.quick_invalid), color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 14.dp, top = 4.dp),
            )
        }
    }
}

@Composable
private fun ConnectionRow(
    profile: ConnectionProfile, online: Boolean,
    onOpen: () -> Unit, onEdit: () -> Unit, onDuplicate: () -> Unit, onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Panel(Modifier.fillMaxWidth(), onClick = onOpen) {
        Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(9.dp).clip(CircleShape)
                    .then(
                        if (online) Modifier.background(StatusGreen)
                        else Modifier.border(1.5.dp, MaterialTheme.colorScheme.outline, CircleShape),
                    ),
            )
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    profile.name.ifBlank { profile.address }, style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    fontFamily = if (profile.name.isBlank()) FontFamily.Monospace else null,
                )
                val details = buildList {
                    if (profile.name.isNotBlank()) add(profile.address)
                    if (profile.authType == AuthType.KEY) add(stringResource(R.string.auth_by_key))
                    if (online) add(stringResource(R.string.connection_online).lowercase())
                }.joinToString(" · ")
                if (details.isNotEmpty()) {
                    Text(
                        details, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Box {
                IconButton(onClick = { menu = true }) {
                    Icon(
                        Icons.Default.MoreVert, contentDescription = stringResource(R.string.action_more),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
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
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(data.scripts, key = { it.id }) { s ->
                val count = remember(s.commands) { ScriptRunner.parse(s.commands).size }
                Panel(Modifier.fillMaxWidth(), onClick = { onEdit(s.id) }) {
                    Row(Modifier.padding(start = 16.dp, top = 10.dp, bottom = 10.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(s.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(
                                stringResource(
                                    if (s.mode == RunMode.PARALLEL) R.string.script_commands_count_par
                                    else R.string.script_commands_count_seq,
                                    count,
                                ),
                                style = MaterialTheme.typography.bodySmall,
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
