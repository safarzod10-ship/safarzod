class_name Cards
extends RefCounted
## Карта — целое число: масть * 100 + достоинство. Масти: 0 ♠, 1 ♣, 2 ♦, 3 ♥.
## Достоинства 6..14 (11 — валет, 12 — дама, 13 — король, 14 — туз).

const SUITS := [0, 1, 2, 3]
const RANKS := [6, 7, 8, 9, 10, 11, 12, 13, 14]
const RANK_LABELS := {6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "В", 12: "Д", 13: "К", 14: "Т"}
const SUIT_NAMES := ["пики", "трефы", "бубны", "червы"]


static func make(s: int, r: int) -> int:
	return s * 100 + r


static func suit(c: int) -> int:
	return c / 100


static func rank(c: int) -> int:
	return c % 100


static func is_red(c: int) -> bool:
	return suit(c) >= 2


static func label(c: int) -> String:
	return RANK_LABELS[rank(c)]


## true, если карта `d` честно бьёт карту `a` при козыре `trump`.
static func beats(d: int, a: int, trump: int) -> bool:
	if suit(d) == suit(a):
		return rank(d) > rank(a)
	return suit(d) == trump and suit(a) != trump


static func full_deck() -> Array[int]:
	var deck: Array[int] = []
	for s in SUITS:
		for r in RANKS:
			deck.append(make(s, r))
	return deck


## Порядок в руке: некозырные по достоинству, затем козыри.
static func sort_hand(hand: Array, trump: int) -> Array:
	var h := hand.duplicate()
	h.sort_custom(func(x: int, y: int) -> bool:
		return sort_key(x, trump) < sort_key(y, trump))
	return h


static func sort_key(c: int, trump: int) -> int:
	return (100 if suit(c) == trump else 0) + rank(c) * 4 + suit(c)


## Ценность карты для ботов.
static func value(c: int, trump: int) -> int:
	return rank(c) + (20 if suit(c) == trump else 0)
