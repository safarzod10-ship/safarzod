using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

/// Adds the match objects (network manager, rules, HUD, navigation) to the Town level.
/// Run with -executeMethod TownGame.Apply after TownSetup.Build.
public static class TownGame
{
    public static void Apply()
    {
        var scene = EditorSceneManager.OpenScene("Assets/Scenes/Town.unity", OpenSceneMode.Single);
        foreach (var n in new[] { "NetworkManager", "Game", "Hud", "Navigation" })
        {
            var old = GameObject.Find(n);
            if (old != null) Object.DestroyImmediate(old);
        }
        var prefab = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Prefabs/Player.prefab");
        var list = AssetDatabase.LoadAssetAtPath<NetworkPrefabsList>("Assets/Settings/NetworkPrefabs.asset");

        var nmGo = new GameObject("NetworkManager");
        var nm = nmGo.AddComponent<NetworkManager>();
        var ut = nmGo.AddComponent<UnityTransport>();
        nm.NetworkConfig = new NetworkConfig { NetworkTransport = ut, EnableSceneManagement = false, TickRate = 30, ConnectionApproval = false };
        if (list != null) nm.NetworkConfig.Prefabs.NetworkPrefabsLists.Add(list);

        var nav = new GameObject("Navigation");
        var surface = nav.AddComponent<Unity.AI.Navigation.NavMeshSurface>();
        surface.collectObjects = Unity.AI.Navigation.CollectObjects.Volume;
        surface.center = new Vector3(-3.5f, 2f, 6f);
        surface.size = new Vector3(40f, 8f, 44f);
        surface.useGeometry = UnityEngine.AI.NavMeshCollectGeometry.PhysicsColliders;

        var gameGo = new GameObject("Game");
        gameGo.AddComponent<NetworkObject>();
        gameGo.AddComponent<Game>().playerPrefab = prefab;
        new GameObject("Hud", typeof(Hud));

        EditorSceneManager.MarkSceneDirty(scene);
        EditorSceneManager.SaveScene(scene);
        Debug.Log("TOWNGAME_DONE prefab=" + (prefab != null) + " list=" + (list != null));
    }
}
