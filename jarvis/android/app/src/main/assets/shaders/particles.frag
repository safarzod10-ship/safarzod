in vec3 vCol;
in float vAlpha;
out vec4 fragColor;

void main() {
    vec2 c = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(c, c);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 7.0);
    float halo = exp(-r2 * 2.2) * 0.35;
    // аддитивное смешивание: цвет уже умножен на альфу
    fragColor = vec4(vCol * (core + halo) * vAlpha * 0.9, 1.0);
}
