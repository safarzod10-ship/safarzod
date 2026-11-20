// ===== Ядро «НЕЙРОСФЕРА»: облако частиц, живущее от голоса =====
// Каждая вершина — направление на сфере (фибоначчи) + случайное число.

layout(location = 0) in vec4 aDir; // xyz — направление, w — случайное 0..1

uniform vec2  uRes;
uniform float uTime;
uniform float uLevel;
uniform float uEnergy;
uniform float uThink;
uniform vec3  uColA;
uniform vec3  uColB;
uniform vec2  uRot;
uniform vec3  uFrame;
uniform float uIntro;
uniform float uPointScale; // px на единицу размера точки (учёт плотности экрана)

out vec3 vCol;
out float vAlpha;

#define CAM_DIST 3.6

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
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1, 0, 0, 0, c, s, 0, -s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0, -s, 0, 1, 0, s, 0, c); }

void main() {
    vec3 d = aDir.xyz;
    float rnd = aDir.w;
    float t = uTime;

    // волны по сфере: шум + «голосовые» полосы по широте
    float n1 = noise3(d * 2.3 + vec3(0.0, t * 0.35, t * 0.2));
    float n2 = noise3(d * 5.1 - vec3(t * 0.5, 0.0, t * 0.3));
    float bands = sin(d.y * 14.0 - t * (2.0 + uThink * 5.0 + uLevel * 6.0)) * 0.5 + 0.5;
    // голос Джарвиса: сфера заметно «говорит» — волны, полосы и общий пульс
    float disp = (n1 - 0.5) * (0.10 + 0.22 * uEnergy)
               + (n2 - 0.5) * 0.28 * uLevel
               + bands * uLevel * 0.18
               + uLevel * 0.10
               + uThink * 0.06 * sin(t * 6.0 + rnd * 30.0);
    // часть частиц — «пыль» в оболочке вокруг
    float shell = rnd > 0.92 ? (1.15 + rnd * 0.9 + 0.1 * sin(t * 0.7 + rnd * 50.0)) : 1.0;
    float intro = smoothstep(0.0, 1.0, uIntro);
    float r = (1.0 + disp) * shell * mix(0.05, 1.0, intro);

    // орбитальное вращение пыли
    vec3 p = d * r;
    if (shell > 1.0) p = rotY(t * (0.15 + rnd * 0.2) * (1.0 + uLevel * 2.0)) * p;
    p = rotY(t * (0.1 + uLevel * 0.25)) * p;

    // камера (как в фрагментных ядрах)
    mat3 R = rotY(uRot.x) * rotX(clamp(uRot.y, -1.2, 1.2) - 0.18);
    vec3 pc = transpose(R) * p - vec3(0.0, 0.0, CAM_DIST);
    float z = -pc.z;
    vec2 uv = pc.xy / z * CAM_DIST;
    vec2 frag = uFrame.xy + uv * uFrame.z;
    gl_Position = vec4(frag / uRes * 2.0 - 1.0, 0.0, 1.0);

    float front = clamp((CAM_DIST - z) * 0.9 + 0.5, 0.0, 1.0); // ближе к камере — ярче
    float size = (shell > 1.0 ? 1.4 : 2.0 + 2.2 * max(disp, 0.0) * 4.0) * (0.75 + rnd * 0.5);
    gl_PointSize = clamp(size * uPointScale * (CAM_DIST / z), 1.0, 64.0);

    vec3 c = mix(uColB, uColA, smoothstep(0.25, 0.75, n1));
    c = mix(c, vec3(1.0), smoothstep(0.08, 0.25, disp) * 0.6);
    vCol = c;
    vAlpha = (0.18 + 0.82 * front) * (shell > 1.0 ? 0.55 : 1.0) * (0.5 + 0.3 * uEnergy + 0.2 * uLevel) * intro;
}
