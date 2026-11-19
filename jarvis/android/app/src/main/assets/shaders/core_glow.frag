// ===== Фон для «НЕЙРОСФЕРЫ»: пространство + внутреннее свечение + орбиты =====

uniform int uSteps; // не используется, для единого интерфейса

void main() {
    vec2 frag = gl_FragCoord.xy;
    vec3 col = background(frag);
    float t = uTime;
    vec3 ro, rd; mat3 R;
    cameraRay(frag, 0.0, ro, rd, R);
    float intro = smoothstep(0.0, 1.0, uIntro);

    float tc;
    float dc = rayPointDist(ro, rd, vec3(0.0), tc);
    // внутреннее «ядро» света
    col += mix(uColA, vec3(1.0), 0.55) * exp(-dc * dc * 10.0) * (0.35 + 0.9 * uLevel + 0.4 * uEnergy) * intro;
    col += uColA * exp(-dc * 2.4) * (0.10 + 0.25 * uEnergy + 0.3 * uLevel) * intro;

    // два тонких орбитальных кольца
    for (int k = 0; k < 2; k++) {
        float fk = float(k);
        vec3 n = normalize(rotX(1.25 + fk * 0.5) * rotZ(0.3 - fk * 0.8) * vec3(0.0, 1.0, 0.0));
        vec3 u = normalize(cross(n, vec3(0.0, 0.0, 1.0)));
        float tHit;
        float g = glowRing(ro, rd, n, u, 1.42 + fk * 0.2, 0.004, 40.0 + fk * 20.0, t * (0.08 + uThink * 0.6) * (k == 0 ? 1.0 : -1.0), tHit);
        float occ = tHit > CAM_DIST ? 0.35 : 1.0;
        col += mix(uColA, uColB, fk) * g * occ * (0.35 + 0.4 * uEnergy) * intro;
    }
    fragColor = finalize(col, frag);
}
