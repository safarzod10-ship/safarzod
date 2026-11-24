using UnityEngine;
using UnityEngine.Rendering;

/// Ambient light of the Town level: spherical harmonics baked from the sky HDRI (sun removed) plus a warm
/// ground-bounce term for the lower hemisphere. Applied at load, so no lightmap bake is needed.
[ExecuteAlways]
public class TownEnv : MonoBehaviour
{
    public float[] skySH = new float[27];
    public float[] groundSH = new float[27];
    public float skyScale = 1f;
    public float bounceScale = 1f;

    void OnEnable() { Apply(); }

    public void Apply()
    {
        if (skySH == null || groundSH == null || skySH.Length != 27 || groundSH.Length != 27) return;
        var sh = new SphericalHarmonicsL2();
        for (int c = 0; c < 3; c++)
            for (int i = 0; i < 9; i++)
                sh[c, i] = skySH[c * 9 + i] * skyScale + groundSH[c * 9 + i] * bounceScale;
        RenderSettings.ambientMode = AmbientMode.Custom;
        RenderSettings.ambientProbe = sh;
    }
}
