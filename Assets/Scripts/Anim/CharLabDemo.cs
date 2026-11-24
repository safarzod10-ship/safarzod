using UnityEngine;

/// Play-mode demo for Assets/Scenes/CharLab.unity: the four fighters cycle through weapons and states so the
/// animation / weapon-holding work can be inspected live (press Play, orbit with the scene view or wait for the camera).
public class CharLabDemo : MonoBehaviour
{
    static readonly string[] Keys = { "ct1", "ct2", "t1", "t2" };
    static readonly int[] Guns = { 16, 1, 21, 4, 0 };      // ak, usp, awp, deagle, knife
    CharBody[] bodies; FpView fp; float t; int step = -1, gun;
    public bool firstPerson;

    void Start()
    {
        bodies = new CharBody[Keys.Length];
        for (int i = 0; i < Keys.Length; i++)
        {
            var holder = new GameObject("Fighter_" + Keys[i]);
            holder.transform.position = new Vector3((i - 1.5f) * 1.4f, 0, 0);
            holder.transform.rotation = Quaternion.Euler(0, 180f, 0);
            bodies[i] = CharBody.Create(holder.transform, Keys[i]);
            if (bodies[i]) bodies[i].SetWeapon(Guns[0], true);
        }
        var cam = Camera.main;
        if (firstPerson) { cam.transform.SetPositionAndRotation(new Vector3(0, 1.6f, 3f), Quaternion.identity); cam.fieldOfView = 68f; fp = FpView.Create(cam.transform); }
        else { cam.transform.position = new Vector3(0, 1.4f, -4.2f); cam.transform.LookAt(new Vector3(0, 1f, 0)); }
    }

    void Update()
    {
        t += Time.deltaTime;
        int s = (int)(t / 2.5f) % 8;
        if (s != step)
        {
            step = s;
            if (s == 0) { gun = (gun + 1) % Guns.Length; foreach (var b in bodies) if (b) { b.Revive(); b.SetWeapon(Guns[gun]); } }
            foreach (var b in bodies)
            {
                if (!b) continue;
                b.speed = s == 1 ? 2f : s == 2 ? 4.6f : s == 4 ? 1f : 0f; b.crouch = s == 3 || s == 4;
                b.pitch = s == 6 ? -25f : 0f;
                if (s == 5) b.Reload(Weapons.Get(Guns[gun]).reload);
                if (s == 7) b.Die();
            }
        }
        if (s == 6 || s == 0) { if (Time.frameCount % 12 == 0) { foreach (var b in bodies) if (b) b.Shot(); if (fp) fp.Fire(); } }
        if (fp)
        {
            var st = new FpView.State { weapon = Guns[gun], charKey = Keys[(int)(t / 20f) % Keys.Length], reloadU = s == 5 ? Mathf.Clamp01((t % 2.5f) / 2.4f) : -1f, sinceShot = (Time.frameCount % 12) / 60f, speed = s == 2 ? 4f : 0f, bob = t * 9f };
            fp.Tick(st, Time.deltaTime);
        }
    }
}
