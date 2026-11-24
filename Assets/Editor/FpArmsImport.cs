using UnityEditor;

/// Import rules for the first-person arm packs (Assets/FpArms/<pack>/<pack>_tex, written by tools/fparms/prep.py):
/// every texture capped at 1K, `_n` = normal map, `_l` = linear data (metal/roughness/occlusion).
public class FpArmsImport : AssetPostprocessor
{
    void OnPreprocessTexture()
    {
        if (!assetPath.StartsWith("Assets/FpArms/")) return;
        var ti = (TextureImporter)assetImporter;
        ti.maxTextureSize = 1024; ti.mipmapEnabled = true; ti.anisoLevel = 2;
        string n = System.IO.Path.GetFileNameWithoutExtension(assetPath);
        if (n.EndsWith("_n")) ti.textureType = TextureImporterType.NormalMap;
        else if (n.EndsWith("_l")) ti.sRGBTexture = false;
    }
}
