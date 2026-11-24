using UnityEditor;

/// Import rules for character / weapon textures extracted from the source GLBs (see tools/chars/conv.py):
/// capped at 1K, `_n` = normal map, `_l` = linear data (metal/roughness/occlusion).
public class CharTexImport : AssetPostprocessor
{
    void OnPreprocessTexture()
    {
        if (!assetPath.StartsWith("Assets/Chars/Src") && !assetPath.StartsWith("Assets/Weapons/Src")) return;
        var ti = (TextureImporter)assetImporter;
        bool weapon = assetPath.StartsWith("Assets/Weapons");
        ti.maxTextureSize = assetPath.Contains("/pack/") ? 64 : 1024;
        ti.mipmapEnabled = true; ti.anisoLevel = 4;
        string n = System.IO.Path.GetFileNameWithoutExtension(assetPath);
        if (n.EndsWith("_n")) ti.textureType = TextureImporterType.NormalMap;
        else if (n.EndsWith("_l")) ti.sRGBTexture = false;
    }
}
