using UnityEngine;

/// Retargeted clips of one character (sub-assets of this object) plus the masks used to layer them.
public class CharClips : ScriptableObject
{
    public AnimationClip idle, idleRifle, walk, run, jump, crouchIdle, crouchWalk;
    public AnimationClip shoot, crouchShoot, reloadIdle, reloadWalk, reloadRun, reloadCrouch;
    public AnimationClip death, deathCrouch, deathProne;
    public AvatarMask upperMask;
    public float walkSpeed = 1.95f, runSpeed = 4.4f, crouchSpeed = 1.1f;   // ground speed the loops were authored for (m/s)
    public float runPhase = 0.13f;                                          // phase offset that puts the run in step with the walk
}
