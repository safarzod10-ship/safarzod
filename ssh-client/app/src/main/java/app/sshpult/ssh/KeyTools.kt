package app.sshpult.ssh

import com.jcraft.jsch.JSch
import com.jcraft.jsch.JSchException
import com.jcraft.jsch.KeyPair
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.util.OpenSSHPrivateKeyUtil
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.util.Base64

enum class KeyAlgorithm { ED25519, RSA }

data class KeyInfo(
    /** e.g. `ssh-ed25519`, `ssh-rsa`, `ecdsa-sha2-nistp256` */
    val type: String,
    /** One line in `authorized_keys` format. */
    val publicKey: String,
    val fingerprint: String,
    val encrypted: Boolean,
)

data class GeneratedKey(val privateKey: String, val info: KeyInfo)

object KeyTools {
    /** Creates a new unencrypted key pair. CPU heavy for RSA — call off the main thread. */
    fun generate(algorithm: KeyAlgorithm, comment: String): GeneratedKey {
        val privateKey = when (algorithm) {
            KeyAlgorithm.ED25519 -> generateEd25519()
            KeyAlgorithm.RSA -> generateRsa()
        }
        return GeneratedKey(privateKey, inspect(privateKey, null, comment))
    }

    /** JSch cannot serialise EdDSA private keys, so the OpenSSH file is produced with BouncyCastle. */
    private fun generateEd25519(): String {
        val generator = Ed25519KeyPairGenerator()
        generator.init(Ed25519KeyGenerationParameters(SecureRandom()))
        val blob = OpenSSHPrivateKeyUtil.encodePrivateKey(generator.generateKeyPair().private)
        return buildString {
            append("-----BEGIN OPENSSH PRIVATE KEY-----\n")
            Base64.getEncoder().encodeToString(blob).chunked(70).forEach { append(it).append('\n') }
            append("-----END OPENSSH PRIVATE KEY-----\n")
        }
    }

    private fun generateRsa(): String {
        val pair = try {
            KeyPair.genKeyPair(JSch(), KeyPair.RSA, 3072)
        } catch (e: JSchException) {
            throw SshError.Other(e.message ?: "Key generation failed", e)
        }
        try {
            val out = ByteArrayOutputStream()
            pair.writePrivateKey(out)
            return out.toString(Charsets.UTF_8.name())
        } finally {
            pair.dispose()
        }
    }

    /**
     * Parses a private key (OpenSSH, PEM or PuTTY format) and returns its public half.
     * @throws SshError.BadPrivateKey, SshError.PassphraseRequired, SshError.WrongPassphrase
     */
    fun inspect(privateKey: String, passphrase: String?, comment: String = ""): KeyInfo {
        val pair = try {
            KeyPair.load(JSch(), privateKey.trim().plus("\n").toByteArray(), null)
        } catch (e: Exception) {
            throw SshError.BadPrivateKey(e)
        }
        try {
            val encrypted = pair.isEncrypted
            if (encrypted) {
                if (passphrase.isNullOrEmpty()) throw SshError.PassphraseRequired()
                val ok = try { pair.decrypt(passphrase) } catch (e: Exception) { false }
                if (!ok) throw SshError.WrongPassphrase()
            }
            return describe(pair, comment.ifBlank { pair.publicKeyComment.orEmpty() }, encrypted)
        } finally {
            pair.dispose()
        }
    }

    private fun describe(pair: KeyPair, comment: String, encrypted: Boolean): KeyInfo {
        val blob = pair.publicKeyBlob ?: throw SshError.BadPrivateKey()
        val type = keyTypeOf(blob)
        val line = buildString {
            append(type).append(' ').append(Base64.getEncoder().encodeToString(blob))
            val c = comment.trim().replace(Regex("\\s+"), "_")
            if (c.isNotEmpty()) append(' ').append(c)
        }
        return KeyInfo(type, line, sha256Fingerprint(blob), encrypted)
    }
}
