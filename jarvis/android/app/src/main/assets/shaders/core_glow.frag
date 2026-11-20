// ===== Фон для «НЕЙРОСФЕРЫ»: пространство + внутреннее свечение =====

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
    col += mix(uColA, vec3(1.0), 0.55) * exp(-dc * dc * (10.0 - 4.0 * uLevel)) * (0.3 + 0.6 * uLevel + 0.3 * uEnergy) * intro;
    col += uColA * exp(-dc * (2.4 - 0.8 * uLevel)) * (0.10 + 0.25 * uEnergy + 0.5 * uLevel) * intro;

    fragColor = finalize(col, frag);
}
