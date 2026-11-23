using System.Linq;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;

public static class Setup
{
    static AddAndRemoveRequest req;

    public static void InstallPackages()
    {
        req = Client.AddAndRemove(new[] {
            "com.unity.render-pipelines.universal",
            "com.unity.netcode.gameobjects",
            "com.unity.ai.navigation",
            "com.unity.cloud.gltfast",
            "com.unity.ugui",
        }, new[] { "com.unity.multiplayer.center" });
        EditorApplication.update += Poll;
    }

    static void Poll()
    {
        if (!req.IsCompleted) return;
        EditorApplication.update -= Poll;
        if (req.Status == StatusCode.Success)
            Debug.Log("PKG_OK " + string.Join(", ", req.Result.Select(p => p.name + "@" + p.version)));
        else
            Debug.LogError("PKG_FAIL " + req.Error.message);
        EditorApplication.Exit(req.Status == StatusCode.Success ? 0 : 1);
    }
}
