package app.sshpult

import app.sshpult.data.AppRepository
import app.sshpult.data.AuthType
import app.sshpult.data.ConnectionProfile
import app.sshpult.data.Script
import app.sshpult.data.SecretCipher
import app.sshpult.ssh.SeenHostKey
import app.sshpult.ssh.SshError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

/** Stand-in for the Android Keystore: reversible, and obviously different from the plain text. */
class FakeCipher : SecretCipher {
    var broken = false
    override fun encrypt(plain: String) = "enc:" + plain.reversed()
    override fun decrypt(encrypted: String): String? =
        if (broken || !encrypted.startsWith("enc:")) null else encrypted.removePrefix("enc:").reversed()
}

class RepositoryTest {
    @get:Rule val tmp = TemporaryFolder()
    private val cipher = FakeCipher()
    private fun file() = File(tmp.root, "data.json")
    private fun repo() = AppRepository(file(), cipher)

    private fun profile(repo: AppRepository, auth: AuthType = AuthType.PASSWORD, keyId: String? = null) =
        ConnectionProfile(repo.newId(), "Prod", "example.com", 2222, "root", auth, keyId = keyId)

    @Test fun firstRunHasASampleScript() {
        val r = repo()
        assertEquals(1, r.data.value.scripts.size)
        assertTrue(r.data.value.connections.isEmpty())
    }

    @Test fun everythingSurvivesARestartAndSecretsAreNotStoredInClear() {
        val r = repo()
        val key = r.addKey("laptop", "ssh-ed25519", "ssh-ed25519 AAAA laptop", "SHA256:x", "PRIVATE-KEY-MATERIAL", "key-passphrase")
        val byPassword = profile(r)
        val byKey = profile(r, AuthType.KEY, key.id)
        r.saveConnection(byPassword, "hunter2-secret")
        r.saveConnection(byKey, null)
        r.saveScript(Script(r.newId(), "Deploy", "git pull\nmake"))
        r.trust(SeenHostKey("[example.com]:2222", "ssh-ed25519", "QUJD"))
        r.flush()

        val onDisk = file().readText()
        for (secret in listOf("hunter2-secret", "PRIVATE-KEY-MATERIAL", "key-passphrase")) {
            assertFalse("$secret leaked to disk", onDisk.contains(secret))
        }

        val again = repo()
        assertEquals(r.data.value, again.data.value)
        val t1 = again.targetFor(again.connection(byPassword.id)!!)
        assertEquals("hunter2-secret", t1.password)
        assertEquals(2222, t1.port)
        val t2 = again.targetFor(again.connection(byKey.id)!!)
        assertEquals("PRIVATE-KEY-MATERIAL", t2.privateKey)
        assertEquals("key-passphrase", t2.passphrase)
        assertNull(t2.password)
        assertEquals(1, again.knownKeys("[example.com]:2222").size)
        assertTrue(again.knownKeys("example.com").isEmpty())
    }

    @Test fun passwordRulesOnSave() {
        val r = repo()
        val p = profile(r)
        r.saveConnection(p, "")                              // nothing stored -> must ask
        assertThrows(SshError.PasswordRequired::class.java) { r.targetFor(r.connection(p.id)!!) }
        assertEquals("typed", r.targetFor(r.connection(p.id)!!, "typed").password)

        r.saveConnection(p, "first")
        r.saveConnection(p.copy(name = "Renamed"), null)     // null keeps the stored password
        assertEquals("first", r.targetFor(r.connection(p.id)!!).password)
        assertEquals("Renamed", r.connection(p.id)!!.name)

        r.saveConnection(p, "")                              // empty clears it
        assertNull(r.connection(p.id)!!.passwordEnc)

        r.saveConnection(p, "pw")
        r.saveConnection(p.copy(authType = AuthType.KEY, keyId = "k"), null) // switching to key drops the password
        assertNull(r.connection(p.id)!!.passwordEnc)
    }

    @Test fun lostKeystoreKeyMeansAskAgainNotCrash() {
        val r = repo()
        val p = profile(r)
        r.saveConnection(p, "pw")
        cipher.broken = true
        assertThrows(SshError.PasswordRequired::class.java) { r.targetFor(r.connection(p.id)!!) }
    }

    @Test fun deletedKeyGivesAClearError() {
        val r = repo()
        val key = r.addKey("k", "ssh-rsa", "ssh-rsa AAAA", "SHA256:x", "PRIV", null)
        val p = profile(r, AuthType.KEY, key.id)
        r.saveConnection(p, null)
        assertEquals(listOf(p.id), r.connectionsUsingKey(key.id).map { it.id })
        r.deleteKey(key.id)
        assertThrows(SshError.BadPrivateKey::class.java) { r.targetFor(r.connection(p.id)!!) }
    }

    @Test fun trustReplacesKeyOfSameTypeOnly() {
        val r = repo()
        r.trust(SeenHostKey("h", "ssh-ed25519", "AAA"))
        r.trust(SeenHostKey("h", "ssh-rsa", "BBB"))
        r.trust(SeenHostKey("h", "ssh-ed25519", "CCC"))
        assertEquals(setOf("CCC", "BBB"), r.knownKeys("h").map { it.keyBase64 }.toSet())
    }

    @Test fun corruptFileIsKeptAsideAndAppStartsEmpty() {
        file().writeText("{ this is not json")
        val r = repo()
        assertTrue(r.data.value.connections.isEmpty())
        assertTrue(File(tmp.root, "data.json.corrupt").exists())
    }

    @Test fun duplicateAndDelete() {
        val r = repo()
        val p = profile(r)
        r.saveConnection(p, "pw")
        r.duplicateConnection(p.id, " (copy)")
        assertEquals(listOf("Prod", "Prod (copy)"), r.data.value.connections.map { it.name })
        assertEquals("pw", r.targetFor(r.data.value.connections[1]).password)
        r.deleteConnection(p.id)
        assertEquals(1, r.data.value.connections.size)
    }
}
