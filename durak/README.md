# Дурак

Карточная игра для Android: подкидной и переводной дурак, боты и игра с друзьями
по Wi‑Fi **без интернета**. Есть режим «шулер»: неправильный ход проходит, но если
его заметят — «НАЁБ!» — карта возвращается. Победителям — «Гап нест!», дураку — «Чумо».

Отдельный проект Godot **4.7.2** внутри репозитория (не связан с DUSHANBE).

## Как играть

* **С ботами** — от 1 до 5 соперников, три уровня сложности.
* **По Wi‑Fi** — один нажимает «Создать комнату», остальные видят её в списке
  «Комнаты рядом» (или вводят IP хоста). Нужна общая Wi‑Fi сеть или точка доступа
  с телефона хоста; интернет не нужен. Пустые места можно занять ботами. Если
  кто-то отключился, за него доигрывает бот, а при возвращении место отдаётся ему.
* **Управление** — коснуться карты = выбрать, ещё раз = сыграть; или перетащить
  на стол / на карту, которую бьёшь. Коснуться карты на столе → «НАЁБ?».

## Правила (кратко)

36 карт, по 6 каждому, нижняя карта колоды — козырь. Первым ходит младший козырь.
Подкидывать можно достоинства, уже лежащие на столе: в первом отбое до 5 карт,
потом до 6 и не больше, чем карт у отбивающегося. Переводной: пока ничего не
побито, картой того же достоинства атака переводится на следующего. Добор до 6:
ходивший первым, отбивавшийся последним. Шулерство: ловить можно, пока карты на
столе (перед «Бито» есть пауза); ложное обвинение — до конца кона ловить нельзя.

## Устройство

```
scripts/rules/   cards.gd, durak_game.gd — правила без графики и сети
scripts/ai/      durak_bot.gd — бот (3 уровня, жульничает и ловит)
scripts/core/    session.gd — партия, боты, сеть ENet + поиск комнат по UDP;
                 profile.gd — имя, фото; sfx.gd — звуки, синтезированные кодом
scripts/ui/      main.gd (экраны), table_screen.gd (стол и анимации), card_view.gd,
                 suit_morph.gd (анимация мастей), result_overlay.gd, ui.gd (стиль)
tests/           test_rules.gd, net_test, ui_test, screenshots
```

Хост проверяет каждый ход; клиенты получают только свои карты (без отметок,
где был обман). Порты: 47420 (игра, UDP/ENet), 47421 (поиск комнат, broadcast).

## Тесты

```bash
cd durak
godot --headless --import
godot --headless -s res://tests/test_rules.gd            # правила + 600 партий ботов
godot --headless res://tests/ui_test.tscn                 # касания как у игрока
godot --headless res://tests/net_test.tscn -- host &      # сеть: хост
godot --headless res://tests/net_test.tscn -- client      #       клиент
xvfb-run godot --rendering-method gl_compatibility --resolution 720x1520 \
  res://tests/screenshots.tscn -- /tmp/shots               # скриншоты экранов
```

## Сборка APK

Нужны шаблоны экспорта 4.7.2, JDK, `apksigner`/`zipalign` (пути — в настройках
редактора Godot, см. `../tools/android/configure_godot_android.sh`). Ключ подписи
в репозиторий не кладётся; передаётся переменными окружения:

```bash
export GODOT_ANDROID_KEYSTORE_RELEASE_PATH=~/.android/durak-release.keystore
export GODOT_ANDROID_KEYSTORE_RELEASE_USER=durak
export GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD=...
godot --headless --export-release "Android" ../builds/android/durak.apk
```

APK: arm64‑v8a + armeabi‑v7a, пакет `tj.durak.game`. Обновление поверх старой
версии возможно только с тем же ключом подписи.

Шрифты: Unbounded, Manrope (SIL OFL, файлы лицензий в `assets/fonts`).
