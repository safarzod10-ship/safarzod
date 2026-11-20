package com.safarzod.jarvis.gl

import android.content.Context
import android.opengl.GLES30
import android.opengl.GLSurfaceView
import android.os.SystemClock
import android.util.Log
import com.safarzod.jarvis.core.CoreStyle
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Параметры ядра, которые пишет интерфейс/движок, а читает GL-поток.
 * Все поля — простые volatile-значения: без блокировок, без аллокаций в кадре.
 */
class CoreParams {
    @Volatile var style: CoreStyle = CoreStyle.PLASMA
    @Volatile var level = 0f            // громкость голоса/микрофона
    @Volatile var energy = 0.15f        // активность состояния
    @Volatile var think = 0f
    @Volatile var colA = floatArrayOf(0.36f, 0.89f, 1f)
    @Volatile var colB = floatArrayOf(0.10f, 0.32f, 0.95f)
    @Volatile var centerY = 0.40f       // доля высоты от верха
    @Volatile var radius = 0.20f        // доля меньшей стороны на единицу модели
    @Volatile var renderScale = 0.62f
    @Volatile var plasmaSteps = 20
    @Volatile var particles = 7000
    @Volatile var dragVx = 0f           // скорость вращения от пальца (рад/с)
    @Volatile var dragVy = 0f
    @Volatile var dragging = false
    @Volatile var dragDx = 0f           // накопленный сдвиг пальца за кадр
    @Volatile var dragDy = 0f
    @Volatile var reducedMotion = false
}

class CoreRenderer(private val context: Context, private val p: CoreParams) : GLSurfaceView.Renderer {

    private var width = 1
    private var height = 1
    private var vao = 0
    private var quad = 0

    private var program = 0
    private var programStyle: CoreStyle? = null
    private var programSteps = -1
    private var pointsProgram = 0
    private var pointsVao = 0
    private var pointsVbo = 0
    private var pointsCount = 0

    private val start = SystemClock.elapsedRealtime()
    private var lastFrame = 0L
    private var time = 0f

    // сглаженные значения
    private var sLevel = 0f
    private var sEnergy = 0.1f
    private var sThink = 0f
    private val sA = floatArrayOf(0.3f, 0.8f, 1f)
    private val sB = floatArrayOf(0.1f, 0.3f, 0.9f)
    private var sCenterY = 0.40f
    private var sRadius = 0.20f
    private var yaw = 0f
    private var pitch = 0f
    private var vYaw = 0f
    private var vPitch = 0f
    private var intro = 0f
    private var switchFade = 1f

    private val uniforms = HashMap<String, Int>()

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        GLES30.glClearColor(0.016f, 0.024f, 0.04f, 1f)
        val fsq = floatArrayOf(-1f, -1f, 3f, -1f, -1f, 3f)
        val buf = floatBuffer(fsq)
        val ids = IntArray(1)
        GLES30.glGenBuffers(1, ids, 0); quad = ids[0]
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, quad)
        GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, fsq.size * 4, buf, GLES30.GL_STATIC_DRAW)
        GLES30.glGenVertexArrays(1, ids, 0); vao = ids[0]
        GLES30.glBindVertexArray(vao)
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 2, GLES30.GL_FLOAT, false, 0, 0)
        GLES30.glBindVertexArray(0)
        // новый GL-контекст: все старые объекты недействительны
        program = 0; programStyle = null; pointsProgram = 0; pointsVbo = 0; pointsVao = 0; pointsCount = 0
        uniforms.clear()
        lastFrame = SystemClock.elapsedRealtime()
    }

    override fun onSurfaceChanged(gl: GL10?, w: Int, h: Int) {
        width = w; height = h
        GLES30.glViewport(0, 0, w, h)
    }

    override fun onDrawFrame(gl: GL10?) {
        val now = SystemClock.elapsedRealtime()
        val dt = ((now - lastFrame) / 1000f).coerceIn(0f, 0.1f)
        lastFrame = now
        val motion = if (p.reducedMotion) 0.35f else 1f
        time += dt * motion
        animate(dt)

        val style = p.style
        val steps = p.plasmaSteps
        if (programStyle != style || programSteps != steps || program == 0) {
            if (programStyle != null && programStyle != style) switchFade = 0f
            buildProgram(style)
            programSteps = steps
        }
        if (style == CoreStyle.NEURO && (pointsProgram == 0 || pointsCount != p.particles)) buildPoints(p.particles)

        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
        if (program == 0) return

        GLES30.glDisable(GLES30.GL_BLEND)
        GLES30.glUseProgram(program)
        setCommon(program, steps)
        GLES30.glBindVertexArray(vao)
        GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3)

        if (style == CoreStyle.NEURO && pointsProgram != 0) {
            GLES30.glEnable(GLES30.GL_BLEND)
            GLES30.glBlendFunc(GLES30.GL_ONE, GLES30.GL_ONE)
            GLES30.glUseProgram(pointsProgram)
            setCommon(pointsProgram, 0)
            GLES30.glUniform1f(loc(pointsProgram, "uPointScale"), min(width, height) / 1080f * 2.6f)
            GLES30.glBindVertexArray(pointsVao)
            GLES30.glDrawArrays(GLES30.GL_POINTS, 0, pointsCount)
            GLES30.glDisable(GLES30.GL_BLEND)
        }
        GLES30.glBindVertexArray(0)
    }

    private fun animate(dt: Float) {
        fun approach(cur: Float, target: Float, speed: Float) = cur + (target - cur) * (1f - exp(-speed * dt))
        sLevel = if (p.level > sLevel) approach(sLevel, p.level, 28f) else approach(sLevel, p.level, 7f)
        sEnergy = approach(sEnergy, p.energy, 3.2f)
        sThink = approach(sThink, p.think, 2.4f)
        val a = p.colA; val b = p.colB
        for (i in 0..2) { sA[i] = approach(sA[i], a[i], 2.6f); sB[i] = approach(sB[i], b[i], 2.6f) }
        sCenterY = approach(sCenterY, p.centerY, 6f)
        sRadius = approach(sRadius, p.radius, 6f)
        intro = min(1f, intro + dt / 1.8f)
        switchFade = min(1f, switchFade + dt / 0.9f)

        // вращение пальцем с инерцией и мягким возвратом наклона
        if (p.dragging) {
            val dx = p.dragDx; val dy = p.dragDy
            p.dragDx = 0f; p.dragDy = 0f
            val k = 3.2f / min(width, height).coerceAtLeast(1)
            yaw -= dx * k
            pitch = (pitch + dy * k).coerceIn(-1.1f, 1.1f)
            if (dt > 0f) { vYaw = -dx * k / dt * 0.6f + vYaw * 0.4f; vPitch = dy * k / dt * 0.6f + vPitch * 0.4f }
        } else {
            yaw += vYaw * dt
            pitch += vPitch * dt
            vYaw *= exp(-2.2f * dt)
            vPitch *= exp(-3.5f * dt)
            pitch = approach(pitch, 0f, 0.9f)
            if (abs(vYaw) < 0.01f) vYaw = 0f
        }
    }

    private fun setCommon(prog: Int, steps: Int) {
        val minSide = min(width, height).toFloat()
        val easedIntro = easeOutCubic(intro) * easeOutCubic(switchFade)
        GLES30.glUniform2f(loc(prog, "uRes"), width.toFloat(), height.toFloat())
        GLES30.glUniform1f(loc(prog, "uTime"), time)
        GLES30.glUniform1f(loc(prog, "uLevel"), sLevel)
        GLES30.glUniform1f(loc(prog, "uEnergy"), sEnergy)
        GLES30.glUniform1f(loc(prog, "uThink"), sThink)
        GLES30.glUniform3f(loc(prog, "uColA"), sA[0], sA[1], sA[2])
        GLES30.glUniform3f(loc(prog, "uColB"), sB[0], sB[1], sB[2])
        GLES30.glUniform2f(loc(prog, "uRot"), yaw, pitch)
        GLES30.glUniform3f(loc(prog, "uFrame"), width * 0.5f, height * (1f - sCenterY), minSide * sRadius)
        GLES30.glUniform1f(loc(prog, "uIntro"), easedIntro)
        val stepsLoc = loc(prog, "uSteps")
        if (stepsLoc >= 0) GLES30.glUniform1i(stepsLoc, steps)
    }

    private fun easeOutCubic(x: Float): Float { val t = 1f - x; return 1f - t * t * t }

    private fun loc(prog: Int, name: String): Int = uniforms.getOrPut("$prog/$name") { GLES30.glGetUniformLocation(prog, name) }

    // ---------------------------------------------------------------- шейдеры

    private fun asset(name: String) = context.assets.open("shaders/$name").bufferedReader().use { it.readText() }

    private val header = "#version 300 es\nprecision highp float;\nprecision highp int;\n"

    private fun buildProgram(style: CoreStyle) {
        if (program != 0) GLES30.glDeleteProgram(program)
        uniforms.clear()
        val frag = when (style) {
            CoreStyle.PLASMA -> "core_plasma.frag"
            CoreStyle.NEURO -> "core_glow.frag"
        }
        val vs = "#version 300 es\nlayout(location=0) in vec2 aPos;\nvoid main(){ gl_Position = vec4(aPos, 0.0, 1.0); }\n"
        val fs = header + asset("common.glsl") + "\n" + asset(frag)
        program = link(vs, fs)
        programStyle = style
        if (pointsProgram != 0 && style != CoreStyle.NEURO) { GLES30.glDeleteProgram(pointsProgram); pointsProgram = 0; pointsCount = 0 }
    }

    private fun buildPoints(n: Int) {
        if (pointsProgram == 0) {
            pointsProgram = link(header + asset("particles.vert"), header + asset("particles.frag"))
        }
        val data = FloatArray(n * 4)
        val ga = PI * (3.0 - sqrt(5.0))
        for (i in 0 until n) {
            val y = 1.0 - (i + 0.5) / n * 2.0
            val r = sqrt(1.0 - y * y)
            val th = ga * i
            data[i * 4] = (cos(th) * r).toFloat()
            data[i * 4 + 1] = y.toFloat()
            data[i * 4 + 2] = (sin(th) * r).toFloat()
            val h = sin(i * 12.9898) * 43758.5453
            data[i * 4 + 3] = (h - kotlin.math.floor(h)).toFloat()
        }
        val ids = IntArray(1)
        if (pointsVbo == 0) { GLES30.glGenBuffers(1, ids, 0); pointsVbo = ids[0] }
        if (pointsVao == 0) { GLES30.glGenVertexArrays(1, ids, 0); pointsVao = ids[0] }
        GLES30.glBindVertexArray(pointsVao)
        GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, pointsVbo)
        GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, data.size * 4, floatBuffer(data), GLES30.GL_STATIC_DRAW)
        GLES30.glEnableVertexAttribArray(0)
        GLES30.glVertexAttribPointer(0, 4, GLES30.GL_FLOAT, false, 0, 0)
        GLES30.glBindVertexArray(0)
        pointsCount = n
    }

    private fun link(vsSrc: String, fsSrc: String): Int {
        val vs = compile(GLES30.GL_VERTEX_SHADER, vsSrc)
        val fs = compile(GLES30.GL_FRAGMENT_SHADER, fsSrc)
        if (vs == 0 || fs == 0) return 0
        val prog = GLES30.glCreateProgram()
        GLES30.glAttachShader(prog, vs)
        GLES30.glAttachShader(prog, fs)
        GLES30.glBindAttribLocation(prog, 0, "aPos")
        GLES30.glLinkProgram(prog)
        val ok = IntArray(1)
        GLES30.glGetProgramiv(prog, GLES30.GL_LINK_STATUS, ok, 0)
        GLES30.glDeleteShader(vs); GLES30.glDeleteShader(fs)
        if (ok[0] == 0) {
            Log.e(TAG, "link: " + GLES30.glGetProgramInfoLog(prog))
            GLES30.glDeleteProgram(prog)
            return 0
        }
        return prog
    }

    private fun compile(type: Int, src: String): Int {
        val s = GLES30.glCreateShader(type)
        GLES30.glShaderSource(s, src)
        GLES30.glCompileShader(s)
        val ok = IntArray(1)
        GLES30.glGetShaderiv(s, GLES30.GL_COMPILE_STATUS, ok, 0)
        if (ok[0] == 0) {
            Log.e(TAG, "compile: " + GLES30.glGetShaderInfoLog(s))
            GLES30.glDeleteShader(s)
            return 0
        }
        return s
    }

    private fun floatBuffer(a: FloatArray): FloatBuffer =
        ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply { put(a); position(0) }

    companion object { private const val TAG = "CoreRenderer" }
}
