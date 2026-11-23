using UnityEditor;

/// Import rules for downloaded textures: normal maps are marked as such, everything is capped at 1K.
public class TexImport : AssetPostprocessor
{
    void OnPreprocessTexture()
    {
        var ti = (TextureImporter)assetImporter;
        if (!assetPath.Contains("Resources/Textures")) return;
        ti.maxTextureSize = 1024; ti.anisoLevel = 8; ti.mipmapEnabled = true;
        if (assetPath.EndsWith("_n.jpg")) ti.textureType = TextureImporterType.NormalMap;
    }
}
