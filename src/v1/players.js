// Готовые разборы профиля для /v1 (бот, мод): те же расчёты, что на сайте, в коротком и стабильном виде.
// Всё берётся из вида игрока v = { player, member, analysis, updatedAt } — его уже посчитал core.

const round = x => (Number.isFinite(Number(x)) ? Math.round(Number(x)) : 0);
const head = v => ({ player: { name: v.player?.name || null, uuid: v.player?.uuid || null }, profile: v.member?.profileName || null, updatedAt: v.updatedAt || 0 });

/** Как получают аксессуар (код how из core) */
export const HOW = { npc: 'NPC', craft: 'крафт', drop: 'дроп', da: 'Dark Auction', bazaar: 'Bazaar', ah: 'аукцион' };

/** Семейство аксессуара: Talisman → Ring → Artifact — один ключ на всю линейку */
const familyKey = r => (r.family?.length ? [...r.family].sort()[0] : r.fk || r.id);

/** Откуда взять предмет: до 3 способов из базы предметов (NPC, дроп, магазин) — текст и цена в монетах, если считается */
export function whereOf(id, { whereToGet, priceOf }) {
  return (whereToGet?.(id) || []).filter(w => w.subkind !== 'unknown' && w.textRu).slice(0, 3).map(w => {
    let coins = 0, other = 0, priced = true;
    for (const c of w.cost || []) {
      if (c.id === 'SKYBLOCK_COIN') coins += c.count;
      else if (/^SKYBLOCK_/.test(c.id)) priced = false; // Bits, Motes, Pests — не монеты
      else { const p = priceOf?.(c.id) || 0; if (p) other += p * c.count; else priced = false; }
    }
    return { text: w.textRu, coins: priced && (coins || other) ? round(coins + other) : null };
  });
}

const SORTS = {
  perMp: (a, b) => (a.perMp ?? Infinity) - (b.perMp ?? Infinity) || b.mp - a.mp,
  price: (a, b) => (a.price || Infinity) - (b.price || Infinity) || b.mp - a.mp,
  mp: (a, b) => b.mp - a.mp || (a.perMp ?? Infinity) - (b.perMp ?? Infinity),
};
export const MISSING_SORTS = Object.keys(SORTS);

/**
 * Недостающие аксессуары (команда /missing): по одному на линейку — тот, что даёт больше Magical Power.
 * q: { sort: perMp|price|mp, limit, maxPrice, upgrades (включать апгрейды своих) }
 */
export function missingAccessories(v, q = {}, deps = {}) {
  const acc = v.analysis?.acc;
  if (!acc) return null;
  const best = new Map();
  for (const r of acc.missing || []) {
    if (q.upgrades === false && r.upgradeFrom) continue;
    const k = familyKey(r);
    const cur = best.get(k);
    if (!cur || r.gain > cur.gain || (r.gain === cur.gain && (r.price || Infinity) < (cur.price || Infinity))) best.set(k, r);
  }
  let rows = [...best.values()].map(r => ({
    id: r.id, name: r.name, rarity: r.rarity || null, mp: r.gain,
    price: r.price ? round(r.price) : null, perMp: r.perMp ? round(r.perMp) : null,
    upgradeFrom: r.upgradeFrom || null, tier: Array.isArray(r.tier) ? r.tier : null, stat: r.stat || null,
    how: r.how || null, howText: HOW[r.how] || null, req: r.req || null,
    where: deps.whereToGet ? whereOf(r.id, deps) : [],
  }));
  const all = rows.length;
  if (Number.isFinite(q.maxPrice)) rows = rows.filter(r => r.price != null && r.price <= q.maxPrice);
  rows.sort(SORTS[q.sort] || SORTS.perMp);
  const total = { count: rows.length, mp: rows.reduce((s, r) => s + r.mp, 0), price: round(rows.reduce((s, r) => s + (r.price || 0), 0)), unpriced: rows.filter(r => !r.price).length };
  return { ...head(v), magicalPower: round(acc.calculatedMp), all, total, items: rows.slice(0, q.limit || 50) };
}

/** Аксессуары игрока: Magical Power, свои аксессуары с пробелами (tier, Recombobulator, Enrichment) и следующие шаги */
export function accessoriesView(v, q = {}) {
  const acc = v.analysis?.acc;
  if (!acc) return null;
  return {
    ...head(v),
    magicalPower: round(acc.calculatedMp), highestMagicalPower: acc.highestMp != null ? round(acc.highestMp) : null,
    count: acc.count || 0, missing: (acc.missing || []).length,
    recomb: { left: acc.notRecombCount || 0, mp: acc.recombGain || 0, price: acc.recombPrice ? round(acc.recombPrice) : null },
    enrichPrice: acc.enrichPrice ? round(acc.enrichPrice) : null,
    steps: (acc.steps || []).slice(0, q.limit || 20).map(s => ({
      kind: s.kind, id: s.id, target: s.target || null, name: s.name || null, rarity: s.rarity || null, mp: s.gain || 0,
      cost: s.cost ? round(s.cost) : null, perMp: s.cost && s.gain > 0 ? round(s.cost / s.gain) : null,
    })),
    owned: (acc.list || []).map(a => ({
      id: a.id, name: a.name, rarity: a.rarity || null, mp: a.mp || 0, active: !!a.active, recomb: !!a.recomb,
      reforge: a.reforge || null, enrichment: a.enrichment || null, next: a.next ? a.next.id : null,
      canRecomb: !!a.canRecomb, value: round(a.value),
    })),
  };
}

/** Networth по частям и самые дорогие вещи и питомцы */
export function networthView(v, q = {}) {
  const g = v.analysis?.gear;
  if (!g?.networth) return null;
  const n = Math.min(q.limit || 10, 50);
  return {
    ...head(v),
    networth: Object.fromEntries(Object.entries(g.networth).map(([k, x]) => [k, round(x)])),
    purse: round(v.member?.purse), bank: v.member?.bank != null ? round(v.member.bank) : null,
    topItems: (g.topItems || []).slice(0, n).map(it => ({ id: it.id, name: it.name, rarity: it.rarity || null, value: round(it.value), where: it.where || null })),
    topPets: (g.topPets || []).slice(0, n).map(p => ({ id: p.id, type: p.type, tier: p.tier || null, level: p.level || 0, heldItem: p.heldItem || null, value: round(p.value) })),
  };
}
