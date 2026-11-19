package com.safarzod.jarvis.ui.home

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Memory
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.safarzod.jarvis.core.Card
import com.safarzod.jarvis.core.CardIcon
import com.safarzod.jarvis.core.UiAction
import com.safarzod.jarvis.ui.components.GhostButton
import com.safarzod.jarvis.ui.components.GlassCard
import com.safarzod.jarvis.ui.components.IconBadge
import com.safarzod.jarvis.ui.components.PrimaryButton
import com.safarzod.jarvis.ui.components.glass
import com.safarzod.jarvis.ui.components.iconFor
import com.safarzod.jarvis.ui.theme.J
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

@Composable
fun ResultCard(card: Card, onAction: (UiAction) -> Unit, onOpen: (String) -> Unit) {
    when (card) {
        is Card.Big -> BigCard(card)
        is Card.ContactChoice -> ContactChoiceCard(card, onAction)
        is Card.SmsDraft -> SmsDraftCard(card, onAction)
        is Card.Calling -> CallingCard(card)
        is Card.Remembered -> InfoLike(Icons.Rounded.Memory, "Запомнил", "«${card.alias.alias}»  →  ${card.alias.title}", "Теперь так и буду понимать.", onClose = { onAction(UiAction.Dismiss) })
        is Card.ReminderSet -> InfoLike(iconFor(CardIcon.REMINDER), "Напоминание", card.text, whenText(card.at), onClose = { onAction(UiAction.Dismiss) })
        is Card.ReminderPickTime -> ReminderPickCard(card, onAction)
        is Card.TimerSet -> TimerCard(card)
        is Card.AlarmSet -> BigCard(Card.Big("Будильник", "%d:%02d".format(card.hour, card.minute), if (card.dayOffset == 1) "Завтра" else alarmSub(card.hour, card.minute), CardIcon.ALARM))
        is Card.Messages -> MessagesCard(card, onAction)
        is Card.Info -> InfoLike(iconFor(card.icon), card.title, card.body, null, onClose = { onAction(UiAction.Dismiss) })
        is Card.Permission -> PermissionCard(card, onOpen)
        is Card.Opened -> InfoLike(iconFor(card.icon), card.title, card.subtitle ?: "Открыто", null, compact = true, onClose = { onAction(UiAction.Dismiss) })
        is Card.Offer -> OfferCard(card, onAction)
        Card.Help -> HelpCard(onOpen)
    }
}

@Composable
private fun CardHeader(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, onClose: (() -> Unit)? = null, tint: Color = J.c.accent) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconBadge(icon, tint, 36.dp)
        Spacer(Modifier.width(12.dp))
        Text(title.uppercase(), style = J.t.mono, color = J.c.text2, modifier = Modifier.weight(1f))
        if (onClose != null) {
            Box(Modifier.size(32.dp).clip(CircleShape).clickable(onClick = onClose), contentAlignment = Alignment.Center) {
                Icon(Icons.Rounded.Close, "Скрыть", tint = J.c.text3, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
private fun BigCard(c: Card.Big) {
    GlassCard(Modifier.fillMaxWidth()) {
        CardHeader(iconFor(c.icon), c.label)
        Spacer(Modifier.height(14.dp))
        if (c.icon == CardIcon.CLOCK) LiveClock() else
            Text(c.value, style = J.t.big, color = J.c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (c.sub != null) {
            Spacer(Modifier.height(6.dp))
            Text(c.sub, style = J.t.bodyL, color = J.c.text2)
        }
        if (c.icon == CardIcon.BATTERY || c.icon == CardIcon.VOLUME) {
            val pct = c.value.filter { it.isDigit() }.toIntOrNull() ?: 0
            Spacer(Modifier.height(16.dp))
            Meter(pct / 100f, if (c.icon == CardIcon.BATTERY && pct <= 15) J.c.danger else J.c.accent)
        }
    }
}

@Composable
private fun LiveClock() {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
    val f = remember { SimpleDateFormat("HH:mm", Locale.getDefault()) }
    val s = remember { SimpleDateFormat(":ss", Locale.getDefault()) }
    Row(verticalAlignment = Alignment.Bottom) {
        Text(f.format(Date(now)), style = J.t.big, color = J.c.text)
        Text(s.format(Date(now)), style = J.t.title, color = J.c.accent, modifier = Modifier.padding(bottom = 8.dp, start = 4.dp))
    }
}

@Composable
private fun Meter(v: Float, color: Color) {
    Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(Color.White.copy(alpha = 0.07f))) {
        Box(
            Modifier.fillMaxWidth(v.coerceIn(0.02f, 1f)).height(8.dp).clip(RoundedCornerShape(4.dp))
                .background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.55f), color)))
        )
    }
}

@Composable
private fun ContactChoiceCard(c: Card.ContactChoice, onAction: (UiAction) -> Unit) {
    GlassCard(Modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
        CardHeader(Icons.Rounded.Call, "Кого именно?", onClose = { onAction(UiAction.Cancel) })
        Spacer(Modifier.height(12.dp))
        c.matches.forEachIndexed { i, m ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).clickable { onAction(UiAction.PickContact(i)) }
                    .background(if (i == 0) J.c.accent.copy(alpha = 0.07f) else Color.Transparent)
                    .padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Avatar(m.contact.name)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(m.contact.name, style = J.t.label, color = J.c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOfNotNull(m.contact.phoneLabel, m.contact.phone).joinToString(" · "), style = J.t.bodyS, color = J.c.text3, maxLines = 1)
                }
                Text("${i + 1}", style = J.t.monoL, color = J.c.text3)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("Скажите номер варианта или имя — и я запомню выбор.", style = J.t.bodyS, color = J.c.text3, modifier = Modifier.padding(horizontal = 6.dp))
    }
}

@Composable
fun Avatar(name: String, size: androidx.compose.ui.unit.Dp = 42.dp) {
    val initials = name.split(' ').filter { it.isNotBlank() }.take(2).joinToString("") { it.take(1).uppercase() }.ifEmpty { "?" }
    val hue = (name.hashCode() and 0xFFFF) % 360
    val c1 = Color.hsv(hue.toFloat(), 0.55f, 0.95f)
    Box(
        Modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(c1.copy(alpha = 0.55f), c1.copy(alpha = 0.18f)))),
        contentAlignment = Alignment.Center,
    ) { Text(initials, style = J.t.label, color = Color.White) }
}

@Composable
private fun SmsDraftCard(c: Card.SmsDraft, onAction: (UiAction) -> Unit) {
    var editing by remember(c.text) { mutableStateOf(false) }
    var text by remember(c.text) { mutableStateOf(c.text) }
    GlassCard(Modifier.fillMaxWidth()) {
        CardHeader(iconFor(CardIcon.MESSAGE), if (c.via != null) c.via.title else "Сообщение", onClose = { onAction(UiAction.Cancel) })
        Spacer(Modifier.height(14.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Avatar(c.name, 34.dp)
            Spacer(Modifier.width(10.dp))
            Column {
                Text(c.name, style = J.t.label, color = J.c.text)
                Text(c.number, style = J.t.bodyS, color = J.c.text3)
            }
        }
        Spacer(Modifier.height(14.dp))
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = 20.dp, bottomEnd = 6.dp))
                .background(Brush.linearGradient(listOf(J.c.accent.copy(alpha = 0.22f), J.c.accentDeep.copy(alpha = 0.18f))))
                .padding(16.dp)
        ) {
            if (editing) {
                BasicTextField(
                    value = text, onValueChange = { text = it }, textStyle = J.t.bodyL.copy(color = J.c.text),
                    cursorBrush = SolidColor(J.c.accent), modifier = Modifier.fillMaxWidth(),
                )
            } else Text(text, style = J.t.bodyL, color = J.c.text)
        }
        if (c.polished) {
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.AutoAwesome, null, tint = J.c.violet, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text("Текст поправлен нейросетью", style = J.t.bodyS, color = J.c.text3)
            }
        }
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (editing) {
                GhostButton("Готово", Modifier.weight(1f), Icons.Rounded.Edit) { editing = false; onAction(UiAction.EditDraft(text)) }
            } else {
                GhostButton("Изменить", Modifier.weight(1f), Icons.Rounded.Edit) { editing = true }
            }
            PrimaryButton(if (c.via != null) "Открыть" else "Отправить", Modifier.weight(1.3f), Icons.AutoMirrored.Rounded.Send) {
                if (editing) { editing = false; onAction(UiAction.EditDraft(text)) }
                onAction(UiAction.SendDraft)
            }
        }
        Spacer(Modifier.height(8.dp))
        Text("Или скажите «да» / «отправь».", style = J.t.bodyS, color = J.c.text3, modifier = Modifier.padding(start = 4.dp))
    }
}

@Composable
private fun CallingCard(c: Card.Calling) {
    val inf = rememberInfiniteTransition(label = "ring")
    val p by inf.animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "p")
    val a = J.c.success
    GlassCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(64.dp)) {
                    drawCircle(a.copy(alpha = (1f - p) * 0.4f), radius = size.minDimension / 2 * (0.6f + 0.4f * p))
                }
                Avatar(c.name, 48.dp)
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text("ВЫЗОВ", style = J.t.mono, color = a)
                Spacer(Modifier.height(2.dp))
                Text(c.name, style = J.t.title, color = J.c.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(listOfNotNull(c.label, c.number).joinToString(" · "), style = J.t.bodyS, color = J.c.text3)
            }
        }
    }
}

@Composable
private fun TimerCard(c: Card.TimerSet) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(c.endsAt) { while (now < c.endsAt) { now = System.currentTimeMillis(); delay(200) } }
    val left = ((c.endsAt - now) / 1000).coerceAtLeast(0)
    val frac = if (c.seconds > 0) left.toFloat() / c.seconds else 0f
    val a = J.c.accent
    GlassCard(Modifier.fillMaxWidth()) {
        CardHeader(iconFor(CardIcon.TIMER), "Таймер")
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(84.dp)) {
                    drawArc(Color.White.copy(alpha = 0.08f), 0f, 360f, false, style = Stroke(6.dp.toPx()))
                    drawArc(Brush.sweepGradient(listOf(a.copy(alpha = 0.4f), a)), -90f, 360f * frac, false, style = Stroke(6.dp.toPx(), cap = StrokeCap.Round))
                }
            }
            Spacer(Modifier.width(18.dp))
            Column {
                val h = left / 3600; val m = (left % 3600) / 60; val s = left % 60
                Text(if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s), style = J.t.big.copy(fontSize = J.t.hero.fontSize), color = J.c.text)
                Text(if (left == 0L) "Время вышло" else "Сработает в " + SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(c.endsAt)), style = J.t.body, color = J.c.text2)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ReminderPickCard(c: Card.ReminderPickTime, onAction: (UiAction) -> Unit) {
    val now = System.currentTimeMillis()
    fun at(h: Int, dayOffset: Int): Long = Calendar.getInstance().apply {
        add(Calendar.DAY_OF_YEAR, dayOffset); set(Calendar.HOUR_OF_DAY, h); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0)
    }.timeInMillis
    val evening = at(19, 0).let { if (it < now + 10 * 60_000) at(19, 1) else it }
    val options = listOf(
        "Через 15 мин" to now + 15 * 60_000,
        "Через час" to now + 60 * 60_000,
        (if (evening > at(23, 0)) "Завтра в 19:00" else "Вечером, 19:00") to evening,
        "Завтра, 9:00" to at(9, 1),
    )
    GlassCard(Modifier.fillMaxWidth()) {
        CardHeader(iconFor(CardIcon.REMINDER), "Когда напомнить?", onClose = { onAction(UiAction.Cancel) })
        Spacer(Modifier.height(10.dp))
        Text(c.text, style = J.t.bodyL, color = J.c.text)
        Spacer(Modifier.height(14.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (label, t) ->
                Box(
                    Modifier.glass(RoundedCornerShape(16.dp)).clickable { onAction(UiAction.RemindAt(t)) }.padding(horizontal = 16.dp, vertical = 12.dp)
                ) { Text(label, style = J.t.label.copy(fontSize = J.t.body.fontSize), color = J.c.accent) }
            }
        }
        Spacer(Modifier.height(10.dp))
        Text("Или скажите: «через 20 минут», «в 18:30».", style = J.t.bodyS, color = J.c.text3)
    }
}

@Composable
private fun MessagesCard(c: Card.Messages, onAction: (UiAction) -> Unit) {
    GlassCard(Modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
        CardHeader(iconFor(CardIcon.MESSAGE), "Сообщения", onClose = { onAction(UiAction.Dismiss) })
        Spacer(Modifier.height(8.dp))
        c.items.forEach { m ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp, horizontal = 4.dp)) {
                Avatar(m.sender, 36.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(m.sender, style = J.t.label, color = J.c.text, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                        Text(m.app + " · " + SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(m.time)), style = J.t.bodyS, color = J.c.text3)
                    }
                    Text(m.text, style = J.t.body, color = J.c.text2, maxLines = 4, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun PermissionCard(c: Card.Permission, onOpen: (String) -> Unit) {
    GlassCard(Modifier.fillMaxWidth()) {
        CardHeader(Icons.Rounded.Shield, "Нужно разрешение", tint = J.c.warn)
        Spacer(Modifier.height(12.dp))
        Text(c.title, style = J.t.title.copy(fontSize = J.t.bodyL.fontSize), color = J.c.text)
        Spacer(Modifier.height(6.dp))
        Text(c.body, style = J.t.body, color = J.c.text2)
        Spacer(Modifier.height(16.dp))
        PrimaryButton("Разрешить", Modifier.fillMaxWidth()) { onOpen("need:" + c.need.name) }
    }
}

@Composable
private fun OfferCard(c: Card.Offer, onAction: (UiAction) -> Unit) {
    GlassCard(Modifier.fillMaxWidth()) {
        CardHeader(Icons.Rounded.Search, c.title, onClose = { onAction(UiAction.Dismiss) })
        Spacer(Modifier.height(10.dp))
        Text(c.body, style = J.t.bodyL, color = J.c.text)
        Spacer(Modifier.height(14.dp))
        PrimaryButton(c.button, Modifier.fillMaxWidth(), Icons.Rounded.Search) { onAction(UiAction.Search(c.query)) }
    }
}

@Composable
private fun InfoLike(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    body: String,
    sub: String?,
    compact: Boolean = false,
    onClose: (() -> Unit)? = null,
) {
    GlassCard(Modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(if (compact) 16.dp else 20.dp)) {
        CardHeader(icon, title, onClose)
        Spacer(Modifier.height(if (compact) 8.dp else 12.dp))
        Text(body, style = if (compact) J.t.bodyL else J.t.bodyL.copy(fontSize = J.t.reply.fontSize, lineHeight = J.t.reply.lineHeight), color = J.c.text)
        if (sub != null) {
            Spacer(Modifier.height(6.dp))
            Text(sub, style = J.t.body, color = J.c.text2)
        }
    }
}

@Composable
private fun HelpCard(onOpen: (String) -> Unit) {
    val groups = listOf(
        "Связь" to "«Позвони маме» · «Напиши брату, что я еду» · «Напиши в ватсап Саше»",
        "Приложения" to "«Открой Телеграм» · «Включи на ютубе котиков» · «Построй маршрут до дома»",
        "Телефон" to "«Включи фонарик» · «Громче» · «Следующая песня» · «Сделай скриншот»",
        "Время" to "«Разбуди в 7:30» · «Таймер на 10 минут» · «Напомни через час позвонить»",
        "Память" to "«Мама — это контакт Mom» · «Телега — это Телеграм» · «Что ты помнишь?»",
    )
    GlassCard(Modifier.fillMaxWidth()) {
        CardHeader(iconFor(CardIcon.INFO), "Что я умею")
        Spacer(Modifier.height(8.dp))
        groups.forEach { (t, ex) ->
            Spacer(Modifier.height(10.dp))
            Text(t, style = J.t.label, color = J.c.accent)
            Spacer(Modifier.height(2.dp))
            Text(ex, style = J.t.body, color = J.c.text2)
        }
        Spacer(Modifier.height(16.dp))
        GhostButton("Все команды", Modifier.fillMaxWidth()) { onOpen("commands") }
    }
}

private fun whenText(at: Long): String {
    val c = Calendar.getInstance().apply { timeInMillis = at }
    val today = Calendar.getInstance()
    val tomorrow = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, 1) }
    val day = when {
        c.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR) && c.get(Calendar.YEAR) == today.get(Calendar.YEAR) -> "Сегодня"
        c.get(Calendar.DAY_OF_YEAR) == tomorrow.get(Calendar.DAY_OF_YEAR) && c.get(Calendar.YEAR) == tomorrow.get(Calendar.YEAR) -> "Завтра"
        else -> SimpleDateFormat("d MMMM", Locale.forLanguageTag("ru")).format(Date(at))
    }
    return "$day в " + SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(at))
}

private fun alarmSub(h: Int, m: Int): String {
    val now = Calendar.getInstance()
    val t = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, h); set(Calendar.MINUTE, m); set(Calendar.SECOND, 0) }
    if (!t.after(now)) t.add(Calendar.DAY_OF_YEAR, 1)
    val mins = (t.timeInMillis - now.timeInMillis) / 60_000
    return "Через ${mins / 60} ч ${mins % 60} мин"
}
