// ===== Jarvis: общий код для всех 3D-ядер =====
// Подключается после "#version 300 es / precision" в начало каждого фрагментного шейдера.

uniform vec2  uRes;     // размер вьюпорта, px
uniform float uTime;    // секунды
uniform float uLevel;   // громкость голоса / микрофона, 0..1 (сглаженная)
uniform float uEnergy;  // «возбуждение» состояния: ожидание 0.15 … слушаю 0.7 … говорю 1
uniform float uThink;   // 0..1 — режим «думаю»
uniform vec3  uColA;    // основной цвет состояния
uniform vec3  uColB;    // второй цвет
uniform vec2  uRot;     // поворот пальцем: yaw, pitch
uniform vec3  uFrame;   // центр модели (px, от левого нижнего угла) и px на единицу модели
uniform float uIntro;   // 0..1 — анимация появления

out vec4 fragColor;

#define PI 3.14159265
#define TAU 6.28318531
#define CAM_DIST 3.6

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
    p3 = fract(p3 * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
}

float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x),
            mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
        mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
            mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
        f.z);
}

float fbm3(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 3; i++) {
        s += a * noise3(p);
        p = p * 2.07 + vec3(1.7, 9.2, 3.1);
        a *= 0.5;
    }
    return s / 0.875;
}

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0, -s, 0, 1, 0, s, 0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0, -s, c, 0, 0, 0, 1); }

// Камера: орбита вокруг модели. Возвращает ro, rd для пикселя.
void cameraRay(vec2 frag, float autoYaw, out vec3 ro, out vec3 rd, out mat3 R) {
    vec2 uv = (frag - uFrame.xy) / uFrame.z;
    R = rotY(uRot.x + autoYaw) * rotX(clamp(uRot.y, -1.2, 1.2) - 0.18);
    ro = R * vec3(0.0, 0.0, CAM_DIST);
    rd = R * normalize(vec3(uv, -CAM_DIST));
}

vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Фон: глубокий тёмный градиент, ореол вокруг ядра, пыль с параллаксом, HUD-кольцо.
vec3 background(vec2 frag) {
    vec2 uv = (frag - uFrame.xy) / uFrame.z;
    vec2 sc = frag / uRes;
    float r = length(uv);

    vec3 col = mix(vec3(0.010, 0.014, 0.022), vec3(0.002, 0.003, 0.006), smoothstep(0.0, 1.0, sc.y * 0.4 + r * 0.12));
    // мягкий ореол цвета состояния
    col += uColA * 0.035 * exp(-r * 1.1) * (0.6 + 0.6 * uEnergy);
    col += uColB * 0.016 * exp(-r * 0.45);

    // пыль: две глубины, лёгкий параллакс от поворота
    for (int layer = 0; layer < 2; layer++) {
        float fl = float(layer);
        float scale = 34.0 + fl * 26.0;
        vec2 p = frag / uRes.y * scale + vec2(uRot.x, -uRot.y) * (3.0 + fl * 4.0) + vec2(uTime * (0.05 + fl * 0.03), 0.0);
        vec2 id = floor(p);
        vec2 f = fract(p) - 0.5;
        float h = hash12(id + fl * 17.0);
        if (h > 0.86) {
            vec2 o = vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5;
            float d = length(f - o * 0.7);
            float tw = 0.55 + 0.45 * sin(uTime * (0.8 + h * 2.0) + h * 40.0);
            col += mix(uColA, vec3(0.8, 0.9, 1.0), 0.6) * smoothstep(0.06, 0.0, d) * tw * (0.10 + fl * 0.06);
        }
    }

    // HUD: тонкое внешнее кольцо с делениями и бегущей дугой
    float ringR = 2.3;
    float px = 1.0 / uFrame.z;
    float a = atan(uv.y, uv.x);
    float ring = smoothstep(1.2 * px, 0.0, abs(r - ringR));
    float tickBand = step(ringR + 0.5 * px, r) * step(r, ringR + 0.045);
    float ticks = smoothstep(1.0 * px * 120.0 / TAU / r, 0.0, abs(fract(a / TAU * 120.0 + 0.5) - 0.5)) * tickBand;
    float majorBand = step(ringR + 0.5 * px, r) * step(r, ringR + 0.09);
    float major = smoothstep(1.6 * px * 12.0 / TAU / r, 0.0, abs(fract(a / TAU * 12.0 + 0.5) - 0.5)) * majorBand;
    float sweepA = fract((a / TAU) - uTime * (0.04 + uThink * 0.25));
    float arc = smoothstep(2.0 * px, 0.0, abs(r - (ringR - 0.05))) * smoothstep(0.0, 0.12, sweepA) * smoothstep(0.26, 0.12, sweepA);
    float hud = (ring * 0.12 + ticks * 0.10 + major * 0.28) * (0.6 + 0.4 * uEnergy) + arc * (0.35 + 0.5 * uEnergy);
    col += uColA * hud * uIntro;

    // виньетка
    col *= 1.0 - 0.55 * smoothstep(0.5, 1.25, length((sc - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
    return col;
}

vec4 finalize(vec3 col, vec2 frag) {
    col = aces(col * 1.05);
    col = pow(col, vec3(1.0 / 2.2));
    col += (hash12(frag + fract(uTime) * 100.0) - 0.5) / 255.0; // дизеринг против полос
    return vec4(col, 1.0);
}

// Расстояние от луча до точки (для «трубчатого» свечения колец и искр)
float rayPointDist(vec3 ro, vec3 rd, vec3 p, out float t) {
    t = dot(p - ro, rd);
    return length(cross(p - ro, rd));
}

// Светящееся кольцо радиуса R в плоскости с нормалью n (через центр), видимая толщина постоянна.
// Возвращает яркость; tHit — глубина ближайшей точки кольца.
float glowRing(vec3 ro, vec3 rd, vec3 n, vec3 u, float R, float w, float dashes, float phase, out float tHit) {
    float dn = dot(rd, n);
    float tp = -dot(ro, n) / (abs(dn) < 1e-4 ? 1e-4 : dn);
    vec3 p = ro + rd * tp;
    vec3 inPlane = p - n * dot(p, n);
    float len = length(inPlane);
    vec3 dir = len > 1e-4 ? inPlane / len : u;
    vec3 c = dir * R;
    float d = rayPointDist(ro, rd, c, tHit);
    float line = exp(-d * d / (w * w));
    float tail = 0.12 * exp(-d / (w * 5.0));
    if (dashes > 0.0) {
        vec3 v = cross(n, u);
        float a = atan(dot(dir, v), dot(dir, u));
        float k = fract(a / TAU * dashes + phase);
        line *= mix(0.15, 1.0, smoothstep(0.0, 0.03, k) * smoothstep(0.62, 0.58, k));
    }
    return line + tail;
}
