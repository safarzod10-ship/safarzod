using System;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

/// Free first-person walk around the Town level (touch on phones, WASD + mouse on desktop).
/// Starts by itself unless the player was launched in screenshot or recording mode.
public class TownPlayer : MonoBehaviour
{
    CharacterController cc;
    Transform cam;
    float yaw = 180f, pitch, vy, bob;
    int moveFinger = -1, lookFinger = -1;
    Vector2 moveStart, move;
    bool mobile, jumpQueued;
    Texture2D ring, dot;
    Rect jumpRect;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    static void Boot()
    {
        if (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != "Town") return;
        foreach (var a in Environment.GetCommandLineArgs()) if (a == "-townshots" || a == "-townwalk") return;
        new GameObject("TownPlayer").AddComponent<TownPlayer>();
    }

    void Start()
    {
        mobile = Application.isMobilePlatform;
        Application.targetFrameRate = 60;
        Screen.sleepTimeout = SleepTimeout.NeverSleep;
        var urp = GraphicsSettings.currentRenderPipeline as UniversalRenderPipelineAsset;
        if (urp != null && mobile) { urp.renderScale = 0.85f; urp.msaaSampleCount = 1; urp.shadowDistance = 45f; }

        var spawn = GameObject.Find("SpawnA");
        Vector3 p = spawn != null ? spawn.transform.position : new Vector3(-1.5f, 0.1f, 23f);
        if (spawn != null) yaw = spawn.transform.eulerAngles.y;
        transform.position = p + Vector3.up * 0.2f;
        cc = gameObject.AddComponent<CharacterController>();
        cc.height = 1.8f; cc.radius = 0.32f; cc.center = new Vector3(0, 0.9f, 0); cc.stepOffset = 0.4f; cc.slopeLimit = 50f; cc.skinWidth = 0.03f;
        cam = Camera.main.transform;
        Camera.main.fieldOfView = 68f; Camera.main.nearClipPlane = 0.05f;
        ring = Circle(128, 0.86f, 1f, new Color(1, 1, 1, 0.35f));
        dot = Circle(128, 0f, 1f, new Color(1, 1, 1, 0.45f));
    }

    static Texture2D Circle(int n, float inner, float outer, Color c)
    {
        var t = new Texture2D(n, n, TextureFormat.RGBA32, false);
        for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                float d = Vector2.Distance(new Vector2(x, y), new Vector2(n / 2f, n / 2f)) / (n / 2f);
                t.SetPixel(x, y, d >= inner && d <= outer ? c : Color.clear);
            }
        t.Apply(); return t;
    }

    void Update()
    {
        float s = Mathf.Min(Screen.width, Screen.height);
        jumpRect = new Rect(Screen.width - s * 0.26f, s * 0.08f, s * 0.2f, s * 0.2f); // bottom-left origin
        Vector2 look = Vector2.zero; bool run = false;
        if (mobile)
        {
            for (int i = 0; i < Input.touchCount; i++)
            {
                var t = Input.GetTouch(i);
                if (t.phase == TouchPhase.Began)
                {
                    if (jumpRect.Contains(t.position)) jumpQueued = true;
                    else if (t.position.x < Screen.width * 0.45f && moveFinger < 0) { moveFinger = t.fingerId; moveStart = t.position; }
                    else if (lookFinger < 0) lookFinger = t.fingerId;
                }
                if (t.fingerId == moveFinger) move = Vector2.ClampMagnitude((t.position - moveStart) / (s * 0.13f), 1f);
                if (t.fingerId == lookFinger) look += t.deltaPosition * (1080f / Screen.height) * 0.12f;
                if (t.phase == TouchPhase.Ended || t.phase == TouchPhase.Canceled)
                {
                    if (t.fingerId == moveFinger) { moveFinger = -1; move = Vector2.zero; }
                    if (t.fingerId == lookFinger) lookFinger = -1;
                }
            }
            run = move.magnitude > 0.92f;
        }
        else
        {
            if (Input.GetMouseButtonDown(0)) { Cursor.lockState = CursorLockMode.Locked; Cursor.visible = false; }
            if (Input.GetKeyDown(KeyCode.Escape)) { Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
            move = Vector2.ClampMagnitude(new Vector2(Input.GetAxisRaw("Horizontal"), Input.GetAxisRaw("Vertical")), 1f);
            if (Cursor.lockState == CursorLockMode.Locked) look = new Vector2(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y")) * 2.2f;
            if (Input.GetKeyDown(KeyCode.Space)) jumpQueued = true;
            run = Input.GetKey(KeyCode.LeftShift);
        }
        yaw += look.x; pitch = Mathf.Clamp(pitch - look.y, -85f, 85f);

        float speed = run ? 5.6f : 3.8f;
        Vector3 wish = Quaternion.Euler(0, yaw, 0) * new Vector3(move.x, 0, move.y) * speed;
        if (cc.isGrounded) { vy = -2f; if (jumpQueued) vy = 6.2f; }
        jumpQueued = false;
        vy -= 19f * Time.deltaTime;
        cc.Move((wish + Vector3.up * vy) * Time.deltaTime);
        if (transform.position.y < -20f) { cc.enabled = false; transform.position = new Vector3(-1.5f, 0.5f, 23f); cc.enabled = true; vy = 0; }
        float planar = new Vector3(cc.velocity.x, 0, cc.velocity.z).magnitude;
        bob += planar * Time.deltaTime * 2.1f;
        cam.position = transform.position + Vector3.up * (1.65f + Mathf.Sin(bob * 2f) * 0.022f * Mathf.Clamp01(planar));
        cam.rotation = Quaternion.Euler(pitch, yaw, 0);
    }

    void OnGUI()
    {
        if (!mobile) return;
        float s = Mathf.Min(Screen.width, Screen.height);
        float r = s * 0.13f;
        Vector2 c = moveFinger >= 0 ? moveStart : new Vector2(s * 0.24f, s * 0.26f);
        GUI.DrawTexture(new Rect(c.x - r, Screen.height - c.y - r, r * 2, r * 2), ring);
        Vector2 k = c + move * r;
        GUI.DrawTexture(new Rect(k.x - r * 0.4f, Screen.height - k.y - r * 0.4f, r * 0.8f, r * 0.8f), dot);
        GUI.DrawTexture(new Rect(jumpRect.x, Screen.height - jumpRect.y - jumpRect.height, jumpRect.width, jumpRect.height), ring);
    }
}
