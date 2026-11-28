// GET /api/item/:id/upgrades — все экземпляры этого предмета у игрока и чек-лист улучшений для каждого.
// Если предмета у игрока нет — copies: [] (карточка тогда показывает, где его взять).
// У экземпляра также: market — похожие лоты аукциона (те же звёзды и Recombobulator), value — оценка с улучшениями,
// bonus — текущий бонус предмета с меняющимися статами, family — линейка аксессуара и дубли в сумке,
// museum — сдан в Museum и одолжен обратно, sellable — можно ли продать именно этот экземпляр.
import { planItemUpgrades } from '@sky-guide/core/analysis/item-upgrades.js';
import { allStoredItems, itemValue, petValue } from '@sky-guide/core/parse/gear.js';
import { buildUpgrades } from '@sky-guide/core/lib/acc-upgrades.js';
import { currentBonus } from '@sky-guide/core/lib/variable-stats.js';
import { variantKey } from '@sky-guide/core/market/resale.js';
import { tx } from '@sky-guide/core/i18n/msg.js';
import { canSellCopy } from '@sky-guide/core/lib/item-props.js';
import { displayName } from '@sky-guide/core/names.js';
import { MP_BY_RARITY } from '@sky-guide/core/parse/gear.js';

const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC', 'DIVINE', 'SPECIAL', 'VERY SPECIAL'];

let upMemo = null;
const upgradesFor = raw => (upMemo && upMemo.raw === raw ? upMemo : (upMemo = { raw, map: buildUpgrades(raw) })).map;

const strip = s => String(s || '').replace(/§./g, '').replace(/[\uE000-\uF8FF]/g, '').replace(/[^\p{L}\p{N}\s+\-:.,%'()]/gu, ' ').replace(/\s+/g, ' ').trim();

/**
 * Что даёт ступень линейки по описанию NEU: «Mending: +9» и «Grants +17 Defense while burning» → { Mending: 9, Defense: 17 }.
 * Accessory Power не берём: это и есть Magical Power, он считается по редкости.
 */
export function stepStats(lore = []) {
  const out = {};
  const put = (k, v) => { if (out[k] == null && Object.keys(out).length < 4 && Number.isFinite(v)) out[k] = v; };
  for (const line of lore) {
    const t = strip(line);
    if (!t || /^(Accessory Power|Requires|Cost|Cooldown|Mana Cost|Kills)\b/i.test(t)) continue;
    const m = t.match(/^([A-Z][A-Za-z' ]{1,30}): \+(\d[\d,]*(?:\.\d+)?)%?(?:\s|$)/);
    if (m) { put(m[1].trim(), Number(m[2].replace(/,/g, ''))); continue; }
    for (const g of t.matchAll(/\+(\d[\d,]*(?:\.\d+)?)%?\s+([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})/g)) put(g[2], Number(g[1].replace(/,/g, '')));
  }
  return out;
}

/**
 * Линейка аксессуара: младшие и старшие версии, какие из них есть в сумке и работает ли этот экземпляр
 * (из одной линейки Magical Power даёт только старший). steps — вся линейка по порядку
 * с названием, редкостью, Magical Power и статами каждой ступени (карточка показывает, что прибавляется).
 */
export function accessoryFamily(id, bagIds, raw, items) {
  const up = upgradesFor(raw);
  const higher = up[id] || [];
  // младшие — от самой младшей: у неё больше всего старших версий
  const lower = Object.keys(up).filter(k => (up[k] || []).includes(id) && !higher.includes(k))
    .sort((a, b) => (up[b] || []).length - (up[a] || []).length);
  if (!higher.length && !lower.length) return null;
  const inBag = new Set(bagIds);
  const ownedHigher = higher.filter(h => inBag.has(h));
  const step = x => {
    const it = items?.get(x);
    const rarity = it?.rarity || null;
    return { id: x, name: displayName(x, items), rarity, mp: MP_BY_RARITY[rarity] || 0, stats: stepStats(it?.lore), inBag: inBag.has(x) };
  };
  return {
    lower: lower.map(x => ({ id: x, inBag: inBag.has(x) })),
    higher: higher.map(x => ({ id: x, inBag: inBag.has(x) })),
    steps: [...lower, id, ...higher].map(step),
    active: !ownedHigher.length,
    coveredBy: ownedHigher[0] || null,
    duplicates: lower.filter(x => inBag.has(x)),
  };
}

/**
 * Экземпляры предмета у игрока с чек-листом улучшений (до 12, дорогие первыми).
 * Для /api/item/:id/upgrades и /v1/players/{name}/profiles/{profile}/items/{id}/upgrades.
 */
export function itemUpgradeCopies(member, id, deps) {
  const { neu, priceOf, buyPriceOf, petPriceOf, translateLoreLine, translateLore } = deps;
  if (!member) return [];
  // Шаги — это покупки: цена покупки (Instant Buy), а своя старая версия при апгрейде продаётся по цене продажи
  const ctx = { constants: neu.constants, getItem: x => neu.items.get(x) || null, priceOf: buyPriceOf || priceOf, sellOf: priceOf, petPriceOf, member };
  const copies = [];
  if (/;\d$/.test(id)) {
    (member.pets || []).filter(p => p.id === id).forEach((p, i) => {
      copies.push({
        uuid: p.uuid || `pet-${i}`, where: p.active ? 'активный питомец' : 'меню питомцев', name: tx`[Ур. ${p.level}] ${neu.items.get(id)?.name?.replace(/^\[Lvl \{LVL\}\] /, '') || p.type}`,
        rarity: p.tier, value: petValue(p), level: p.level, plan: planItemUpgrades({ ...p, isPet: true }, ctx),
      });
    });
  } else {
    const seen = new Set();
    const bagIds = (member.inv?.talismans || []).filter(Boolean).map(t => t.id);
    const baseRarity = neu.items.get(id)?.rarity || null;
    for (const it of allStoredItems(member.inv || {})) {
      if (it.id !== id || (it.count || 1) > 1) continue;
      if (it.uuid && seen.has(it.uuid)) continue;
      if (it.uuid) seen.add(it.uuid);
      const vk = variantKey(it);
      const lot = vk && deps.binVar?.get(vk); // binVar меняется после каждого скана аукциона — читаем заново
      const plan = planItemUpgrades(it, ctx);
      copies.push({
        uuid: it.uuid || `${it.where}-${copies.length}`, where: it.where, name: it.name, rawName: it.rawName, rarity: it.rarity, value: itemValue(it),
        baseRarity: baseRarity && RARITIES.includes(baseRarity) ? baseRarity : null, recomb: !!it.recomb,
        // сданный в Museum (одолжен обратно) или Soulbound экземпляр продать нельзя: карточка так и пишет
        museum: !!it.museum, sellable: canSellCopy(it),
        market: lot ? { price: lot.price, count: lot.count || 0, recomb: !!it.recomb, stars: Number(it.stars || 0) } : null,
        bonus: currentBonus(it.id, it.lore || []),
        family: plan.kind === 'accessory' ? accessoryFamily(it.id, bagIds, neu.constants?.misc?.talisman_upgrades, neu.items) : null,
        // абзацами: многострочные описания переводятся словарём целиком, построчно они остаются на английском
        loreRu: translateLore ? translateLore(it.lore || []).lines : (it.lore || []).map(l => translateLoreLine(l)), plan,
      });
    }
  }
  copies.sort((a, b) => b.value - a.value);
  return copies.slice(0, 12);
}

/** @param getMember (req) → member выбранного игрока или null; deps — как у itemUpgradeCopies (binVar читается на каждом запросе) */
export function mountItemUpgradeRoutes(app, getMember, deps) {
  app.get('/api/item/:id/upgrades', async (req, res) => {
    const member = await getMember(req);
    res.json({ copies: itemUpgradeCopies(member, req.params.id, deps) });
  });
}
