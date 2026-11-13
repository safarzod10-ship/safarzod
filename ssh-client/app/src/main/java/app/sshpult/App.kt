package app.sshpult

import android.app.Application
import app.sshpult.data.AppRepository
import app.sshpult.data.KeystoreCipher
import app.sshpult.data.SecretCipher
import app.sshpult.ssh.SessionManager
import app.sshpult.ssh.SshConnector
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.io.File

/** App-wide singletons. Created once per process; screens reach them through LocalApp. */
class AppContainer(
    val repository: AppRepository,
    val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
) {
    val sessions = SessionManager(repository, scope)
}

open class App : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        SshConnector.useBundledCrypto()
        container = AppContainer(AppRepository(File(filesDir, "data.json"), createCipher()))
        // While any session is open, a foreground service keeps the connections alive in the background.
        container.scope.launch {
            container.sessions.connectedIds.collect { ids ->
                val names = ids.mapNotNull { container.repository.connection(it)?.title }
                SessionService.sync(this@App, names)
            }
        }
    }

    /** Overridden in tests, where the Android Keystore does not exist. */
    protected open fun createCipher(): SecretCipher = KeystoreCipher()
}
