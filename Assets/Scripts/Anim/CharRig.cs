using UnityEngine;

/// One arm of a character: bones, finger chains and the frame in which the hand holds a weapon grip.
[System.Serializable]
public class ArmRig
{
    public Transform shoulder, upper, fore, hand;
    public Transform[] fingers = new Transform[15];      // thumb, index, middle, ring, pinky x 3 joints (null when missing)
    public Quaternion[] fingerRest = new Quaternion[15]; // open-hand local rotations
    public Vector3[] fingerAxis = new Vector3[15];       // local curl axis (positive angle closes the finger)
    public Vector3[] fingerSide = new Vector3[15];       // local spread axis (thumb only is used)
    public Vector3 gripPos;                              // grip point in hand space (centre of the gripped cylinder)
    public Quaternion gripRot = Quaternion.identity;     // grip frame in hand space (right: pistol grip, +Z barrel, +Y up; left: handguard from below)
    public Quaternion animRot = Quaternion.identity;     // right hand: weapon orientation implied by the rifle animations

    public Vector3 GripPoint => hand.TransformPoint(gripPos);
    public Quaternion GripRotation => hand.rotation * gripRot;

    /// Wrist position/rotation that puts the hand's grip frame onto the given world frame.
    public void HandFor(Vector3 gripWorldPos, Quaternion gripWorldRot, out Vector3 wrist, out Quaternion rot)
    {
        rot = gripWorldRot * Quaternion.Inverse(gripRot);
        wrist = gripWorldPos - rot * Vector3.Scale(gripPos, hand.lossyScale);
    }

    /// Two-bone IK: moves the wrist to `wrist`, bends the elbow towards `hint`, then sets the hand rotation.
    public void Solve(Vector3 wrist, Quaternion handRot, Vector3 hint, float weight = 1f)
    {
        if (weight <= 0.001f) return;
        Vector3 a = upper.position;
        if (weight < 1f)
        {
            wrist = Vector3.Lerp(hand.position, wrist, weight);
            handRot = Quaternion.Slerp(hand.rotation, handRot, weight);
        }
        float l1 = Vector3.Distance(a, fore.position), l2 = Vector3.Distance(fore.position, hand.position);
        Vector3 to = wrist - a;
        float d = Mathf.Clamp(to.magnitude, Mathf.Abs(l1 - l2) + 0.001f, (l1 + l2) * 0.999f);
        Vector3 dir = to.normalized;
        float x = (l1 * l1 - l2 * l2 + d * d) / (2f * d);
        float h = Mathf.Sqrt(Mathf.Max(0f, l1 * l1 - x * x));
        Vector3 perp = Vector3.ProjectOnPlane(hint - a, dir);
        if (perp.sqrMagnitude < 1e-8f) perp = Vector3.ProjectOnPlane(fore.position - a, dir);
        if (perp.sqrMagnitude < 1e-8f) perp = Vector3.ProjectOnPlane(Vector3.down, dir);
        Vector3 elbow = a + dir * x + perp.normalized * h;
        upper.rotation = Quaternion.FromToRotation(fore.position - a, elbow - a) * upper.rotation;
        fore.rotation = Quaternion.FromToRotation(hand.position - fore.position, a + dir * d - fore.position) * fore.rotation;
        // share the wrist roll with the forearm so the sleeve does not candy-wrap
        Vector3 axis = (hand.position - fore.position).normalized;
        Quaternion rel = handRot * Quaternion.Inverse(hand.rotation);
        Vector3 v = new Vector3(rel.x, rel.y, rel.z);
        Vector3 proj = Vector3.Project(v, axis);
        Quaternion twist = new Quaternion(proj.x, proj.y, proj.z, rel.w);
        if (twist.w < 0) twist = new Quaternion(-twist.x, -twist.y, -twist.z, -twist.w);
        float m = Mathf.Sqrt(Quaternion.Dot(twist, twist));
        if (m > 1e-5f)
        {
            twist = new Quaternion(twist.x / m, twist.y / m, twist.z / m, twist.w / m);
            fore.rotation = Quaternion.Slerp(Quaternion.identity, twist, 0.5f) * fore.rotation;
        }
        hand.rotation = handRot;
    }

    /// curl: 15 angles in degrees (thumb, index, middle, ring, pinky x 3); spread: thumb opposition in degrees.
    public void Fingers(float[] curl, float thumbSide = 0f)
    {
        for (int i = 0; i < 15; i++)
        {
            var f = fingers[i];
            if (f == null) continue;
            Quaternion q = fingerRest[i] * Quaternion.AngleAxis(curl[i], fingerAxis[i]);
            if (i == 0 && thumbSide != 0f) q = fingerRest[i] * Quaternion.AngleAxis(thumbSide, fingerSide[i]) * Quaternion.AngleAxis(curl[i], fingerAxis[i]);
            f.localRotation = q;
        }
    }
}

/// Baked description of a character skeleton, filled in by the editor (CharSetup.BuildChars).
public class CharRig : MonoBehaviour
{
    public Transform hips, neck, head;
    public Transform[] spine;          // bottom to top, bent for aiming
    public ArmRig right = new ArmRig(), left = new ArmRig();
    public CharClips clips;
    public Vector3 animGripDir = Vector3.forward;  // direction right grip -> left grip in weapon space, as held in the animations
    public Renderer[] renderers;
}

public static class HandPose
{
    //                                         thumb         index         middle        ring          pinky
    public static readonly float[] Open =    { 0, 0, 0,      5, 5, 5,      5, 5, 5,      5, 5, 5,      5, 5, 5 };
    public static readonly float[] Relaxed = { 10, 10, 10,   20, 25, 15,   25, 30, 20,   30, 35, 20,   35, 35, 25 };
    public static readonly float[] Pistol =  { 20, 15, 25,   30, 45, 25,   62, 82, 50,   66, 86, 52,   70, 88, 55 };
    public static readonly float[] Trigger = { 20, 15, 25,   38, 60, 35,   62, 82, 50,   66, 86, 52,   70, 88, 55 };
    public static readonly float[] Guard =   { 5, 10, 15,    50, 55, 35,   52, 58, 36,   54, 60, 38,   56, 62, 40 };
    public static readonly float[] Fist =    { 30, 30, 40,   70, 88, 55,   72, 90, 56,   74, 90, 56,   76, 90, 58 };
    public static readonly float[] Mag =     { 5, 10, 10,    40, 45, 30,   42, 46, 30,   44, 48, 32,   46, 50, 34 };
    static readonly float[] tmp = new float[15];
    public static float[] Lerp(float[] a, float[] b, float t)
    {
        for (int i = 0; i < 15; i++) tmp[i] = Mathf.Lerp(a[i], b[i], t);
        return tmp;
    }
}
