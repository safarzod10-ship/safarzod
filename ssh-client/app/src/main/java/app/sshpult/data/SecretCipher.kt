package app.sshpult.data

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts secrets (passwords, private keys) before they are written to disk. */
interface SecretCipher {
    fun encrypt(plain: String): String
    /** Returns null when the value cannot be decrypted (e.g. the keystore key was lost). */
    fun decrypt(encrypted: String): String?
}

/**
 * AES-256-GCM with a key that lives in the Android Keystore: it never leaves the device's
 * secure hardware (where available) and is not included in backups.
 */
class KeystoreCipher(private val alias: String = "sshpult_master_v1") : SecretCipher {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    @Synchronized
    override fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ct = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        return PREFIX + Base64.getEncoder().encodeToString(cipher.iv + ct)
    }

    @Synchronized
    override fun decrypt(encrypted: String): String? = try {
        require(encrypted.startsWith(PREFIX))
        val raw = Base64.getDecoder().decode(encrypted.removePrefix(PREFIX))
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw, 0, IV_LEN))
        String(cipher.doFinal(raw, IV_LEN, raw.size - IV_LEN), Charsets.UTF_8)
    } catch (e: Exception) {
        null
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val PREFIX = "k1:"
        const val IV_LEN = 12
    }
}
