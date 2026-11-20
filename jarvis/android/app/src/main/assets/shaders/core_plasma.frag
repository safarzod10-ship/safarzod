// ===== Ядро «ПЛАЗМА»: живая энергетическая сфера. Когда Джарвис говорит — поверхность волнуется,
// вихрь ускоряется, свечение дышит в такт голосу. =====

uniform int uSteps; // шаги объёмного рендера (качество): 14…32

// смещение поверхности в направлении dir: в покое — едва заметное, при речи — живые волны
float wobble(vec3 dir, float t) {
    float a = noise3(dir * 2.1 + vec3(0.0, t * 1.1, t * 0.7)) - 0.5;
    float b = noise3(dir * 4.3 - vec3(t * 1.7, 0.0, t * 1.3)) - 0.5;
    return a * 2.0 + b * (0.6 + uLevel * 1.4);
}

float surfaceRadius(vec3 p, float r, float t) {
    vec3 dir = normalize(p);
    float amp = 0.035 + 0.05 * uEnergy + 0.15 * uLevel;
    return r * (1.0 + wobble(dir, t) * amp);
}

vec3 plasmaEmission(vec3 p, float rs, float t, out float skin) {
    float d = length(p) / rs;
    // дифференциальное вращение: внутренние слои быстрее — вихрь; голос его разгоняет
    float swirl = (1.6 - d) * (0.35 + uThink * 1.2 + uLevel * 1.6) * t;
    vec3 q = rotY(swirl) * p;
    q = rotX(0.4 * sin(t * 0.21)) * q;
    float n = fbm3(q * 2.4 + vec3(0.0, -t * (0.45 + uLevel * 0.8), t * 0.18));
    float n2 = noise3(q * 6.5 + vec3(t * 0.3, 0.0, -t * 0.25));
    float filaments = pow(clamp(1.0 - abs(n - 0.5) * 6.0, 0.0, 1.0), 9.0) * 1.6;
    filaments += 0.4 * pow(clamp(1.0 - abs(n2 - 0.5) * 6.0, 0.0, 1.0), 12.0) * smoothstep(0.9, 0.4, d);
    float core = exp(-d * d * (16.0 - 8.0 * uLevel));
    float coreWide = exp(-d * d * 4.0);
    float shell = smoothstep(1.0, 0.55, d);
    // светящаяся «кожа» сферы — повторяет волны поверхности
    skin = exp(-pow((d - 0.965) * 16.0, 2.0));
    vec3 c = mix(uColB, uColA, smoothstep(0.35, 0.8, n) * 0.7 + coreWide * 0.3);
    vec3 e = c * filaments * shell * (2.0 + uEnergy * 1.4 + uLevel * 2.2);
    e += uColB * coreWide * 0.10 * (0.6 + uEnergy);
    e += mix(uColA, vec3(1.0), 0.75) * core * (3.0 + uEnergy * 1.5 + uLevel * 3.5);
    e += uColA * skin * (0.3 + 0.3 * uEnergy + 0.6 * uLevel);
    return e;
}

void main() {
    vec2 frag = gl_FragCoord.xy;
    vec3 col = background(frag);

    float t = uTime;
    vec3 ro, rd; mat3 R;
    cameraRay(frag, t * (0.12 + uLevel * 0.25), ro, rd, R);

    float intro = smoothstep(0.0, 1.0, uIntro);
    float r = (1.0 + 0.07 * uLevel + 0.015 * sin(t * 1.7)) * mix(0.2, 1.0, intro);
    // радиус «живой» поверхности для этого пикселя: волны берём в точке луча, ближайшей к центру
    float tcl;
    float dcl = rayPointDist(ro, rd, vec3(0.0), tcl);
    vec3 dirC = normalize(ro + rd * tcl + vec3(1e-4));
    float rs = surfaceRadius(dirC, r, t);

    // --- сфера: объёмный рендер внутри волнующейся границы ---
    float b = dot(ro, rd);
    float c = dot(ro, ro) - rs * rs;
    float h = b * b - c;
    vec3 acc = vec3(0.0);
    float trans = 1.0;
    if (h > 0.0) {
        h = sqrt(h);
        float t0 = -b - h, t1 = -b + h;
        float len = t1 - t0;
        int steps = uSteps;
        float dt = len / float(steps);
        float jitter = hash12(frag + fract(t) * 37.0);
        for (int i = 0; i < 32; i++) {
            if (i >= steps) break;
            vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
            float skin;
            vec3 e = plasmaEmission(p, rs, t, skin);
            float dens = 0.9 + uEnergy;
            acc += trans * e * dt * 0.62;
            trans *= exp(-dt * dens * 0.45);
        }
        // кромка — повторяет волны поверхности
        float fres = pow(1.0 - clamp(h / rs, 0.0, 1.0), 6.0);
        acc += uColA * fres * (0.7 + 0.5 * uEnergy + 0.8 * uLevel);
        acc *= intro;
        col = col * mix(1.0, trans, 0.85) + acc;
    }

    // --- ореол вокруг сферы: пульсирует от голоса ---
    float tc;
    float dc = rayPointDist(ro, rd, vec3(0.0), tc);
    float limb = dc - rs;
    float halo = (limb > 0.0 ? exp(-limb * (5.0 - 1.0 * uEnergy)) : exp(limb * 14.0)) * (0.2 + 0.22 * uEnergy + 0.35 * uLevel);
    col += uColA * halo * 0.5 * intro;
    col += mix(uColA, vec3(1.0), 0.5) * exp(-dc * 2.6) * (0.04 + 0.04 * uLevel) * intro;

    fragColor = finalize(col, frag);
}
