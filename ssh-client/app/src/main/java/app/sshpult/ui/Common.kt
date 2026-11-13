package app.sshpult.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.widget.Toast
import androidx.annotation.DrawableRes
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Surface
import androidx.compose.ui.draw.shadow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.sshpult.AppContainer
import app.sshpult.R
import app.sshpult.ssh.SshError

val LocalApp = staticCompositionLocalOf<AppContainer> { error("AppContainer not provided") }

// Warm sand / deep graphite surfaces, soft borderless tiles and the logo's ember orange for actions.
// Fixed colours (no wallpaper-derived palette), so the app looks the same on every phone.
private val LightColors = lightColorScheme(
    primary = Color(0xFFC8401A), onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFFFDCCF), onPrimaryContainer = Color(0xFF3A1004),
    secondary = Color(0xFF5E5A53), onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE9E5DD), onSecondaryContainer = Color(0xFF171715),
    tertiary = Color(0xFFE2531F), onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFFDCCF), onTertiaryContainer = Color(0xFF3A1004),
    background = Color(0xFFF2EFE9), onBackground = Color(0xFF171715),
    surface = Color(0xFFF2EFE9), onSurface = Color(0xFF171715),
    surfaceVariant = Color(0xFFE9E5DD), onSurfaceVariant = Color(0xFF6F6B63),
    surfaceTint = Color.Transparent,
    outline = Color(0xFFA9A49A), outlineVariant = Color(0xFFDDD8CE),
    error = Color(0xFFB3261E), onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFBE3E0), onErrorContainer = Color(0xFF5F1010),
    inverseSurface = Color(0xFF1C1C1A), inverseOnSurface = Color(0xFFF2EFE9), inversePrimary = Color(0xFFFF8A5C),
    surfaceBright = Color(0xFFFFFFFF), surfaceDim = Color(0xFFE4DFD6),
    surfaceContainerLowest = Color(0xFFFFFFFF), surfaceContainerLow = Color(0xFFF7F5F0),
    surfaceContainer = Color(0xFFECE8E0), surfaceContainerHigh = Color(0xFFFBFAF7),
    surfaceContainerHighest = Color(0xFFE4DFD6),
)
private val DarkColors = darkColorScheme(
    primary = Color(0xFFFF8A5C), onPrimary = Color(0xFF1F0D05),
    primaryContainer = Color(0xFF4A1C0B), onPrimaryContainer = Color(0xFFFFDACC),
    secondary = Color(0xFFB8B3AA), onSecondary = Color(0xFF0D0D0C),
    secondaryContainer = Color(0xFF2C2C29), onSecondaryContainer = Color(0xFFF2EFE9),
    tertiary = Color(0xFFFF8A5C), onTertiary = Color(0xFF1F0D05),
    tertiaryContainer = Color(0xFF4A1C0B), onTertiaryContainer = Color(0xFFFFDACC),
    background = Color(0xFF0D0D0C), onBackground = Color(0xFFF2EFE9),
    surface = Color(0xFF0D0D0C), onSurface = Color(0xFFF2EFE9),
    surfaceVariant = Color(0xFF232321), onSurfaceVariant = Color(0xFF9A968E),
    surfaceTint = Color.Transparent,
    outline = Color(0xFF5E5B55), outlineVariant = Color(0xFF2C2C29),
    error = Color(0xFFFF6B6B), onError = Color(0xFF3A0000),
    errorContainer = Color(0xFF4A1414), onErrorContainer = Color(0xFFFFDAD6),
    inverseSurface = Color(0xFFF2EFE9), inverseOnSurface = Color(0xFF171715), inversePrimary = Color(0xFFC8401A),
    surfaceBright = Color(0xFF2C2C29), surfaceDim = Color(0xFF0D0D0C),
    surfaceContainerLowest = Color(0xFF1A1A18), surfaceContainerLow = Color(0xFF151514),
    surfaceContainer = Color(0xFF1E1E1C), surfaceContainerHigh = Color(0xFF232321),
    surfaceContainerHighest = Color(0xFF2C2C29),
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(10.dp), small = RoundedCornerShape(14.dp), medium = RoundedCornerShape(20.dp),
    large = RoundedCornerShape(24.dp), extraLarge = RoundedCornerShape(30.dp),
)

@Composable
fun SshPultTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        shapes = AppShapes, content = content,
    )
}

/** The single accent colour (caret, prompt, active markers). */
val accent: Color @Composable get() = MaterialTheme.colorScheme.tertiary

/** "Session is open" marker. */
val StatusGreen = Color(0xFF2FA35B)

/** Colours of the terminal and command output panes (always dark, like a real console). */
object TerminalColors {
    val background = Color(0xFF0B0B0A)
    val text = Color(0xFFE4E4DE)
    val dim = Color(0xFF85857E)
    val cursor = Color(0xFFFF7A4D)
    val keys = Color(0xFF151514)
    val line = Color(0xFF262624)
}

/** Soft tile: no outline, generous radius; lifted by a faint shadow on the light theme. */
@Composable
fun Panel(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(22.dp)
    val color = MaterialTheme.colorScheme.surfaceContainerLowest
    val lifted = modifier.shadow(if (isSystemInDarkTheme()) 0.dp else 10.dp, shape, ambientColor = Color(0x14000000), spotColor = Color(0x1F3A2A14))
    if (onClick != null) Surface(onClick = onClick, modifier = lifted, shape = shape, color = color, content = content)
    else Surface(modifier = lifted, shape = shape, color = color, content = content)
}

/** Human-readable, localized explanation of a failure. */
fun errorText(context: Context, e: Throwable, keyAuth: Boolean = false): String = when (e) {
    is SshError.AuthFailed -> context.getString(if (keyAuth) R.string.err_auth_key else R.string.err_auth_password)
    is SshError.HostNotFound -> context.getString(R.string.err_host_not_found, e.host)
    is SshError.ConnectionRefused -> context.getString(R.string.err_refused)
    is SshError.Unreachable -> context.getString(R.string.err_unreachable)
    is SshError.Timeout -> context.getString(R.string.err_timeout)
    is SshError.BadPrivateKey -> context.getString(R.string.err_bad_key)
    is SshError.PassphraseRequired -> context.getString(R.string.err_passphrase_required)
    is SshError.WrongPassphrase -> context.getString(R.string.err_wrong_passphrase)
    is SshError.Disconnected -> context.getString(R.string.err_disconnected)
    is SshError.PermissionDenied -> context.getString(R.string.err_permission, e.path)
    is SshError.NoSuchFile -> context.getString(R.string.err_no_such_file, e.path)
    is SshError.Cancelled -> context.getString(R.string.err_cancelled)
    is SshError.PasswordRequired -> context.getString(R.string.err_password_required)
    is SshError.UnknownHostKey, is SshError.HostKeyChanged -> context.getString(R.string.err_host_key)
    is SshError.Other -> context.getString(R.string.err_other, e.detail)
    else -> context.getString(R.string.err_other, e.message ?: e.javaClass.simpleName)
}

fun copyToClipboard(context: Context, label: String, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText(label, text))
    // Android 13+ shows its own confirmation.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
        Toast.makeText(context, R.string.copied, Toast.LENGTH_SHORT).show()
    }
}

@Composable
fun BackButton(onBack: () -> Unit) {
    RoundButton(R.drawable.ic_back, stringResource(R.string.action_back), onBack, Modifier.padding(start = 10.dp))
}

/** Centers content and keeps it at a comfortable reading width on tablets and foldables. */
@Composable
fun CenteredContent(modifier: Modifier = Modifier, maxWidth: Int = 640, content: @Composable () -> Unit) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.widthIn(max = maxWidth.dp).fillMaxWidth()) { content() }
    }
}

@Composable
fun EmptyState(@DrawableRes icon: Int, title: String, text: String, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxSize().padding(32.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            painterResource(icon), contentDescription = null,
            modifier = Modifier.size(56.dp), tint = MaterialTheme.colorScheme.primary,
        )
        Spacer(Modifier.height(16.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.height(8.dp))
        Text(
            text, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
fun ConfirmDialog(
    title: String, text: String, confirmLabel: String,
    onConfirm: () -> Unit, onDismiss: () -> Unit, destructive: Boolean = true,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(confirmLabel, color = if (destructive) MaterialTheme.colorScheme.error else Color.Unspecified)
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.action_cancel)) } },
    )
}

/** Password field with a show/hide toggle. */
@Composable
fun SecretField(
    value: String, onValueChange: (String) -> Unit, label: String,
    modifier: Modifier = Modifier, supportingText: String? = null, isError: Boolean = false,
    onDone: (() -> Unit)? = null,
) {
    var visible by remember { mutableStateOf(false) }
    SafabField(
        value = value, onValueChange = onValueChange, label = { Text(label) },
        singleLine = true, modifier = modifier, isError = isError,
        supportingText = supportingText?.let { { Text(it) } },
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Password, autoCorrectEnabled = false,
            imeAction = if (onDone != null) ImeAction.Done else ImeAction.Default,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone?.invoke() }),
        trailingIcon = {
            IconButton(onClick = { visible = !visible }) {
                Icon(
                    painterResource(if (visible) R.drawable.ic_eye_off else R.drawable.ic_eye),
                    contentDescription = stringResource(if (visible) R.string.password_hide else R.string.password_show),
                )
            }
        },
    )
}
