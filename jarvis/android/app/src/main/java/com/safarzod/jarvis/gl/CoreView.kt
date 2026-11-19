package com.safarzod.jarvis.gl

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.opengl.GLSurfaceView
import android.view.Choreographer

/**
 * Поверхность 3D-ядра. Рендерит в уменьшенном буфере (аппаратный скейлер растягивает
 * без затрат) и сама решает, как часто рисовать: в покое — 30 кадров/с, в работе — 60.
 */
@SuppressLint("ViewConstructor")
class CoreView(context: Context, val params: CoreParams) : GLSurfaceView(context), Choreographer.FrameCallback {

    @Volatile var active = true   // false — 30 к/с для экономии
    private var frame = 0L
    private var running = false
    private var lastW = 0
    private var lastH = 0
    private var lastScale = 0f

    init {
        setEGLContextClientVersion(3)
        setEGLConfigChooser(8, 8, 8, 8, 0, 0)
        holder.setFormat(PixelFormat.RGBA_8888)
        preserveEGLContextOnPause = true
        setRenderer(CoreRenderer(context, params))
        renderMode = RENDERMODE_WHEN_DIRTY
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        applyScale(w, h)
    }

    private fun applyScale(w: Int, h: Int) {
        if (w <= 0 || h <= 0) return
        val s = params.renderScale
        if (w == lastW && h == lastH && s == lastScale) return
        lastW = w; lastH = h; lastScale = s
        holder.setFixedSize((w * s).toInt().coerceAtLeast(64), (h * s).toInt().coerceAtLeast(64))
    }

    override fun doFrame(frameTimeNanos: Long) {
        if (!running) return
        frame++
        if (params.renderScale != lastScale) applyScale(width, height)
        if (active || frame % 2L == 0L) requestRender()
        Choreographer.getInstance().postFrameCallback(this)
    }

    override fun onResume() {
        super.onResume()
        if (!running) {
            running = true
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    override fun onPause() {
        running = false
        Choreographer.getInstance().removeFrameCallback(this)
        super.onPause()
    }
}
