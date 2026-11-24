---
name: unity-build-test
description: Compile, build, run and screenshot this Unity game headless in the cloud container (Linux player and Android APK). Use whenever a change must be verified.
---
# Build and test commands (project /home/user/safarzod)

U="/opt/unity/6000.3.29f1/Editor/Unity -batchmode -nographics -projectPath /home/user/safarzod"

- Compile only: `$U -quit -logFile /opt/unity-dl/compile.log` then `grep "error CS" /opt/unity-dl/compile.log`.
- Linux build (Town scene): `$U -executeMethod Build.LinuxTown -logFile /opt/unity-dl/build.log` -> Builds/linux_town/town.x86_64 (~8 min).
- Headless bot match (logic test, prints REPORT and BOTS lines every 5 s):
  `timeout 240 Builds/linux_town/town.x86_64 -batchmode -nographics -autohost -logFile /opt/unity-dl/match.log`
- Match with screenshots every 5 s: `xvfb-run -a -s "-screen 0 960x540x24" Builds/linux_town/town.x86_64 -screen-fullscreen 0 -screen-width 960 -screen-height 540 -force-glcore -autohost -shots <dir> -logFile <log>`
- Level screenshots from fixed viewpoints: `-townshots <dir> [-townviews views.json] [-towntweak scale=1]` on the Linux player, or in the editor: `xvfb-run -a ... Unity -batchmode -force-glcore -quit -projectPath ... -executeMethod TownSetup.Preview -townshots <dir>`.
- Character proof sheets: `xvfb-run -a -s "-screen 0 1280x720x24" Unity -batchmode -force-glcore -quit -projectPath ... -executeMethod CharLab.SheetFp|SheetStates|SheetHold -labout <dir>`.
- Android APK: `$U -executeMethod Build.AndroidTown -logFile /opt/unity-dl/android.log` -> Builds/android/town.apk (~10-20 min). If Gradle fails on SSL: import /root/.ccr/agent-proxy-ca.crt into AndroidPlayer/OpenJDK/lib/security/cacerts (storepass changeit) and set systemProp.https.proxyHost/Port in ~/.gradle/gradle.properties.
- After builds: delete Library/Bee/Android/Prj/IL2CPP/Gradle/*/build, Library/PlayerDataCache and *DoNotShip* folders to keep disk free.
