using UnityEngine;

/// One artist-animated first-person pack (arms + its own weapon), prepared by Assets/Editor/FpPackSetup.cs into
/// Resources/FpArms/<key>.prefab. The prefab root is the eye: +Z looks at the crosshair, the model child is placed so that
/// the pack's authored camera sits on the root. Clips are generic (Mecanim) clips bound to `animator`, played by FpView
/// through a PlayableGraph so they can be time-scaled, restarted and sampled in edit mode.
public class FpPack : MonoBehaviour
{
    public Animator animator;
    public AnimationClip idle, walk, run, fire, fire2, reload, reloadEmpty, draw, holster;
    public Transform muzzle;               // barrel end (knife: blade tip), child of the weapon's main bone
    public Transform weaponBone;           // main bone of the pack's weapon
    public Renderer[] weaponRenderers;     // the pack's own weapon (hidden when the pack only lends its arms, e.g. grenade)
    public Transform handR;                // right hand bone (an item can be parented to it)

    public AnimationClip[] Clips => new[] { idle, walk, run, fire, fire2, reload, reloadEmpty, draw, holster };
}
