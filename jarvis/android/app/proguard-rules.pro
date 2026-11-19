# --- Vosk + JNA: нативный мост через рефлексию ---
-keep class com.sun.jna.** { *; }
-keep class * implements com.sun.jna.** { *; }
-keep class org.vosk.** { *; }
-dontwarn java.awt.**
-dontwarn com.sun.jna.**

# --- MediaPipe LLM Inference ---
-keep class com.google.mediapipe.** { *; }
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.mediapipe.**
-dontwarn com.google.protobuf.**
-dontwarn com.google.auto.value.**
-dontwarn javax.lang.model.**
-dontwarn com.google.errorprone.annotations.**

# --- kotlinx.serialization (модели данных приложения) ---
-keepclassmembers @kotlinx.serialization.Serializable class com.safarzod.jarvis.** {
    *** Companion;
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.safarzod.jarvis.**$$serializer { *; }

# --- службы, которые система создаёт по имени ---
-keep class com.safarzod.jarvis.service.** { *; }
