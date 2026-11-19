import java.net.URI
import java.util.Properties
import java.util.zip.ZipInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore/keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.safarzod.jarvis"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.safarzod.jarvis"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a") }
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file("keystore/" + keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    androidResources {
        // модель Vosk читается напрямую из распакованной копии, её не нужно сжимать дважды
        noCompress += listOf("fst", "mdl", "ie", "dubm", "mat")
    }
    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
        jniLibs.useLegacyPackaging = false
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.all { it.systemProperty("robolectric.pixelCopyRenderMode", "hardware") }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        freeCompilerArgs.addAll(listOf("-opt-in=kotlin.RequiresOptIn"))
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.12.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.animation:animation")
    implementation("androidx.activity:activity-compose:1.12.2")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-service:2.10.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")

    // офлайн-распознавание речи
    implementation("com.alphacephei:vosk-android:0.3.75")
    implementation("net.java.dev.jna:jna:5.18.1@aar")

    // локальная языковая модель (MediaPipe LLM Inference)
    implementation("com.google.mediapipe:tasks-genai:0.10.29")

    debugImplementation("androidx.compose.ui:ui-tooling")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.52.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.52.0")
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation(composeBom)
}

// ---- Модель распознавания речи Vosk (русская, 45 МБ) скачивается при сборке ----
val voskModelName = "vosk-model-small-ru-0.22"
val voskAssetDir = layout.projectDirectory.dir("src/main/assets/model-ru")

val downloadVoskModel by tasks.registering {
    description = "Скачивает офлайн-модель Vosk для русского языка в assets"
    val outDir = voskAssetDir.asFile
    outputs.dir(outDir)
    onlyIf { !File(outDir, "uuid").exists() }
    doLast {
        val cache = File(System.getProperty("user.home"), ".cache/jarvis/$voskModelName.zip")
        if (!cache.exists()) {
            cache.parentFile.mkdirs()
            logger.lifecycle("Скачиваю $voskModelName …")
            URI("https://alphacephei.com/vosk/models/$voskModelName.zip").toURL().openStream().use { input ->
                cache.outputStream().use { input.copyTo(it) }
            }
        }
        outDir.deleteRecursively()
        outDir.mkdirs()
        ZipInputStream(cache.inputStream()).use { zip ->
            var e = zip.nextEntry
            while (e != null) {
                val rel = e.name.substringAfter('/')
                if (rel.isNotEmpty() && !rel.startsWith("README")) {
                    val f = File(outDir, rel)
                    if (e.isDirectory) f.mkdirs() else {
                        f.parentFile.mkdirs()
                        f.outputStream().use { zip.copyTo(it) }
                    }
                }
                e = zip.nextEntry
            }
        }
        File(outDir, "uuid").writeText("$voskModelName-1\n")
    }
}
tasks.named("preBuild") { dependsOn(downloadVoskModel) }
