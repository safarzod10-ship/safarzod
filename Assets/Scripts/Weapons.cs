using UnityEngine;

public enum Slot { Knife = 0, Pistol = 1, Primary = 2, Grenade = 3 }

public class WeaponDef
{
    public int id;
    public string key;       // model name in Resources/Weapons
    public string title;     // in-game (own) name
    public Slot slot;
    public int price, damage, mag, reserve, pellets = 1;
    public float rate;       // seconds between shots
    public float spread;     // degrees, standing
    public float recoil;     // degrees of kick per shot
    public float reload;     // seconds
    public float range = 120f;
    public float headMul = 4f;
    public float moveSpeed = 1f;
    public bool auto;
    public float zoomFov;    // 0 = no scope
    public int killReward = 300;
}

public static class Weapons
{
    public static readonly WeaponDef[] All;
    public const int Knife = 0, DefaultT = 2, DefaultCT = 1, Grenade = 24;

    static Weapons()
    {
        All = new[]
        {
            W("knife", "Нож", Slot.Knife, 0, 55, 0, 0, 0.45f, 0, 0, 0, false, range: 2.2f, speed: 1f, reward: 1500),
            // pistols
            W("usp", "Страж", Slot.Pistol, 200, 34, 12, 100, 0.15f, 0.9f, 1.6f, 2.2f, false),
            W("glock", "Шершень", Slot.Pistol, 200, 26, 20, 120, 0.13f, 1.1f, 1.2f, 2.2f, false),
            W("p226", "Сокол", Slot.Pistol, 600, 32, 13, 52, 0.14f, 0.9f, 1.5f, 2.3f, false),
            W("deagle", "Орёл", Slot.Pistol, 650, 54, 7, 35, 0.26f, 0.7f, 4.5f, 2.2f, false),
            W("fiveseven", "Жало", Slot.Pistol, 750, 28, 20, 100, 0.13f, 0.8f, 1.2f, 2.5f, false),
            W("beretta", "Близнец", Slot.Pistol, 800, 30, 15, 120, 0.12f, 1.2f, 1.4f, 2.6f, false),
            // shotguns
            W("m3", "Помпа", Slot.Primary, 1700, 22, 8, 32, 0.9f, 4.5f, 5f, 3.2f, false, pellets: 8, range: 35f, reward: 900),
            W("xm1014", "Картечь", Slot.Primary, 3000, 20, 7, 32, 0.28f, 5f, 4f, 3.2f, true, pellets: 6, range: 35f, reward: 900),
            // smg
            W("mac10", "Оса", Slot.Primary, 1400, 27, 30, 100, 0.075f, 2.2f, 1.2f, 2.6f, true, reward: 600),
            W("mp9", "Стриж", Slot.Primary, 1250, 24, 30, 120, 0.07f, 2f, 1.1f, 2.1f, true, reward: 600),
            W("mp5", "Гюрза", Slot.Primary, 1500, 26, 30, 120, 0.08f, 1.5f, 1.1f, 2.6f, true, reward: 600),
            W("ump", "Кувалда", Slot.Primary, 1700, 30, 25, 100, 0.105f, 1.6f, 1.4f, 3f, true, reward: 600),
            W("p90", "Вихрь", Slot.Primary, 2350, 25, 50, 100, 0.07f, 1.8f, 1f, 3.3f, true, reward: 300),
            // rifles
            W("galil", "Барс", Slot.Primary, 2000, 30, 35, 90, 0.09f, 1.3f, 1.5f, 2.5f, true),
            W("famas", "Клинок", Slot.Primary, 2250, 30, 25, 90, 0.09f, 1.2f, 1.5f, 3.1f, true),
            W("ak", "Калаш", Slot.Primary, 2500, 36, 30, 90, 0.1f, 1.1f, 2.1f, 2.5f, true, speed: 0.88f),
            W("m4", "Карабин", Slot.Primary, 3100, 33, 30, 90, 0.09f, 0.9f, 1.7f, 3.1f, true, speed: 0.9f),
            W("sg552", "Рысь", Slot.Primary, 3500, 33, 30, 90, 0.09f, 0.9f, 1.7f, 3f, true, zoom: 35f, speed: 0.9f),
            W("aug", "Буллпап", Slot.Primary, 3500, 32, 30, 90, 0.09f, 0.9f, 1.6f, 3.3f, true, zoom: 35f, speed: 0.9f),
            // snipers
            W("scout", "Егерь", Slot.Primary, 2750, 75, 10, 90, 1.25f, 0.15f, 3f, 2f, false, zoom: 18f, range: 300f),
            W("awp", "Слонобой", Slot.Primary, 4750, 115, 10, 30, 1.5f, 0.1f, 6f, 3.6f, false, zoom: 12f, range: 300f, speed: 0.8f, reward: 100),
            W("g3", "Автоснайп", Slot.Primary, 5000, 80, 20, 90, 0.25f, 0.3f, 3f, 4.6f, true, zoom: 15f, range: 300f, speed: 0.82f),
            // machine gun
            W("m249", "Молотилка", Slot.Primary, 5750, 32, 100, 200, 0.075f, 2f, 1.6f, 4.7f, true, speed: 0.82f),
            // grenade
            W("grenade", "Граната", Slot.Grenade, 300, 98, 1, 0, 1f, 0, 0, 0, false),
        };
        for (int i = 0; i < All.Length; i++) All[i].id = i;
    }

    static WeaponDef W(string key, string title, Slot slot, int price, int dmg, int mag, int reserve, float rate,
        float spread, float recoil, float reload, bool auto, int pellets = 1, float zoom = 0, float range = 120f,
        float speed = 0.95f, int reward = 300)
    {
        return new WeaponDef
        {
            key = key, title = title, slot = slot, price = price, damage = dmg, mag = mag, reserve = reserve, rate = rate,
            spread = spread, recoil = recoil, reload = reload, auto = auto, pellets = pellets, zoomFov = zoom,
            range = range, moveSpeed = speed, killReward = reward,
        };
    }

    public static WeaponDef Get(int id) => All[Mathf.Clamp(id, 0, All.Length - 1)];
}
