// ===== Ядро «ПЛАЗМА»: объёмная энергетическая сфера с орбитальными кольцами =====

uniform int uSteps; // шаги объёмного рендера (качество): 14…32

vec3 plasmaEmission(vec3 p, float r, float t) {
    float d = length(p) / r;
    // дифференциальное вращение: внутренние слои быстрее — вихрь
    float swirl = (1.6 - d) * (0.35 + uThink * 1.2) * t;
    vec3 q = rotY(swirl) * p;
    q = rotX(0.4 * sin(t * 0.21)) * q;
    float n = fbm3(q * 2.4 + vec3(0.0, -t * 0.45, t * 0.18));
    float n2 = noise3(q * 6.5 + vec3(t * 0.3, 0.0, -t * 0.25));
    // тонкие волокна плазмы: изолинии шума
    float filaments = pow(clamp(1.0 - abs(n - 0.5) * 6.0, 0.0, 1.0), 9.0) * 1.6;
    filaments += 0.4 * pow(clamp(1.0 - abs(n2 - 0.5) * 6.0, 0.0, 1.0), 12.0) * smoothstep(0.9, 0.4, d);
    float core = exp(-d * d * (16.0 - 6.0 * uLevel));
    float coreWide = exp(-d * d * 4.0);
    float shell = smoothstep(1.0, 0.55, d);
    vec3 c = mix(uColB, uColA, smoothstep(0.35, 0.8, n) * 0.7 + coreWide * 0.3);
    vec3 e = c * filaments * shell * (2.0 + uEnergy * 1.8 + uLevel * 3.0);
    e += uColB * coreWide * 0.10 * (0.6 + uEnergy);
    e += mix(uColA, vec3(1.0), 0.75) * core * (3.0 + uEnergy * 2.0 + uLevel * 6.0);
    return e;
}

void main() {
    vec2 frag = gl_FragCoord.xy;
    vec3 col = background(frag);

    float t = uTime;
    vec3 ro, rd; mat3 R;
    cameraRay(frag, t * 0.12, ro, rd, R);

    float intro = smoothstep(0.0, 1.0, uIntro);
    float r = (1.0 + 0.045 * uLevel + 0.015 * sin(t * 1.7)) * mix(0.2, 1.0, intro);

    // --- сфера ---
    float b = dot(ro, rd);
    float c = dot(ro, ro) - r * r;
    float h = b * b - c;
    float tFront = 1e9;
    vec3 acc = vec3(0.0);
    float trans = 1.0;
    if (h > 0.0) {
        h = sqrt(h);
        float t0 = -b - h, t1 = -b + h;
        tFront = t0;
        float len = t1 - t0;
        int steps = uSteps;
        float dt = len / float(steps);
        float jitter = hash12(frag + fract(t) * 37.0);
        for (int i = 0; i < 32; i++) {
            if (i >= steps) break;
            vec3 p = ro + rd * (t0 + (float(i) + jitter) * dt);
            vec3 e = plasmaEmission(p, r, t);
            float dens = 0.9 + uEnergy;
            acc += trans * e * dt * 0.62;
            trans *= exp(-dt * dens * 0.45);
        }
        // оболочка: френель + сетка широт/долгот + сканирующая полоса
        vec3 pS = ro + rd * t0;
        vec3 nS = normalize(pS);
        float fres = pow(1.0 - abs(dot(nS, rd)), 5.0);
        vec3 mp = rotY(-t * 0.12) * nS;
        float lat = asin(clamp(mp.y, -1.0, 1.0));
        float lon = atan(mp.z, mp.x);
        float px = 1.2 / uFrame.z;
        float grid = smoothstep(px * 4.0, 0.0, abs(fract(lat / PI * 12.0 + 0.5) - 0.5) * PI / 12.0 * 6.0)
                   + smoothstep(px * 4.0, 0.0, abs(fract(lon / TAU * 24.0 + 0.5) - 0.5) * TAU / 24.0 * 6.0 * cos(lat));
        float scanY = fract(t * 0.18) * 2.4 - 1.2;
        float scan = exp(-pow((mp.y - scanY) * 9.0, 2.0));
        vec3 shellCol = uColA * (fres * (1.1 + uEnergy) + grid * 0.07 * (0.25 + fres) + scan * 0.18 * (0.2 + fres));
        acc += shellCol * intro;
        acc *= intro;
        col = col * mix(1.0, trans, 0.85) + acc;
    }

    // --- ореол вокруг сферы ---
    float tc;
    float dc = rayPointDist(ro, rd, vec3(0.0), tc);
    // ореол пика на лимбе: снаружи плавно гаснет, внутрь сферы почти не заходит
    float limb = dc - r;
    float halo = (limb > 0.0 ? exp(-limb * (4.5 - 1.5 * uEnergy)) : exp(limb * 14.0)) * (0.22 + 0.3 * uEnergy + 0.6 * uLevel);
    col += uColA * halo * 0.6 * intro;
    col += mix(uColA, vec3(1.0), 0.5) * exp(-dc * 2.4) * 0.04 * intro;

    // --- орбитальные кольца ---
    float spin = t * (0.25 + uThink * 1.4 + uEnergy * 0.2);
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        vec3 n = normalize(rotZ(0.35 + fk * 0.9 + 0.12 * sin(t * 0.3 + fk)) * rotX(1.15 + fk * 0.55) * vec3(0.0, 1.0, 0.0));
        vec3 u = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0, 1, 0) : vec3(1, 0, 0)));
        float Rk = (1.38 + fk * 0.24) * mix(0.4, 1.0, intro);
        float w = (0.006 + 0.002 * fk) * (1.0 + uLevel * 0.8);
        float tHit;
        float dir = (k == 1) ? -1.0 : 1.0;
        float g = glowRing(ro, rd, n, u, Rk, w, k == 0 ? 0.0 : 18.0 + fk * 14.0, dir * spin * (0.5 + fk * 0.2), tHit);
        // искры, бегущие по кольцу
        vec3 v = cross(n, u);
        for (int s = 0; s < 2; s++) {
            float ang = dir * spin * (1.4 + fk * 0.3) + float(s) * PI + fk;
            vec3 sp = (u * cos(ang) + v * sin(ang)) * Rk;
            float ts;
            float ds = rayPointDist(ro, rd, sp, ts);
            float spark = exp(-ds * ds / (0.0009 + 0.0012 * uLevel)) * 1.6 + exp(-ds * 22.0) * 0.25;
            float occS = (h > 0.0 && ts > tFront) ? 0.15 : 1.0;
            col += mix(uColA, vec3(1.0), 0.6) * spark * occS * intro * (0.6 + uEnergy);
        }
        float occ = (h > 0.0 && tHit > tFront) ? 0.18 : 1.0;
        vec3 rc = mix(uColA, uColB, fk * 0.35);
        col += rc * g * occ * (0.55 + 0.55 * uEnergy + 0.9 * uLevel) * intro;
    }

    fragColor = finalize(col, frag);
}
