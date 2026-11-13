package app.sshpult.ui

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.sshpult.R
import app.sshpult.data.AuthType
import app.sshpult.data.ConnectionProfile
import app.sshpult.data.QuickTarget
import app.sshpult.data.Script
import app.sshpult.data.parseQuickTarget
import app.sshpult.ssh.RunMode
import app.sshpult.ssh.ScriptRunner

private enum class HomeTab(val label: Int, val icon: Int) {
    CONNECTIONS(R.string.tab_connections, R.drawable.ic_server),
    SCRIPTS(R.string.tab_scripts, R.drawable.ic_script),
    KEYS(R.string.tab_keys, R.drawable.ic_key),
}

/** Lists end above the floating dock. */
private val ListPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 120.dp)
private val TileGradient = Brush.verticalGradient(listOf(Color(0xFF262624), Color(0xFF121211)))

@Composable
fun HomeScreen(
    onOpenSession: (String) -> Unit,
    onEditConnection: (String?) -> Unit,
    onEditScript: (String?) -> Unit,
    onRunScript: (scriptId: String, connectionId: String) -> Unit,
) {
    val app = LocalApp.current
    val data by app.repository.data.collectAsStateWithLifecycle()
    var tab by rememberSaveable { mutableStateOf(HomeTab.CONNECTIONS) }
    var showAbout by rememberSaveable { mutableStateOf(false) }
    var keyMenu by remember { mutableStateOf(false) }
    var keyAction by remember { mutableStateOf<KeyAction?>(null) }

    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal))) {
            // Brand row — the wordmark opens "About".
            Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 18.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                val about = stringResource(R.string.action_about)
                SafabWordmark(
                    Modifier.clip(MaterialTheme.shapes.small)
                        .clickable(onClickLabel = about, role = Role.Button) { showAbout = true }
                        .padding(vertical = 4.dp, horizontal = 2.dp),
                )
            }
            // Section title with its count, and the one "add" action for that section.
            Row(
                Modifier.fillMaxWidth().padding(start = 20.dp, end = 18.dp, top = 22.dp, bottom = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    stringResource(tab.label), fontSize = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.5).sp,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                val count = when (tab) {
                    HomeTab.CONNECTIONS -> data.connections.size
                    HomeTab.SCRIPTS -> data.scripts.size
                    HomeTab.KEYS -> data.keys.size
                }
                if (count > 0) {
                    Text(
                        count.toString(), fontSize = 17.sp, fontFamily = FontFamily.Monospace,
                        color = MaterialTheme.colorScheme.outline, modifier = Modifier.padding(start = 10.dp, top = 12.dp),
                    )
                }
                Spacer(Modifier.weight(1f))
                Box {
                    RoundButton(
                        R.drawable.ic_plus, stringResource(R.string.action_add), filled = true, size = 48.dp,
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
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (tab) {
                    HomeTab.CONNECTIONS -> ConnectionsTab(onOpenSession, onEditConnection)
                    HomeTab.SCRIPTS -> ScriptsTab(onEditScript, onRunScript)
                    HomeTab.KEYS -> KeysTab(pendingAction = keyAction, onActionHandled = { keyAction = null })
                }
            }
        }
        Dock(
            selected = tab, onSelect = { tab = it },
            modifier = Modifier.align(Alignment.BottomCenter)
                .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom)).padding(bottom = 16.dp),
        )
    }
    if (showAbout) AboutDialog(onDismiss = { showAbout = false })
}

/** Floating navigation: a graphite capsule; the current section sits on a light pill. */
@Composable
private fun Dock(selected: HomeTab, onSelect: (HomeTab) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier.shadow(18.dp, CircleShape, ambientColor = Color(0x33000000), spotColor = Color(0x55000000))
            .clip(CircleShape).background(TileGradient).padding(6.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalAlignment = Alignment.CenterVertically,
    ) {
        HomeTab.entries.forEach { t ->
            val active = t == selected
            val fg = if (active) Color(0xFF171715) else Color(0xFFA29E96)
            Row(
                Modifier.clip(CircleShape).background(if (active) Color(0xFFF2EFE9) else Color.Transparent)
                    .selectable(selected = active, role = Role.Tab, onClick = { onSelect(t) })
                    .heightIn(min = 48.dp).padding(horizontal = if (active) 16.dp else 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(painterResource(t.icon), null, Modifier.size(20.dp), tint = fg)
                Text(
                    stringResource(t.label), color = fg, fontSize = 13.5.sp, maxLines = 1,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                )
            }
        }
    }
}

@Composable
private fun AboutDialog(onDismiss: () -> Unit) {
    val context = LocalContext.current
    val version = remember {
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "1.0"
    }
    fun openTelegram() {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, DEVELOPER_TELEGRAM_URL.toUri())) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { SafabAvatar(84.dp, animated = true) },
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
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 14.dp)) {
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

// ---- Servers ---------------------------------------------------------------------------------

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
                Modifier.padding(bottom = 96.dp),
            )
        } else {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 300.dp),
                contentPadding = ListPadding,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // open sessions first, then the saved order
                items(data.connections.sortedByDescending { it.id in online }, key = { it.id }) { c ->
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

/**
 * The command line of the home screen: `login@host[:port]`, Enter — and you are in.
 * Always graphite, like a strip of terminal, whatever the theme.
 */
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
    Column(Modifier.padding(start = 18.dp, end = 18.dp, bottom = 14.dp)) {
        Row(
            Modifier.fillMaxWidth().shadow(if (isSystemInDarkTheme()) 0.dp else 12.dp, RoundedCornerShape(24.dp), spotColor = Color(0x44000000))
                .clip(RoundedCornerShape(24.dp)).background(TileGradient)
                .heightIn(min = 64.dp).padding(start = 20.dp, end = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("❯", color = NodeLight, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Spacer(Modifier.width(12.dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (text.isEmpty()) {
                    Text(
                        stringResource(R.string.quick_hint), color = Color(0xFF8F8B83),
                        fontFamily = FontFamily.Monospace, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
                val label = stringResource(R.string.quick_title)
                BasicTextField(
                    value = text, onValueChange = { text = it; invalid = false }, singleLine = true,
                    textStyle = TextStyle(color = Color(0xFFF2EFE9), fontFamily = FontFamily.Monospace, fontSize = 15.sp),
                    cursorBrush = SolidColor(NodeLight),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
                        keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go,
                    ),
                    keyboardActions = KeyboardActions(onGo = { go() }),
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
                )
            }
            Box(
                Modifier.size(46.dp).clip(CircleShape)
                    .background(if (text.isBlank()) SolidColor(Color(0xFF2E2E2B)) else Brush.linearGradient(listOf(NodeLight, NodeDeep)))
                    .clickable(enabled = text.isNotBlank(), onClick = ::go),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    painterResource(R.drawable.ic_arrow_right), stringResource(R.string.action_connect), Modifier.size(20.dp),
                    tint = if (text.isBlank()) Color(0xFF77736B) else Color(0xFF1F0D05),
                )
            }
        }
        if (invalid) {
            Text(
                stringResource(R.string.quick_invalid), color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(start = 20.dp, top = 6.dp),
            )
        }
    }
}

/** Two-letter badge: a quick visual anchor for each server. */
@Composable
private fun Monogram(text: String, online: Boolean) {
    Box {
        Box(
            Modifier.size(48.dp).clip(RoundedCornerShape(16.dp))
                .background(if (online) TileGradient else SolidColor(MaterialTheme.colorScheme.surfaceContainer)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 15.sp,
                color = if (online) Color(0xFFF2EFE9) else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (online) {
            Box(
                Modifier.align(Alignment.BottomEnd).size(14.dp).clip(CircleShape)
                    .background(MaterialTheme.colorScheme.surfaceContainerLowest).padding(2.5.dp).clip(CircleShape).background(StatusGreen),
            )
        }
    }
}

private fun initials(profile: ConnectionProfile): String {
    val source = profile.name.ifBlank { profile.host }
    val letters = source.split(' ', '-', '_', '.').filter { it.isNotBlank() && it.first().isLetterOrDigit() }
    return when {
        letters.size >= 2 && profile.name.isNotBlank() -> "${letters[0].first()}${letters[1].first()}"
        else -> source.filter { it.isLetterOrDigit() }.take(2)
    }.uppercase().ifEmpty { "#" }
}

@Composable
private fun ConnectionCard(
    profile: ConnectionProfile, online: Boolean,
    onOpen: () -> Unit, onEdit: () -> Unit, onDuplicate: () -> Unit, onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    Panel(Modifier.fillMaxWidth(), onClick = onOpen) {
        Row(Modifier.padding(start = 14.dp, top = 14.dp, bottom = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Monogram(initials(profile), online)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    profile.name.ifBlank { profile.address }, fontSize = 16.5.sp,
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
                        details, fontSize = 12.5.sp, color = if (online) StatusGreen else MaterialTheme.colorScheme.onSurfaceVariant,
                        fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.padding(top = 3.dp),
                    )
                }
            }
            Box {
                IconButton(onClick = { menu = true }) {
                    Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.action_more), tint = MaterialTheme.colorScheme.outline)
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

// ---- Scripts ---------------------------------------------------------------------------------

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
            Modifier.padding(bottom = 96.dp),
        )
    } else {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 300.dp),
            contentPadding = ListPadding,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            items(data.scripts, key = { it.id }) { s ->
                val commands = remember(s.commands) { ScriptRunner.parse(s.commands) }
                Panel(Modifier.fillMaxWidth(), onClick = { onEdit(s.id) }) {
                    Column(Modifier.padding(start = 18.dp, top = 16.dp, bottom = 16.dp, end = 14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(s.name, fontSize = 16.5.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                Text(
                                    stringResource(
                                        if (s.mode == RunMode.PARALLEL) R.string.script_commands_count_par
                                        else R.string.script_commands_count_seq,
                                        commands.size,
                                    ),
                                    fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(top = 3.dp),
                                )
                            }
                            RoundButton(
                                R.drawable.ic_play, stringResource(R.string.action_run), onClick = { running = s },
                                filled = true, enabled = commands.isNotEmpty(),
                            )
                        }
                        if (commands.isNotEmpty()) {
                            // a peek at what the script does
                            Text(
                                commands.take(2).joinToString("\n") { "$ $it" },
                                fontFamily = FontFamily.Monospace, fontSize = 12.sp, lineHeight = 17.sp, maxLines = 2,
                                overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 12.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp))
                                    .background(MaterialTheme.colorScheme.surfaceContainer).padding(horizontal = 12.dp, vertical = 9.dp),
                            )
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
                        colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                        modifier = Modifier.clip(MaterialTheme.shapes.small).clickable { onPick(item) },
                    )
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}
