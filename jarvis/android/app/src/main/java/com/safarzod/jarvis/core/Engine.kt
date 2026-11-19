package com.safarzod.jarvis.core

import android.content.Context
import android.os.Build
import android.util.Log
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import com.safarzod.jarvis.actions.Actions
import com.safarzod.jarvis.actions.Outcome
import com.safarzod.jarvis.data.AliasKind
import com.safarzod.jarvis.data.Apps
import com.safarzod.jarvis.data.Contact
import com.safarzod.jarvis.data.ContactMatch
import com.safarzod.jarvis.data.Contacts
import com.safarzod.jarvis.data.History
import com.safarzod.jarvis.data.IncomingMessage
import com.safarzod.jarvis.data.Memory
import com.safarzod.jarvis.data.MessageFeed
import com.safarzod.jarvis.data.Reminders
import com.safarzod.jarvis.data.Turn
import com.safarzod.jarvis.llm.LocalLlm
import com.safarzod.jarvis.nlu.Calc
import com.safarzod.jarvis.nlu.Command
import com.safarzod.jarvis.nlu.MediaAction
import com.safarzod.jarvis.nlu.MessengerApp
import com.safarzod.jarvis.nlu.Names
import com.safarzod.jarvis.nlu.Parser
import com.safarzod.jarvis.nlu.Text
import com.safarzod.jarvis.nlu.TimeParse
import com.safarzod.jarvis.nlu.VolumeAction
import com.safarzod.jarvis.voice.Clip
import com.safarzod.jarvis.voice.Ev
import com.safarzod.jarvis.voice.Sfx
import com.safarzod.jarvis.voice.SpeechEngine
import com.safarzod.jarvis.voice.VoiceBank
import com.safarzod.jarvis.voice.VoicePlayer
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import kotlin.random.Random

/**
 * Мозг Джарвиса: слушает, понимает, уточняет, выполняет и отвечает голосом.
 * Живёт всё время работы приложения; микрофон включает служба [com.safarzod.jarvis.service.JarvisService].
 */
class Engine(
    private val context: Context,
    val settings: Settings,
    val voice: VoiceBank,
    val player: VoicePlayer,
    val speech: SpeechEngine,
    val memory: Memory,
    val contacts: Contacts,
    val apps: Apps,
    val actions: Actions,
    val reminders: Reminders,
    val llm: LocalLlm,
) {
    /** Любая непредвиденная ошибка в диалоге не роняет приложение: пишем в лог и возвращаемся в ожидание. */
    private val crashGuard = CoroutineExceptionHandler { _, e ->
        Log.e("Engine", "unexpected", e)
        _ui.update { it.copy(phase = if (micOn) Phase.STANDBY else Phase.OFF, partial = "", notice = "Что-то пошло не так — попробуйте ещё раз") }
        if (micOn && settings.wakeWord.value) speech.listenWake() else speech.pause()
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate + crashGuard)

    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui
    private val _events = MutableSharedFlow<UiEvent>(extraBufferCapacity = 8)
    val events: SharedFlow<UiEvent> = _events

    /** Приложение на экране (из ProcessLifecycleOwner). */
    val appVisible = MutableStateFlow(false)
    /** Идёт телефонный разговор — микрофон отдаём звонку. */
    private var inCall = false
    @Volatile var ringing = false

    private var job: Job? = null
    private var pending: Pending? = null
    private var pendingAt = 0L
    /** Уточнение ещё ждёт голосового ответа (после тайм-аута — только нажатия на карточку). */
    private var pendingVoice = false
    /** Микрофон включён службой (между boot и shutdown). */
    @Volatile private var micOn = false
    private var micRestarts = 0
    private var micRestartWindow = 0L
    private var lastSaid: Pair<Ev, Card?>? = null
    private var lastClip: Clip? = null
    private var attached = false
    private var unknownStreak = 0

    // ------------------------------------------------------------------ жизненный цикл

    /** Подписаться на распознавание и уведомления. Вызывается один раз. */
    fun attach() {
        if (attached) return
        attached = true
        player.volume = settings.voiceVolume.value
        player.uiSounds = settings.uiSounds.value
        scope.launch { settings.voiceVolume.flow.collect { player.volume = it } }
        scope.launch { settings.uiSounds.flow.collect { player.uiSounds = it } }
        scope.launch { settings.sensitivity.flow.collect { speech.sensitivity = it } }
        scope.launch { speech.events.collect { onSpeech(it) } }
        scope.launch { speech.ready.collect { r -> _ui.update { it.copy(micReady = r) } } }
        scope.launch { MessageFeed.incoming.collect { onIncomingMessage(it) } }
        scope.launch {
            settings.wakeWord.flow.collect { on ->
                if (_ui.value.phase == Phase.STANDBY) { if (on) speech.listenWake() else speech.pause() }
            }
        }
    }

    /** Загрузить распознавание и запустить микрофон. [greet] — поприветствовать голосом. */
    suspend fun boot(greet: Boolean) {
        attach()
        if (_ui.value.phase == Phase.OFF) _ui.update { it.copy(phase = Phase.LOADING) }
        val ok = speech.load()
        if (!ok) { _ui.update { it.copy(phase = Phase.OFF, notice = "Распознавание речи недоступно") }; return }
        micOn = true
        speech.start()
        llm.warmUp()
        // приветствуем голосом один раз за утро/день/вечер/ночь, а не при каждом открытии приложения
        val greetEv = if (greet && settings.greetings.value) greetingEv(force = false).takeIf { it != Ev.WAKE } else null
        if (greetEv != null) {
            step {
                player.sfx(Sfx.BOOT, 0.55f)
                delay(1300)
                say(greetEv)
            }
        } else {
            standby()
        }
    }

    fun shutdown() {
        micOn = false
        job?.cancel()
        speech.stop()
        player.stop()
        _ui.update { it.copy(phase = Phase.OFF, partial = "", awaiting = false) }
    }

    /** Выполнить шаг диалога, отменив предыдущий (одновременно говорит только одна фраза). */
    private fun step(block: suspend () -> Unit) {
        job?.cancel()
        job = scope.launch { block() }
    }

    // ------------------------------------------------------------------ входы

    /** Кнопка микрофона / нажатие на ядро. */
    fun onMicTap() {
        when (_ui.value.phase) {
            Phase.SPEAKING -> step { delay(120); listen(followUp = true) }
            Phase.LISTENING, Phase.THINKING -> { job?.cancel(); speech.pause(); player.sfx(Sfx.END, 0.5f); standby() }
            Phase.OFF -> com.safarzod.jarvis.service.JarvisService.start(context)
            Phase.LOADING -> notice("Микрофон ещё загружается…")
            Phase.STANDBY -> if (micOn) step { listen(followUp = false) } else com.safarzod.jarvis.service.JarvisService.start(context)
        }
    }

    /** Команда, набранная с клавиатуры. */
    fun submitText(text: String) {
        if (text.isBlank()) return
        speech.pause()
        handle(text, typed = true)
    }

    fun onAction(a: UiAction) {
        step {
            when (a) {
                is UiAction.PickContact -> {
                    val p = pending as? Pending.Choose ?: return@step
                    p.matches.getOrNull(a.index)?.let { pick(p, it.contact) }
                }
                UiAction.SendDraft -> (pending as? Pending.SmsConfirm)?.let { pending = null; sendDraft(it.contact, it.text, it.via) }
                is UiAction.EditDraft -> (pending as? Pending.SmsConfirm)?.let { p ->
                    val t = a.text.trim()
                    if (t.isNotEmpty()) {
                        pending = p.copy(text = t)
                        _ui.update { it.copy(card = Card.SmsDraft(p.contact.name, p.contact.phone, t, p.via, false)) }
                    }
                }
                is UiAction.RemindAt -> (pending as? Pending.ReminderWhen)?.let { p ->
                    pending = null
                    createReminder(p.text, a.millis)
                }
                is UiAction.Search -> { pending = null; webSearch(a.query, Ev.WEB_SEARCH) }
                UiAction.Cancel -> { if (pending != null) { pending = null; say(Ev.CANCEL) } else dismiss() }
                UiAction.Dismiss -> dismiss()
            }
        }
    }

    private fun dismiss() {
        _ui.update { it.copy(card = null, reply = null, userText = null, awaiting = false) }
    }

    /** Прослушать запись (в библиотеке голоса). */
    fun preview(clip: Clip) {
        step { replay(clip, null) }
    }

    fun onCallState(active: Boolean) {
        inCall = active
        if (active) { player.stop(); speech.pause(); _ui.update { it.copy(phase = Phase.STANDBY, partial = "") } }
        else scope.launch { delay(800); standby() }
    }

    fun onReminder(text: String) {
        if (inCall) return
        // не перебиваем текущий разговор: подождём, пока Джарвис освободится
        scope.launch {
            while (_ui.value.phase == Phase.LISTENING || _ui.value.phase == Phase.THINKING || _ui.value.phase == Phase.SPEAKING) delay(500)
            step { say(Ev.REMINDER_FIRE, Card.Info("Напоминание", Text.sentence(text), CardIcon.REMINDER)) }
        }
    }

    private fun onIncomingMessage(m: IncomingMessage) {
        if (!settings.announceMessages.value || inCall || !micOn) return
        if (_ui.value.phase != Phase.STANDBY) return
        step { say(Ev.MSG_INCOMING, Card.Messages(listOf(m))) }
    }

    private fun onSpeech(e: SpeechEngine.Event) {
        when (e) {
            SpeechEngine.Event.Wake -> {
                if (inCall) return
                job?.cancel()
                player.stop()
                // новое обращение — новый разговор; брошенное уточнение больше не перехватывает команды
                pendingVoice = false
                player.sfx(Sfx.LISTEN, 0.7f)
                haptic(18)
                _ui.update { it.copy(phase = Phase.LISTENING, partial = "", awaiting = false) }
            }
            is SpeechEngine.Event.Partial -> {
                val p = stripWake(e.text)
                _ui.update { it.copy(partial = p, phase = Phase.LISTENING) }
            }
            is SpeechEngine.Event.Final -> handle(e.text, typed = false)
            SpeechEngine.Event.Timeout -> {
                _ui.update { it.copy(partial = "") }
                pendingVoice = false
                if (pending != null || _ui.value.awaiting) {
                    player.sfx(Sfx.END, 0.5f)
                    _ui.update { it.copy(awaiting = false) }
                }
                standby()
            }
            is SpeechEngine.Event.Failure -> {
                notice(e.message)
                restartMic()
            }
        }
    }

    // ------------------------------------------------------------------ обработка фразы

    /** Микрофон упал — пробуем поднять заново (не чаще 3 раз в минуту). */
    private fun restartMic() {
        if (!micOn) return
        val now = System.currentTimeMillis()
        if (now - micRestartWindow > 60_000) { micRestartWindow = now; micRestarts = 0 }
        if (micRestarts >= 3) {
            _ui.update { it.copy(phase = Phase.OFF, notice = "Микрофон недоступен. Нажмите на кнопку, чтобы попробовать снова") }
            micOn = false
            return
        }
        micRestarts++
        scope.launch {
            delay(1500)
            if (!micOn) return@launch
            speech.start()
            delay(300)
            if (speech.alive.value) standby() else _ui.update { it.copy(phase = Phase.OFF) }
        }
    }

    private fun handle(raw: String, typed: Boolean) {
        step {
            speech.pause()
            val clean = Parser.clean(raw)
            if (clean.isEmpty()) {
                // сказали только «Джарвис» — ответить и слушать дальше
                _ui.update { it.copy(partial = "") }
                say(greetingEv(force = false), followUp = true)
                return@step
            }
            val shown = Text.sentence(clean)
            History.add(Turn(shown, null))
            _ui.update { it.copy(phase = Phase.THINKING, partial = "", userText = shown, awaiting = false, notice = null) }
            settings.lastActiveAt.value = System.currentTimeMillis().toString()

            var cmd = Parser.parse(raw)
            if (pending != null && (!pendingVoice || System.currentTimeMillis() - pendingAt > 90_000)) pending = null
            pending?.let { p -> if (handlePending(p, cmd, clean)) return@step }

            if (cmd is Command.Unknown && llm.available) {
                _ui.update { it.copy(phase = Phase.THINKING) }
                val thinking = scope.launch { delay(1400); if (_ui.value.phase == Phase.THINKING) player.sfx(Sfx.TAP, 0.3f) }
                cmd = withContext(Dispatchers.Default) { llm.interpret(clean) } ?: cmd
                thinking.cancel()
            }
            execute(cmd, clean)
        }
    }

    private sealed interface Purpose {
        data object Call : Purpose
        data class Sms(val text: String?) : Purpose
        data class Messenger(val app: MessengerApp, val text: String?) : Purpose
        data object RememberOnly : Purpose
    }

    private sealed interface Pending {
        data object CallWho : Pending
        data class SmsWho(val purpose: Purpose) : Pending
        data class SmsText(val contact: Contact, val via: MessengerApp?) : Pending
        data class SmsConfirm(val contact: Contact, val text: String, val via: MessengerApp?) : Pending
        data class Choose(val query: String, val matches: List<ContactMatch>, val purpose: Purpose, val remember: Boolean) : Pending
        data class ConfirmCall(val contact: Contact) : Pending
        data class Learn(val alias: String, val purpose: Purpose, val attempts: Int) : Pending
        data object AlarmWhen : Pending
        data object TimerHowLong : Pending
        data class ReminderWhen(val text: String) : Pending
    }

    private fun setPending(p: Pending?) { pending = p; pendingAt = System.currentTimeMillis(); pendingVoice = p != null }

    /** Ответ на уточняющий вопрос. true — фраза обработана. */
    private suspend fun handlePending(p: Pending, cmd: Command, clean: String): Boolean {
        if (cmd == Command.Cancel || (cmd == Command.No && p !is Pending.Choose)) {
            setPending(null); say(Ev.CANCEL); return true
        }
        // явная новая команда отменяет уточнение
        val isNewCommand = cmd !is Command.Unknown && cmd !is Command.Yes && cmd !is Command.No &&
            cmd !is Command.Choose && cmd !is Command.WebSearch && cmd !is Command.OpenApp && cmd !is Command.Calculate &&
            cmd !is Command.Remember && cmd !is Command.Repeat
        // в коротких ответах (выбор, «да/нет», время) любая распознанная команда — это уже новая просьба
        val isStrong = cmd !is Command.Unknown && cmd !is Command.Yes && cmd !is Command.No &&
            cmd !is Command.Choose && cmd !is Command.Repeat
        when (p) {
            Pending.CallWho -> {
                if (isNewCommand) { setPending(null); return false }
                setPending(null); resolveContact(clean, Purpose.Call); return true
            }
            is Pending.SmsWho -> {
                if (isNewCommand) { setPending(null); return false }
                setPending(null); resolveContact(clean, p.purpose); return true
            }
            is Pending.SmsText -> {
                setPending(null); draft(p.contact, clean, p.via); return true
            }
            is Pending.SmsConfirm -> {
                when {
                    cmd == Command.Yes -> { setPending(null); sendDraft(p.contact, p.text, p.via) }
                    Regex("^(?:измени|исправь|поправь|переделай|перепиши|другой текст|по другому|изменить)").containsMatchIn(clean) -> {
                        setPending(Pending.SmsText(p.contact, p.via)); say(Ev.SMS_WHAT, followUp = true)
                    }
                    clean.split(' ').size >= 3 && cmd is Command.Unknown -> draft(p.contact, clean, p.via)
                    isStrong -> { setPending(null); return false }
                    else -> say(Ev.CONFIRM_ASK, keepCard = true, followUp = true)
                }
                return true
            }
            is Pending.Choose -> {
                val idx = when (cmd) {
                    is Command.Choose -> if (cmd.index == -1) p.matches.lastIndex else cmd.index - 1
                    Command.Yes -> 0
                    Command.No -> -2
                    else -> p.matches.indexOfFirst { Names.score(clean, it.contact.name) >= 0.8 }
                        .takeIf { it >= 0 } ?: p.matches.indexOfFirst { Text.normalize(it.contact.name).contains(clean) }
                }
                when {
                    idx == -2 -> { setPending(null); say(Ev.CANCEL) }
                    idx in p.matches.indices -> pick(p, p.matches[idx].contact)
                    isStrong -> { setPending(null); return false }
                    else -> say(Ev.CALL_CHOOSE, keepCard = true, followUp = true)
                }
                return true
            }
            is Pending.ConfirmCall -> {
                if (cmd == Command.Yes) { setPending(null); doCall(p.contact) }
                else if (isStrong) { setPending(null); return false }
                else say(Ev.CONFIRM_ASK, keepCard = true, followUp = true)
                return true
            }
            is Pending.Learn -> {
                if (isNewCommand && cmd !is Command.Call) { setPending(null); return false }
                val name = clean.replace(Regex("^(?:он |она |это |у меня |в контактах )*(?:записан\\S* |подписан\\S* |сохранен\\S* )?(?:как |под именем )?(?:контакт )?"), "").trim()
                learn(p.alias, name, p.purpose, p.attempts)
                return true
            }
            Pending.AlarmWhen -> {
                val d = Text.digitize(clean)
                val dur = if (d.contains("через")) TimeParse.duration(d) else null
                val clk = TimeParse.clock(if (Regex("^\\d").containsMatchIn(d)) "в $d" else d)
                setPending(null)
                when {
                    dur != null -> execute(Command.AlarmIn(dur), clean)
                    clk != null -> execute(Command.Alarm(TimeParse.hour24(clk), clk.minute, clk.dayOffset), clean)
                    isStrong -> return false
                    else -> say(Ev.NOT_UNDERSTOOD)
                }
                return true
            }
            Pending.TimerHowLong -> {
                val d = Text.digitize(clean)
                val dur = TimeParse.duration(d) ?: TimeParse.duration("на $d")
                setPending(null)
                if (dur != null) execute(Command.Timer(dur), clean)
                else if (isStrong) return false
                else say(Ev.NOT_UNDERSTOOD)
                return true
            }
            is Pending.ReminderWhen -> {
                val d = Text.digitize(clean)
                val dur = TimeParse.duration(d)
                val clk = if (dur == null) TimeParse.clock(if (Regex("^\\d").containsMatchIn(d)) "в $d" else d) else null
                when {
                    dur != null -> { setPending(null); createReminder(p.text, System.currentTimeMillis() + dur * 1000) }
                    clk != null -> { setPending(null); createReminder(p.text, TimeParse.nextMillis(clk)) }
                    isStrong -> { setPending(null); return false }
                    else -> say(Ev.REMINDER_WHEN, keepCard = true, followUp = true)
                }
                return true
            }
        }
    }

    // ------------------------------------------------------------------ выполнение

    private suspend fun execute(cmd: Command, clean: String) {
        if (cmd !is Command.Unknown) unknownStreak = 0
        when (cmd) {
            Command.Wake -> say(greetingEv(force = false), followUp = true)

            // --- связь ---
            is Command.Call -> if (cmd.who == null) { setPending(Pending.CallWho); say(Ev.CALL_WHO, followUp = true) } else resolveContact(cmd.who, Purpose.Call)
            is Command.CallNumber -> doCall(Contact(-1, formatPhone(cmd.digits), cmd.digits, null, false, 0))
            is Command.Sms -> when {
                cmd.who == null -> { setPending(Pending.SmsWho(Purpose.Sms(cmd.text))); say(Ev.SMS_WHO, followUp = true) }
                else -> resolveContact(cmd.who, Purpose.Sms(cmd.text))
            }
            is Command.Messenger -> when {
                cmd.who == null && cmd.text == null -> openMessengerApp(cmd.app)
                cmd.who == null -> { setPending(Pending.SmsWho(Purpose.Messenger(cmd.app, cmd.text))); say(Ev.SMS_WHO, followUp = true) }
                else -> resolveContact(cmd.who, Purpose.Messenger(cmd.app, cmd.text))
            }
            Command.AnswerCall -> outcome(actions.answerCall(), Ev.CALL_ANSWER, null, Need.CALLS)
            Command.RejectCall, Command.EndCall -> outcome(actions.endCall(), Ev.CALL_REJECT, null, Need.CALLS)
            Command.ReadMessages -> readMessages()

            // --- приложения и интернет ---
            is Command.OpenApp -> openApp(cmd.name)
            Command.GoHome -> { actions.home(); say(Ev.ACK) }
            Command.GoBack -> outcome(actions.back(), Ev.ACK, null, Need.ACCESSIBILITY)
            is Command.WebSearch -> webSearch(cmd.query, Ev.WEB_SEARCH)
            is Command.Weather -> webSearch("погода" + (cmd.place?.let { " в $it" } ?: ""), Ev.WEATHER, CardIcon.WEATHER, "Погода")
            is Command.YouTube -> {
                if (!actions.isOnline()) return say(Ev.NO_INTERNET, offline())
                outcome(actions.youtube(cmd.query), Ev.YOUTUBE, Card.Opened("YouTube", cmd.query?.let { "«$it»" }, CardIcon.YOUTUBE))
            }
            is Command.Movie -> webSearch("фильм ${cmd.title} смотреть", Ev.WEB_SEARCH, CardIcon.SEARCH, "Фильм «${cmd.title}»")
            is Command.Maps -> outcome(actions.maps(cmd.query, cmd.navigate), Ev.MAPS, Card.Opened(if (cmd.navigate) "Маршрут" else "Карты", cmd.query, CardIcon.MAP))
            Command.News -> webSearch("новости", Ev.WEB_SEARCH, CardIcon.SEARCH, "Новости")

            // --- телефон ---
            is Command.Music -> {
                if (cmd.action == MediaAction.PLAY) { say(Ev.MUSIC); actions.media(cmd.action) }
                else { actions.media(cmd.action); say(Ev.MUSIC) }
            }
            is Command.Volume -> {
                val r = actions.volume(cmd.action)
                val ev = when (cmd.action) { VolumeAction.UP, VolumeAction.MAX, VolumeAction.UNMUTE -> Ev.VOLUME_UP; VolumeAction.DOWN -> Ev.VOLUME_DOWN; else -> Ev.ACK }
                val pct = (actions.musicVolume() * 100).toInt()
                val card = when (cmd.action) {
                    VolumeAction.SILENT -> Card.Info("Беззвучный режим", "Звонки и уведомления — только вибрация", CardIcon.VOLUME)
                    else -> Card.Big("Громкость", "$pct%", null, CardIcon.VOLUME)
                }
                outcome(r, ev, card)
            }
            is Command.Flashlight -> outcome(actions.torch(cmd.on), if (cmd.on) Ev.FLASH_ON else Ev.FLASH_OFF, null)
            is Command.Panel -> outcome(actions.panel(cmd.kind), Ev.PANEL, null)
            Command.Camera -> outcome(actions.camera(false), Ev.CAMERA, null)
            Command.Selfie -> outcome(actions.camera(true), Ev.CAMERA, null)
            Command.Screenshot -> {
                val r = actions.screenshot()
                if (r == Outcome.OK) say(Ev.SCREENSHOT) else outcome(r, Ev.SCREENSHOT, null, Need.ACCESSIBILITY)
            }
            Command.LockScreen -> {
                if (com.safarzod.jarvis.service.JarvisAccessibilityService.instance == null) return outcome(Outcome.NO_PERMISSION, Ev.LOCK, null, Need.ACCESSIBILITY)
                say(Ev.LOCK); actions.lock()
            }

            // --- время ---
            is Command.Alarm -> outcome(actions.alarm(cmd.hour, cmd.minute), Ev.ALARM_SET, Card.AlarmSet(cmd.hour, cmd.minute, cmd.dayOffset))
            is Command.AlarmIn -> {
                val c = Calendar.getInstance().apply { add(Calendar.SECOND, cmd.seconds.toInt()) }
                val h = c.get(Calendar.HOUR_OF_DAY); val m = c.get(Calendar.MINUTE)
                outcome(actions.alarm(h, m), Ev.ALARM_SET, Card.AlarmSet(h, m, 0))
            }
            Command.AlarmMissingTime -> { setPending(Pending.AlarmWhen); say(Ev.ALARM_WHEN, followUp = true) }
            is Command.Timer -> {
                val r = actions.timer(cmd.seconds)
                val card = Card.TimerSet(cmd.seconds, System.currentTimeMillis() + cmd.seconds * 1000)
                if (r == Outcome.NOT_FOUND) { reminders.add("Таймер: время вышло", card.endsAt); say(Ev.TIMER_SET, card) }
                else outcome(r, Ev.TIMER_SET, card)
            }
            Command.TimerMissingTime -> { setPending(Pending.TimerHowLong); say(Ev.TIMER_HOW_LONG, followUp = true) }
            is Command.Reminder -> {
                val text = cmd.text.ifBlank { "Напоминание" }
                when {
                    cmd.inSeconds != null -> createReminder(text, System.currentTimeMillis() + cmd.inSeconds * 1000)
                    cmd.atMillis != null -> createReminder(text, cmd.atMillis)
                    else -> { setPending(Pending.ReminderWhen(text)); say(Ev.REMINDER_WHEN, Card.ReminderPickTime(text), followUp = true) }
                }
            }
            Command.ShowTime -> {
                val now = Calendar.getInstance()
                say(Ev.SHOW, Card.Big("Время", fmt("HH:mm", now), fmt("EEEE, d MMMM", now).replaceFirstChar { it.uppercase() }, CardIcon.CLOCK))
            }
            Command.ShowDate -> {
                val now = Calendar.getInstance()
                say(Ev.SHOW, Card.Big("Сегодня", fmt("d MMMM", now), fmt("EEEE", now).replaceFirstChar { it.uppercase() } + " · ${now.get(Calendar.WEEK_OF_YEAR)}-я неделя · ${now.get(Calendar.YEAR)}", CardIcon.CALENDAR))
            }
            Command.ShowBattery -> {
                val b = actions.battery()
                val sub = listOfNotNull(if (b.charging) "Заряжается" else "От батареи", b.temperatureC?.let { "%.0f °C".format(it) }).joinToString(" · ")
                say(Ev.SHOW, Card.Big("Заряд", "${b.percent}%", sub, CardIcon.BATTERY))
            }
            is Command.Calculate -> say(Ev.SHOW, Card.Big("Ответ", Calc.format(cmd.result), cmd.expression + " =", CardIcon.CALC))

            // --- память ---
            is Command.Remember -> remember(cmd.alias, cmd.target)
            is Command.Forget -> {
                val a = memory.remove(cmd.alias)
                if (a != null) say(Ev.MEMORY_FORGOT, Card.Info("Забыто", "«${a.alias}» → ${a.title}", CardIcon.MEMORY))
                else say(Ev.MEMORY_UNKNOWN)
            }
            Command.ShowMemory -> {
                _events.tryEmit(UiEvent.Open("memory"))
                val items = memory.items.value
                say(Ev.SHOW, Card.Info("Память", if (items.isEmpty()) "Пока пусто. Скажите, например: «Мама — это контакт Mom»." else items.take(6).joinToString("\n") { "«${it.alias}» → ${it.title}" }, CardIcon.MEMORY))
            }

            // --- разговор ---
            Command.Hello -> say(greetingEv(force = true))
            Command.Thanks -> say(Ev.THANKS_REPLY)
            Command.Praise -> say(Ev.PRAISE_REPLY)
            Command.Insult -> say(Ev.INSULT_REPLY)
            Command.HowAreYou -> say(Ev.HOW_ARE_YOU)
            Command.WhoAreYou -> say(Ev.WHO_ARE_YOU)
            Command.Help -> say(Ev.HELP, Card.Help)
            Command.Joke -> say(Ev.JOKE, Card.Info("Шутка", jokes.random(), CardIcon.INFO))
            Command.Bye -> say(Ev.BYE)
            Command.GoodNight -> say(Ev.GOODNIGHT)
            Command.Cancel -> say(Ev.CANCEL)
            Command.Yes -> say(Ev.YES)
            Command.No, is Command.Choose -> say(Ev.ACK)
            Command.Repeat -> lastSaid?.let { (ev, card) -> lastClip?.let { replay(it, card) } ?: say(ev, card) } ?: say(Ev.NOT_UNDERSTOOD)
            Command.StopListening -> say(Ev.BYE)
            is Command.Unknown -> {
                unknownStreak++
                val words = clean.split(' ').size
                if (words >= 3) {
                    say(Ev.FREE_TALK_REFUSE, Card.Offer("Поискать в интернете?", "«${Text.sentence(clean)}»", "Найти", clean))
                } else {
                    say(Ev.NOT_UNDERSTOOD, followUp = unknownStreak < 2)
                }
            }
        }
    }

    // ------------------------------------------------------------------ контакты

    private suspend fun resolveContact(query: String, purpose: Purpose) {
        if (!contacts.hasPermission()) return need(Need.CONTACTS)
        val matches = withContext(Dispatchers.IO) { contacts.find(query) }
        val top = matches.firstOrNull()
        when {
            top == null -> {
                setPending(Pending.Learn(query, purpose, 0))
                say(Ev.CALL_NOT_FOUND, Card.Info("Контакт не найден", "«${Text.sentence(query).dropLast(1)}» нет в контактах. Скажите, как он записан — например: «Mom».", CardIcon.PHONE), followUp = true)
            }
            top.viaMemory -> { memory.find(query, AliasKind.CONTACT)?.let { memory.touch(it) }; proceed(top.contact, purpose) }
            top.score >= 0.93 && (matches.size == 1 || matches[1].score < top.score - 0.1) -> proceed(top.contact, purpose)
            else -> {
                setPending(Pending.Choose(query, matches, purpose, remember = true))
                say(Ev.CALL_CHOOSE, Card.ContactChoice(query, matches), followUp = true)
            }
        }
    }

    private suspend fun pick(p: Pending.Choose, c: Contact) {
        setPending(null)
        if (p.remember && Names.lemmas(Text.normalize(p.query).split(' ').first()).first() != Text.normalize(c.name)) {
            memory.put(p.query, AliasKind.CONTACT, c.name, c.phone)
        }
        if (p.purpose == Purpose.RememberOnly) {
            val a = memory.find(p.query, AliasKind.CONTACT) ?: memory.put(p.query, AliasKind.CONTACT, c.name, c.phone)
            say(Ev.MEMORY_SAVED, Card.Remembered(a))
        } else proceed(c, p.purpose)
    }

    private suspend fun learn(alias: String, name: String, purpose: Purpose, attempts: Int) {
        val matches = withContext(Dispatchers.IO) { contacts.findByName(name) }
        val top = matches.firstOrNull()
        when {
            top == null -> {
                if (attempts >= 1) { setPending(null); say(Ev.NOT_UNDERSTOOD, Card.Info("Не нашёл", "«$name» тоже нет в контактах. Добавить связь можно вручную в разделе «Память».", CardIcon.MEMORY)) }
                else { setPending(Pending.Learn(alias, purpose, attempts + 1)); say(Ev.NOT_UNDERSTOOD, followUp = true) }
            }
            top.score >= 0.9 && (matches.size == 1 || matches[1].score < top.score - 0.08) -> {
                setPending(null)
                val a = memory.put(alias, AliasKind.CONTACT, top.contact.name, top.contact.phone)
                if (purpose == Purpose.RememberOnly) say(Ev.MEMORY_SAVED, Card.Remembered(a))
                else { notice("Запомнил: «${a.alias}» → ${a.title}"); proceed(top.contact, purpose) }
            }
            else -> {
                setPending(Pending.Choose(alias, matches, purpose, remember = true))
                say(Ev.CALL_CHOOSE, Card.ContactChoice(alias, matches), followUp = true)
            }
        }
    }

    private suspend fun remember(alias: String, target: String) {
        // сначала приложение: «телега — это телеграм»
        val app = withContext(Dispatchers.IO) { apps.find(target) }
        val contactMatches = if (contacts.hasPermission()) withContext(Dispatchers.IO) { contacts.findByName(target) } else emptyList()
        val top = contactMatches.firstOrNull()
        if (app != null && (top == null || top.score < 0.9)) {
            val a = memory.put(alias, AliasKind.APP, app.label, app.pkg)
            return say(Ev.MEMORY_SAVED, Card.Remembered(a))
        }
        if (!contacts.hasPermission()) return need(Need.CONTACTS)
        when {
            top == null -> {
                setPending(Pending.Learn(alias, Purpose.RememberOnly, 0))
                say(Ev.CALL_NOT_FOUND, followUp = true)
            }
            top.score >= 0.9 && (contactMatches.size == 1 || contactMatches[1].score < top.score - 0.08) -> {
                val a = memory.put(alias, AliasKind.CONTACT, top.contact.name, top.contact.phone)
                say(Ev.MEMORY_SAVED, Card.Remembered(a))
            }
            else -> {
                setPending(Pending.Choose(alias, contactMatches, Purpose.RememberOnly, remember = true))
                say(Ev.CALL_CHOOSE, Card.ContactChoice(alias, contactMatches), followUp = true)
            }
        }
    }

    private suspend fun proceed(c: Contact, purpose: Purpose) {
        when (purpose) {
            Purpose.Call -> if (settings.confirmCalls.value) {
                setPending(Pending.ConfirmCall(c))
                say(Ev.CONFIRM_ASK, Card.Calling(c.name, c.phone, c.phoneLabel), followUp = true)
            } else doCall(c)
            is Purpose.Sms -> if (purpose.text.isNullOrBlank()) {
                setPending(Pending.SmsText(c, null))
                say(Ev.SMS_WHAT, Card.Info("Сообщение", "Кому: ${c.name}\nДиктуйте текст…", CardIcon.MESSAGE), followUp = true)
            } else draft(c, purpose.text, null)
            is Purpose.Messenger -> if (purpose.text.isNullOrBlank()) {
                outcome(actions.openMessenger(purpose.app, c.phone, null), Ev.APP_OPEN, Card.Opened(purpose.app.title, c.name, CardIcon.MESSAGE))
            } else draft(c, purpose.text, purpose.app)
            Purpose.RememberOnly -> Unit
        }
    }

    private suspend fun doCall(c: Contact) {
        if (inCall) return say(Ev.CANT_DO)
        val r = actions.call(c.phone)
        outcome(r, Ev.CALL_START, Card.Calling(c.name, c.phone, c.phoneLabel), Need.CALLS)
    }

    private suspend fun draft(c: Contact, raw: String, via: MessengerApp?) {
        _ui.update { it.copy(phase = Phase.THINKING) }
        val polished = withContext(Dispatchers.Default) { llm.polish(raw, c.name) }
        val text = polished ?: Text.sentence(raw)
        if (settings.confirmSms.value || via != null) {
            setPending(Pending.SmsConfirm(c, text, via))
            say(Ev.SMS_CHECK, Card.SmsDraft(c.name, c.phone, text, via, polished != null), followUp = true)
        } else sendDraft(c, text, via)
    }

    private suspend fun sendDraft(c: Contact, text: String, via: MessengerApp?) {
        if (via != null) {
            return outcome(actions.openMessenger(via, c.phone, text), Ev.APP_OPEN, Card.Opened(via.title, "${c.name}: «$text» — нажмите «Отправить»", CardIcon.MESSAGE))
        }
        _ui.update { it.copy(phase = Phase.THINKING) }
        val r = actions.sendSms(c.phone, text)
        if (r == Outcome.FAILED) {
            return say(Ev.ERROR, Card.Info("Не отправлено", "Нет сети или не выбрана SIM-карта для SMS. Текст: «$text»", CardIcon.ERROR))
        }
        outcome(r, Ev.SMS_SENT, Card.Info("Отправлено", "${c.name}\n«$text»", CardIcon.MESSAGE), Need.SMS)
    }

    // ------------------------------------------------------------------ прочее

    private suspend fun openApp(name: String) {
        val app = withContext(Dispatchers.IO) { apps.find(name) }
        if (app == null) {
            return say(Ev.APP_NOT_FOUND, Card.Offer("Нет приложения", "«${Text.sentence(name).dropLast(1)}» не найдено на телефоне.", "Найти в магазине", "market:$name"))
        }
        memory.find(name, AliasKind.APP)?.let { memory.touch(it) }
        val intent = apps.launchIntent(app) ?: return say(Ev.APP_NOT_FOUND)
        outcome(actions.open(intent), Ev.APP_OPEN, Card.Opened(app.label, null, CardIcon.APP))
    }

    private suspend fun openMessengerApp(app: MessengerApp) {
        outcome(actions.openMessenger(app, null, null), Ev.APP_OPEN, Card.Opened(app.title, null, CardIcon.MESSAGE))
    }

    private suspend fun webSearch(query: String, ev: Ev, icon: CardIcon = CardIcon.SEARCH, title: String = "Поиск") {
        if (query.startsWith("market:")) {
            val q = query.removePrefix("market:")
            val r = actions.openUrl("market://search?q=" + java.net.URLEncoder.encode(q, "UTF-8"))
            return if (r == Outcome.OK || r == Outcome.BLOCKED) outcome(r, Ev.APP_OPEN, Card.Opened("Магазин приложений", q, CardIcon.APP))
            else webSearch("$q приложение", ev)
        }
        if (!actions.isOnline()) return say(Ev.NO_INTERNET, offline())
        val r = actions.search(settings.searchEngine.value.url, query)
        outcome(r, ev, Card.Opened(title, "«${Text.sentence(query).dropLast(1)}»", icon))
    }

    private suspend fun readMessages() {
        if (!MessageFeed.listenerConnected) return need(Need.LISTENER)
        val items = MessageFeed.items.value
        if (items.isEmpty()) say(Ev.MSG_NONE, Card.Info("Сообщения", "Новых сообщений нет", CardIcon.MESSAGE))
        else say(Ev.SHOW, Card.Messages(items.take(5)))
    }

    private suspend fun createReminder(text: String, at: Long) {
        val r = reminders.add(Text.sentence(text).dropLastWhile { it == '.' }, at)
        say(Ev.REMINDER_SET, Card.ReminderSet(r.text, r.at))
    }

    /** Общая обработка результата действия: успех → фраза, иначе — понятное объяснение. */
    private suspend fun outcome(r: Outcome, ok: Ev, card: Card?, needIfDenied: Need? = null) {
        when (r) {
            Outcome.OK -> say(ok, card)
            Outcome.BLOCKED -> say(Ev.PERMISSIONS_MISSING, Card.Permission(
                "Нажмите на уведомление",
                "Android не даёт открывать окна из фона. Разрешите Джарвису «Поверх других приложений» — и всё будет открываться сразу.",
                Need.OVERLAY,
            ))
            Outcome.NO_PERMISSION -> need(needIfDenied ?: Need.CALLS)
            Outcome.NOT_FOUND -> say(Ev.APP_NOT_FOUND)
            Outcome.NO_INTERNET -> say(Ev.NO_INTERNET, offline())
            Outcome.UNSUPPORTED -> say(Ev.CANT_DO)
            Outcome.FAILED -> say(Ev.ERROR)
        }
    }

    private suspend fun need(n: Need) {
        val (title, body) = when (n) {
            Need.CONTACTS -> "Доступ к контактам" to "Чтобы звонить и писать по имени, Джарвису нужен доступ к контактам."
            Need.CALLS -> "Звонки" to "Разрешите Джарвису совершать звонки и управлять ими."
            Need.SMS -> "Отправка SMS" to "Разрешите Джарвису отправлять SMS — он делает это только после вашего «да»."
            Need.MIC -> "Микрофон" to "Без микрофона Джарвис вас не услышит."
            Need.NOTIFICATIONS -> "Уведомления" to "Нужны для работы в фоне и напоминаний."
            Need.OVERLAY -> "Открытие из фона" to "Разрешите «Поверх других приложений», чтобы Джарвис открывал приложения, когда экран выключен или вы в другом приложении."
            Need.ACCESSIBILITY -> "Спец. возможности" to "Для скриншотов, блокировки экрана и кнопок «Назад/Домой» включите службу Джарвиса в «Специальных возможностях»."
            Need.LISTENER -> "Доступ к уведомлениям" to "Чтобы читать входящие сообщения, разрешите Джарвису доступ к уведомлениям."
            Need.EXACT_ALARMS -> "Точные напоминания" to "Разрешите будильники и напоминания, чтобы Джарвис напоминал минута в минуту."
        }
        say(Ev.NEED_PERMISSION, Card.Permission(title, body, n))
        _events.tryEmit(UiEvent.RequestNeed(n))
    }

    private fun offline() = Card.Info("Нет интернета", "Поиск, погода и YouTube работают только онлайн. Всё остальное — без сети.", CardIcon.ERROR)

    // ------------------------------------------------------------------ голос

    /**
     * Сказать фразу: запись из банка (если есть) или текст + звук интерфейса.
     * [followUp] — после ответа сразу слушать (без «Джарвис»).
     */
    private suspend fun say(ev: Ev, card: Card? = null, followUp: Boolean = false, keepCard: Boolean = false) {
        if (inCall) return
        speech.pause()
        val clip = voice.pick(ev)
        val text = clip?.text ?: ev.text
        lastSaid = ev to card
        lastClip = clip
        History.add(Turn(null, text))
        _ui.update {
            it.copy(
                phase = Phase.SPEAKING, reply = text, partial = "",
                card = if (keepCard) it.card else card,
                awaiting = followUp,
            )
        }
        if (clip != null) {
            if (ev.sfx == Sfx.SUCCESS) player.sfx(Sfx.SUCCESS, 0.35f)
            player.play(clip)
        } else {
            player.sfx(if (ev.sfx == Sfx.NONE) Sfx.NOTIFY else ev.sfx, 0.6f)
            delay(650)
        }
        if (followUp) listen(followUp = true) else standby()
    }

    private suspend fun replay(clip: Clip, card: Card?) {
        speech.pause()
        _ui.update { it.copy(phase = Phase.SPEAKING, reply = clip.text, card = card ?: it.card) }
        player.play(clip)
        standby()
    }

    private suspend fun listen(followUp: Boolean) {
        if (inCall) return
        if (!micOn) { _ui.update { it.copy(phase = Phase.OFF, awaiting = false) }; return }
        player.sfx(Sfx.LISTEN, 0.6f)
        haptic(12)
        _ui.update { it.copy(phase = Phase.LISTENING, partial = "", awaiting = followUp) }
        speech.listenCommand(timeoutMs = if (followUp) 7000 else 8000, skipFirstMs = 300)
    }

    private fun standby() {
        if (!micOn) { _ui.update { it.copy(phase = Phase.OFF, partial = "", awaiting = false) }; return }
        _ui.update { it.copy(phase = Phase.STANDBY, partial = "", awaiting = false) }
        if (inCall) { speech.pause(); return }
        if (settings.wakeWord.value) speech.listenWake() else speech.pause()
    }

    private fun notice(text: String) {
        _ui.update { it.copy(notice = text) }
        scope.launch { delay(4000); _ui.update { if (it.notice == text) it.copy(notice = null) else it } }
    }

    /** Приветствие по времени суток (один раз за период) или обычное «Слушаю, сэр». */
    private fun greetingEv(force: Boolean): Ev {
        val now = Calendar.getInstance()
        val h = now.get(Calendar.HOUR_OF_DAY)
        val period = when (h) { in 5..11 -> "m"; in 12..17 -> "d"; in 18..22 -> "e"; else -> "n" }
        val key = fmt("yyyyMMdd", now) + period
        val last = settings.lastActiveAt.value.toLongOrNull() ?: 0L
        val idleHours = (System.currentTimeMillis() - last) / 3_600_000
        if (force || settings.lastGreetingDay.value != key) {
            settings.lastGreetingDay.value = key
            if (!force && idleHours >= 6 && Random.nextBoolean() && voice.clipsFor("welcome_back").isNotEmpty()) return Ev.WELCOME_BACK
            return when (period) { "m" -> Ev.GREET_MORNING; "d" -> Ev.GREET_DAY; "e" -> Ev.GREET_EVENING; else -> Ev.GREET_NIGHT }
        }
        return Ev.WAKE
    }

    private fun stripWake(s: String): String {
        var t = s.trim()
        for (w in Parser.wakeWords) if (t.startsWith("$w ") || t == w) t = t.removePrefix(w).trim()
        return t
    }

    private fun haptic(ms: Long) {
        if (!settings.haptics.value) return
        runCatching {
            val v = if (Build.VERSION.SDK_INT >= 31) (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            else @Suppress("DEPRECATION") (context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator)
            v.vibrate(VibrationEffect.createOneShot(ms, 60))
        }
    }

    private fun fmt(p: String, c: Calendar) = SimpleDateFormat(p, Locale.forLanguageTag("ru")).format(c.time)

    private fun formatPhone(d: String): String {
        val x = d.filter { it.isDigit() }
        return if (x.length == 11) "+7 ${x.substring(1, 4)} ${x.substring(4, 7)}-${x.substring(7, 9)}-${x.substring(9)}" else d
    }

    private val jokes = listOf(
        "Сэр, я бы рассказал шутку про UDP, но не уверен, что она до вас дойдёт.",
        "Сэр, я пытался придумать шутку про батарею, но она меня разрядила.",
        "Сэр, мои шутки как обновления: никто их не ждёт, но они всё равно приходят.",
        "Сэр, оптимист видит стакан наполовину полным. Пессимист — наполовину пустым. Инженер видит, что стакан в два раза больше, чем нужно.",
        "Сэр, программист ставит у кровати два стакана: с водой — если захочет пить, и пустой — если не захочет.",
        "Сэр, я не ленивый. Я в режиме энергосбережения.",
    )
}
