// ===== Ядро «ГИРОСКОП»: металлический карданный подвес с энергетическим сердечником =====

uniform int uSteps; // шаги трассировки: 48…96

mat3 gR0, gR1, gR2; // ориентации колец (внешнее → внутреннее)
float gCoreR;

// кольцо с прямоугольным сечением и фаской; q — в локальных координатах кольца (ось Y)
float sdRing(vec3 q, float R, vec2 sec, float bevel) {
    vec2 d = vec2(length(q.xz) - R, q.y);
    vec2 b = abs(d) - sec + bevel;
    return length(max(b, 0.0)) + min(max(b.x, b.y), 0.0) - bevel;
}

// прорези на внешней грани: N пазов по окружности
float slots(vec3 q, float R, float N, float depth, float width) {
    float a = atan(q.z, q.x);
    float cell = TAU / N;
    float aa = mod(a + cell * 0.5, cell) - cell * 0.5;
    vec2 p = vec2(aa * R, q.y);
    vec2 rq = vec2(length(q.xz) - R, 0.0);
    vec2 b = abs(p) - vec2(width, 0.035);
    float slot2d = length(max(b, 0.0)) + min(max(b.x, b.y), 0.0);
    return max(slot2d, -(rq.x - depth)); // работает как вычитание у внешней грани
}

const float R0 = 1.30, R1 = 1.02, R2 = 0.76;

// материал: 0 — кольцо 0, 1 — кольцо 1, 2 — кольцо 2, 3 — ось/шарнир, 4 — сердечник
// ось-шарнир вдоль оси X (s = ±1) между радиусами ra..rb; дешёвая проверка «далеко — вернуть грубую оценку»
float pinX(vec3 q, float ra, float rb, float r) {
    float s = sign(q.x);
    vec3 c = vec3(s * (ra + rb) * 0.5, 0.0, 0.0);
    float far = length(q - c) - (rb - ra) * 0.5 - r;
    if (far > 0.05) return far;
    vec2 d = vec2(length(q.yz), abs(q.x - c.x)) - vec2(r, (rb - ra) * 0.5);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - 0.004;
}

vec2 map(vec3 p) {
    vec2 res = vec2(length(p) - gCoreR, 4.0);

    vec3 q0 = gR0 * p;
    float d0 = sdRing(q0, R0, vec2(0.045, 0.085), 0.012);
    if (d0 < 0.03) d0 = max(d0, -slots(q0, R0 + 0.045, 36.0, 0.012, 0.018));
    if (d0 < res.x) res = vec2(d0, 0.0);

    vec3 q1 = gR1 * p;
    float d1 = sdRing(q1, R1, vec2(0.04, 0.07), 0.010);
    if (d1 < 0.03) d1 = max(d1, -slots(q1, R1 + 0.04, 28.0, 0.010, 0.016));
    if (d1 < res.x) res = vec2(d1, 1.0);

    vec3 q2 = gR2 * p;
    float d2 = sdRing(q2, R2, vec2(0.035, 0.06), 0.009);
    if (d2 < res.x) res = vec2(d2, 2.0);

    // шарниры: кольцо 1 держится на кольце 0 по своей оси X, кольцо 2 — на кольце 1 по своей оси Z,
    // внешнее кольцо — на вертикальной стойке (локальная ось Z внешнего кольца)
    float pin = pinX(q1, R1 - 0.02, R0 - 0.02, 0.022);
    pin = min(pin, pinX(q2.zyx, R2 - 0.02, R1 - 0.02, 0.018));
    pin = min(pin, pinX(q0.zyx, R0 + 0.03, R0 + 0.24, 0.028));
    if (pin < res.x) res = vec2(pin, 3.0);
    return res;
}

vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.0015, -0.0015);
    return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x +
                     e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float calcAO(vec3 p, vec3 n) {
    float occ = 0.0, sca = 1.0;
    for (int i = 0; i < 4; i++) {
        float hr = 0.02 + 0.07 * float(i);
        float d = map(p + n * hr).x;
        occ += (hr - d) * sca;
        sca *= 0.75;
    }
    return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

// студийное окружение: тёмный купол + софтбоксы + отсвет цвета состояния снизу
vec3 envMap(vec3 d) {
    vec3 c = mix(vec3(0.012, 0.014, 0.02), vec3(0.04, 0.05, 0.065), smoothstep(-0.3, 0.8, d.y));
    // верхний софтбокс
    float top = smoothstep(0.86, 0.9, d.y) * smoothstep(0.75, 0.6, abs(d.x));
    c += vec3(1.0, 0.98, 0.95) * top * 2.6;
    // боковые полосы-софтбоксы
    float side = smoothstep(0.05, 0.0, abs(d.y - 0.15)) * smoothstep(0.55, 0.75, abs(d.x)) * step(0.0, -d.z + 0.6);
    c += vec3(0.85, 0.92, 1.0) * side * 1.6;
    float rim = smoothstep(0.03, 0.0, abs(d.y + 0.05)) * smoothstep(0.3, 0.9, d.z);
    c += vec3(0.9, 0.95, 1.0) * rim * 1.2;
    // цветной отсвет пола
    c += uColA * smoothstep(-0.2, -0.9, d.y) * 0.25;
    return c;
}

float ggxSpec(vec3 n, vec3 v, vec3 l, float rough) {
    vec3 hv = normalize(v + l);
    float a = rough * rough;
    float nh = max(dot(n, hv), 0.0);
    float dd = nh * nh * (a * a - 1.0) + 1.0;
    float D = a * a / (PI * dd * dd);
    return D * max(dot(n, l), 0.0) * 0.25;
}

vec3 coreEmission(vec3 p, vec3 rd, float t) {
    vec3 n = normalize(p);
    float f = fbm3(rotY(t * 0.6) * n * 3.2 + vec3(0.0, t * 0.5, 0.0));
    float nv = abs(dot(n, rd));
    float fres = pow(1.0 - nv, 2.0);
    float veins = pow(clamp(1.0 - abs(f - 0.5) * 5.0, 0.0, 1.0), 4.0);
    float gain = 1.0 + uLevel * 1.8 + uEnergy * 0.6;
    vec3 c = mix(uColB * 0.6, uColA, smoothstep(0.0, 0.8, nv)) * (0.7 + 0.6 * f);
    c += vec3(1.0) * pow(nv, 6.0) * 1.4;         // раскалённый центр
    c += mix(uColA, vec3(1.0), 0.6) * veins * 1.2; // светящиеся прожилки
    c += uColA * fres * 1.6;                      // кромка
    return c * gain;
}

void main() {
    vec2 frag = gl_FragCoord.xy;
    vec3 col = background(frag);
    float t = uTime;

    vec3 ro, rd; mat3 R;
    cameraRay(frag, t * 0.08, ro, rd, R);

    float intro = smoothstep(0.0, 1.0, uIntro);
    float sp = 1.0 + uThink * 2.5 + uEnergy * 0.4;
    // карданная иерархия: внешнее вокруг Y, среднее — вокруг X внешнего, внутреннее — вокруг Z среднего
    mat3 A0 = rotY(t * 0.22 * sp) * rotX(PI * 0.5);
    mat3 A1 = rotX(t * 0.53 * sp + 0.6) * A0;
    mat3 A2 = rotZ(t * 0.91 * sp + 1.1) * A1;
    // map() переводит точку мира в локальные координаты кольца
    gR0 = A0; gR1 = A1; gR2 = A2;
    gCoreR = (0.30 + 0.03 * uLevel) * mix(0.3, 1.0, intro);
    float sc = mix(0.55, 1.0, intro);

    // ограничивающая сфера
    float bnd = 1.62 * sc;
    float b = dot(ro, rd);
    float c = dot(ro, ro) - bnd * bnd;
    float h = b * b - c;

    float glow = 0.0;
    float coreGlow = 0.0;
    vec3 hitCol = vec3(0.0);
    bool hit = false;
    if (h > 0.0) {
        h = sqrt(h);
        float tt = max(-b - h, 0.0);
        float tEnd = -b + h;
        for (int i = 0; i < 96; i++) {
            if (i >= uSteps) break;
            vec3 p = (ro + rd * tt) / sc;
            vec2 m = map(p);
            float d = m.x * sc;
            coreGlow += exp(-max(length(p) - gCoreR, 0.0) * 9.0) * 0.012;
            if (d < 0.0008 * tt) {
                hit = true;
                vec3 n = calcNormal(p);
                vec3 v = -rd;
                float mat = m.y;
                if (mat > 3.5) {
                    hitCol = coreEmission(p, rd, t);
                } else {
                    float ao = calcAO(p, n);
                    vec3 refl = reflect(rd, n);
                    float nv = max(dot(n, v), 0.0);
                    // металл: разные сплавы для колец
                    vec3 F0 = mat < 0.5 ? vec3(0.62, 0.64, 0.68) : (mat < 1.5 ? vec3(0.50, 0.52, 0.56) : (mat < 2.5 ? vec3(0.70, 0.66, 0.60) : vec3(0.85, 0.86, 0.88)));
                    float rough = mat < 2.5 ? 0.28 : 0.18;
                    vec3 F = F0 + (1.0 - F0) * pow(1.0 - nv, 5.0);
                    vec3 env = envMap(refl);
                    vec3 envRough = envMap(normalize(mix(refl, n, 0.55)));
                    vec3 spec = mix(env, envRough, rough * 1.6) * F;
                    // свет сердечника: точечный источник в центре
                    vec3 L = -p;
                    float dist = length(L);
                    L /= dist;
                    float att = 1.0 / (1.0 + dist * dist * 6.0);
                    vec3 coreLight = mix(uColA, vec3(1.0), 0.4) * (2.8 + uLevel * 6.0 + uEnergy * 2.0) * att;
                    vec3 lit = coreLight * (F0 * 0.35 * max(dot(n, L), 0.0) + F * ggxSpec(n, v, L, rough) * 2.0);
                    // ключевой свет студии
                    vec3 K = normalize(vec3(-0.5, 0.8, 0.6));
                    lit += vec3(1.0, 0.97, 0.92) * F * ggxSpec(n, v, K, rough) * 1.2;
                    hitCol = (spec * 0.9 + lit) * ao;
                    // светящиеся канавки по центру внешней грани колец
                    if (mat < 2.5) {
                        mat3 G = mat < 0.5 ? gR0 : (mat < 1.5 ? gR1 : gR2);
                        float Rr = mat < 0.5 ? R0 : (mat < 1.5 ? R1 : R2);
                        vec3 q = G * p;
                        float rad = length(q.xz) - Rr;
                        float onFace = smoothstep(0.02, 0.035, abs(rad)) * step(abs(q.y), 0.08);
                        float groove = smoothstep(0.009, 0.003, abs(q.y)) * smoothstep(0.03, 0.04, abs(rad));
                        float ang = atan(q.z, q.x);
                        float dirRun = mat < 0.5 ? 1.0 : (mat < 1.5 ? -1.3 : 1.7);
                        float run = 0.5 + 0.5 * sin(ang * 3.0 - t * (2.0 + uThink * 6.0) * dirRun);
                        hitCol += uColA * groove * (1.2 + 2.0 * uEnergy + 3.0 * uLevel) * (0.45 + 0.55 * run);
                        hitCol *= mix(1.0, 0.92, onFace);
                    }
                }
                break;
            }
            glow += exp(-d * 40.0) * 0.004;
            tt += d * 0.9;
            if (tt > tEnd) break;
        }
    }

    float tc;
    float dc = rayPointDist(ro, rd, vec3(0.0), tc);
    float halo = exp(-dc * (3.2 - uEnergy)) * (0.35 + 0.6 * uLevel + 0.3 * uEnergy);
    vec3 glowCol = uColA * (coreGlow * (1.5 + uLevel * 3.0) + halo * 0.5);

    if (hit) col = hitCol * intro + glowCol * 0.35;
    else col += glowCol * intro + uColA * glow * 0.4 * intro;

    fragColor = finalize(col, frag);
}
