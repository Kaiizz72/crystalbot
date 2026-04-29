// bot.js — Mario06 Crystal PvP Bot (HT1 Brain) — Optimized
// Yêu cầu: node 18+, mineflayer, mineflayer-pathfinder, mineflayer-pvp, vec3, minecraft-data

const mineflayer = require('mineflayer')
const {
  pathfinder,
  Movements,
  goals: { GoalNear }
} = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const { Vec3 } = require('vec3')

const SERVER_HOST = process.env.SERVER_HOST || '83.168.94.238'
const SERVER_PORT = Number(process.env.SERVER_PORT || 30144)
const AUTH_MODE   = process.env.AUTH_MODE   || 'offline'
const BOT_NAME    = 'Mario06'

const CHASE_LINES = ['?']

// =======================
// Helper chung
// =======================

function wait (ms) {
  return new Promise(res => setTimeout(res, ms))
}

function randChoice (arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function findItem (bot, names) {
  const list = Array.isArray(names) ? names : [names]
  return bot.inventory.items().find(it => list.includes(it.name))
}

function findFoodItem (bot) {
  const foodNames = [
    'cooked_beef','cooked_porkchop','cooked_chicken',
    'bread','cooked_mutton','cooked_rabbit',
    'baked_potato','cooked_cod','cooked_salmon','pumpkin_pie'
  ]
  return bot.inventory.items().find(it => foodNames.includes(it.name))
}

function findSword (bot) {
  return bot.inventory.items().find(it =>
    ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword'].includes(it.name)
  )
}

function hasCrystalStuff (bot) {
  return !!(findItem(bot, 'end_crystal') || findItem(bot, 'respawn_anchor'))
}

// Equip nhanh — dùng bot.equip() thẳng, không cần scroll hotbar
async function quickEquip (bot, names, hand = 'hand') {
  try {
    const item = findItem(bot, Array.isArray(names) ? names : [names])
    if (!item) return false
    await bot.equip(item, hand)
    return true
  } catch (_) { return false }
}

// =======================
// Auto totem offhand
// =======================

async function ensureOffhandTotem (bot) {
  try {
    const offhand = bot.inventory.slots[45]
    if (offhand && offhand.name === 'totem_of_undying') return
    const totem = findItem(bot, 'totem_of_undying')
    if (!totem) return
    await bot.equip(totem, 'off-hand')
  } catch (_) {}
}

// =======================
// Heal / auto-eat
// =======================

async function emergencyHeal (bot) {
  try {
    const hp = bot.health
    if (hp <= 0 || hp > 8) return
    if (bot._healing) return  // tránh spam
    bot._healing = true

    const SWORDS = ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword']
    const ok = await quickEquip(bot, ['enchanted_golden_apple','golden_apple'])
    if (!ok) {
      const food = findFoodItem(bot)
      if (food) await quickEquip(bot, [food.name])
    }
    bot.activateItem()
    // Sprint vẫn bật trong khi ăn — không đứng im
    try { bot.setControlState('sprint', true) } catch (_) {}

    setTimeout(async () => {
      bot._healing = false
      try { bot.deactivateItem() } catch (_) {}
      try { await quickEquip(bot, SWORDS) } catch (_) {}
      try { bot.setControlState('sprint', true) } catch (_) {}
    }, 900)
  } catch (_) { bot._healing = false }
}

function autoEatLoop (bot) {
  if (bot._autoEating) return
  bot._autoEating = true

  const SWORDS = ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword']

  const eatTick = async () => {
    try {
      if (!bot._alive || !bot.player || !bot.entity || bot.health <= 0) return
      // Chỉ ăn khi KHÔNG có target gần (không ăn giữa trận — gây đứng im)
      const hasNearbyEnemy = getNearestEnemyPlayer(bot, 20)
      if (bot.food < 16 && !hasNearbyEnemy) {
        const food = findFoodItem(bot)
        if (food) {
          await bot.equip(food, 'hand')
          bot.activateItem()
          setTimeout(async () => {
            try { bot.deactivateItem() } catch (_) {}
            // Restore sword + sprint sau khi ăn xong
            try { await quickEquip(bot, SWORDS) } catch (_) {}
            try { bot.setControlState('sprint', true) } catch (_) {}
          }, 900)
        }
      }
    } catch (_) {
    } finally {
      if (bot._alive) bot._eatTimer = setTimeout(eatTick, 1500)
    }
  }

  bot._eatTimer = setTimeout(eatTick, 1500)
}

// =======================
// Enemy / target
// =======================

function getNearestEnemyPlayer (bot, maxDistance) {
  let best = null
  let bestDist = maxDistance
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!e || e.type !== 'player' || !e.username || e.username === bot.username || !e.position) continue
    const dist = bot.entity.position.distanceTo(e.position)
    if (dist < bestDist) { best = e; bestDist = dist }
  }
  return best
}

function isEntityInWeb (bot, entity) {
  if (!entity || !entity.position) return false
  const block = bot.blockAt(entity.position.offset(0, 0.1, 0))
  return !!(block && block.name && block.name.includes('web'))
}

function isBotInWeb (bot) {
  return isEntityInWeb(bot, bot.entity)
}

// =======================
// Pearl
// =======================

async function throwPearlAt (bot, target) {
  try {
    if (!findItem(bot, 'ender_pearl')) return
    const dist    = bot.entity.position.distanceTo(target.position)
    const yOffset = 1.5 + Math.max(0, (dist - 15) * 0.05)
    await quickEquip(bot, 'ender_pearl')
    await bot.lookAt(target.position.offset(0, yOffset, 0), true)
    bot.activateItem()
  } catch (_) {}
}

// =======================
// Water bucket thoát tơ
// =======================

async function escapeWebWithWater (bot) {
  try {
    if (bot._escapingWeb) return
    if (!findItem(bot, 'water_bucket')) return
    bot._escapingWeb = true
    await quickEquip(bot, 'water_bucket')
    const feet = bot.entity.position.floored()
    const below = bot.blockAt(feet.offset(0, -1, 0))
    if (below) {
      await bot.lookAt(below.position.offset(0.5, 1, 0.5), true)
      await bot.placeBlock(below, new Vec3(0, 1, 0))
    }
    setTimeout(async () => {
      try {
        const bucket = findItem(bot, 'bucket')
        if (!bucket) return
        const water = bot.findBlock({ matching: b => b && b.name === 'water', maxDistance: 5 })
        if (water) {
          await bot.equip(bucket, 'hand')
          await bot.lookAt(water.position.offset(0.5, 0.5, 0.5), true)
          await bot.activateBlock(water)
        }
      } catch (_) {
      } finally {
        bot._escapingWeb = false
      }
    }, 1200)
  } catch (_) {
    bot._escapingWeb = false
  }
}

// =======================
// Crystal entity
// =======================

function getNearestCrystalEntity (bot, pos, radius) {
  let best = null
  let bestDist = radius
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!e || !e.position) continue
    if (bot._endCrystalId && e.entityType !== bot._endCrystalId) continue
    if (!bot._endCrystalId && (!e.name || !e.name.toLowerCase().includes('crystal'))) continue
    const d = e.position.distanceTo(pos)
    if (d < bestDist) { bestDist = d; best = e }
  }
  return best
}

// =======================
// Crystal combo — vanilla tầm đánh ≤ 3 block
// =======================

async function crystalCombo (bot, target) {
  if (bot._crystalBusy) return
  if (!findItem(bot, ['obsidian','crying_obsidian'])) return
  if (!findItem(bot, 'end_crystal')) return

  const dist = bot.entity.position.distanceTo(target.position)
  if (dist > 3.5) return

  const offsets = [
    new Vec3(0,-1,0),
    new Vec3(1,-1,0), new Vec3(-1,-1,0),
    new Vec3(0,-1,1), new Vec3(0,-1,-1)
  ]

  bot._crystalBusy = true
  try {
    const feet = target.position.floored()

    // 1. Sword hit — knockback
    await quickEquip(bot, ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword'])
    await bot.lookAt(target.position.offset(0, 1.6, 0), true)
    bot.attack(target)
    await wait(60)

    // 2. Đặt obsidian + crystal
    for (const off of offsets) {
      const baseBlock = bot.blockAt(feet.offset(off.x, off.y, off.z))
      if (!baseBlock || baseBlock.boundingBox !== 'block') continue

      const topPos   = feet.offset(off.x, off.y + 1, off.z)
      const topBlock = bot.blockAt(topPos)
      if (topBlock && topBlock.boundingBox === 'block') continue

      // Obsidian
      await quickEquip(bot, ['obsidian','crying_obsidian'])
      await bot.lookAt(baseBlock.position.offset(0.5, 1, 0.5), true)
      try { await bot.placeBlock(baseBlock, new Vec3(0, 1, 0)) } catch (_) {}
      await wait(80)

      const placedObs = bot.blockAt(topPos)
      if (!placedObs || !placedObs.name.includes('obsidian')) continue

      // Crystal — nhìn vào mặt trên obsidian để đặt
      await quickEquip(bot, 'end_crystal')
      await bot.lookAt(placedObs.position.offset(0.5, 1, 0.5), true)
      try { await bot.placeBlock(placedObs, new Vec3(0, 1, 0)) } catch (_) {}

      // 3. Đợi server spawn crystal entity (~1-2 tick), rồi nhìn thẳng vào crystal và đánh nổ
      await wait(80)
      const crystalSpawnPos = placedObs.position.offset(0.5, 1, 0.5)
      const crystal = getNearestCrystalEntity(bot, crystalSpawnPos, 5)
      if (crystal) {
        await bot.lookAt(crystal.position, true)
        bot.attack(crystal)
      } else {
        await bot.lookAt(crystalSpawnPos, true)
        bot.swingArm()
      }

      // 4. Về sword ngay, không await lookAt để không chặn movement
      quickEquip(bot, ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword'])
      bot.setControlState('sprint', true)
      bot.setControlState('jump', true)
      break
    }
  } catch (err) {
    console.debug(`[${bot.username}] crystalCombo err:`, err.message)
  } finally {
    bot._crystalBusy = false
    bot.setControlState('sprint', true)
    bot.setControlState('jump', true)
  }
}

// =======================
// Anchor combo — vanilla tầm đánh ≤ 3 block
// =======================

async function anchorCombo (bot, target) {
  if (bot._anchorBusy) return
  if (!findItem(bot, 'respawn_anchor')) return
  if (!findItem(bot, 'glowstone')) return

  const dist = bot.entity.position.distanceTo(target.position)
  if (dist > 3.5) return

  bot._anchorBusy = true
  try {
    const feet      = target.position.floored()
    const baseBelow = bot.blockAt(feet.offset(0, -1, 0))
    if (!baseBelow) return

    // 1. Sword hit
    await quickEquip(bot, ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword'])
    await bot.lookAt(target.position.offset(0, 1.6, 0), true)
    bot.attack(target)
    await wait(60)

    // 2. Obsidian nền
    if (findItem(bot, ['obsidian','crying_obsidian'])) {
      await quickEquip(bot, ['obsidian','crying_obsidian'])
      await bot.lookAt(baseBelow.position.offset(0.5, 1, 0.5), true)
      try { await bot.placeBlock(baseBelow, new Vec3(0, 1, 0)) } catch (_) {}
      await wait(80)
    }

    // 3. Anchor
    await quickEquip(bot, 'respawn_anchor')
    const obsBase = bot.blockAt(feet.offset(0, -1, 0))
    await bot.lookAt(feet.offset(0.5, 0, 0.5), true)
    try { await bot.placeBlock(obsBase, new Vec3(0, 1, 0)) } catch (_) {}
    await wait(120)

    const anchorBlock = bot.blockAt(feet)
    if (!anchorBlock || anchorBlock.name !== 'respawn_anchor') return

    if (bot.entity.position.distanceTo(anchorBlock.position) < 3) return

    // 4. Glowstone kích nổ — nhìn vào anchor block
    await quickEquip(bot, 'glowstone')
    await bot.lookAt(anchorBlock.position.offset(0.5, 0.5, 0.5), true)
    await bot.activateBlock(anchorBlock)
    await wait(60)

    // 5. Totem main hand bảo vệ
    quickEquip(bot, 'totem_of_undying')
    await wait(40)

    // 6. Về sword + quay mặt về target ngay
    quickEquip(bot, ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword'])
    bot.lookAt(target.position.offset(0, 1.6, 0), true).catch(() => {})
    bot.setControlState('sprint', true)
    bot.setControlState('jump', true)

  } catch (err) {
    console.debug(`[${bot.username}] anchorCombo err:`, err.message)
  } finally {
    bot._anchorBusy = false
    bot.setControlState('sprint', true)
    bot.setControlState('jump', true)
  }
}

// =======================
// Potion / bow
// =======================

async function useBuffPotion (bot) {
  try {
    const now = Date.now()
    if (bot._lastPotion && now - bot._lastPotion < 7000) return
    const pot = findItem(bot, ['splash_potion','lingering_potion'])
    if (!pot) return
    bot._lastPotion = now
    await bot.equip(pot, 'hand')
    bot.activateItem()
    setTimeout(() => { try { bot.deactivateItem() } catch (_) {} }, 850)
  } catch (_) {}
}

async function shootBowAt (bot, target) {
  try {
    if (!findItem(bot, 'bow') || !findItem(bot, ['arrow','tipped_arrow'])) return
    await quickEquip(bot, 'bow')
    await bot.lookAt(target.position.offset(0, 1.4, 0), true)
    bot.activateItem()
    setTimeout(() => { try { bot.deactivateItem() } catch (_) {} }, 450)
    setTimeout(() => {
      quickEquip(bot, ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword'])
    }, 500)
  } catch (_) {}
}

// =======================
// Pathfinder chase
// =======================

function chaseWithPathfinder (bot, target) {
  try {
    const goal = new GoalNear(target.position.x, target.position.y, target.position.z, 2)
    bot.pathfinder.setGoal(goal)
  } catch (_) {}
}

// =======================
// Não HT1 Crystal
// =======================

function setupHT1CrystalBrain (bot) {
  bot._combatState = {
    lastPearl: 0,
    lastBow: 0,
    lastDist: null,
    lastChat: 0,
    nextWTap: 0,
    lastCrystalCombo: 0,
    lastAnchorCombo: 0,
    rageUntil: 0
  }

  bot.on('health', () => {
    emergencyHeal(bot)
    ensureOffhandTotem(bot)
  })

  bot.on('death', () => {
    bot.setControlState('jump', false)
    bot.setControlState('sprint', false)
    if (bot.pvp && bot.pvp.target) bot.pvp.stop()
  })

  bot.on('respawn', async () => {
    console.log(`[${bot.username}] respawned, đang setup lại...`)
    bot._homePos = bot.entity.position.clone()
    bot._combatState.lastDist  = null
    bot._combatState.rageUntil = Date.now() + 4000
    await ensureOffhandTotem(bot)
  })

  autoEatLoop(bot)

  const swords = ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword']

  // Watchdog: force sprint/jump mỗi 300ms nếu có target gần — chống đứng im từ bất kỳ nguyên nhân nào
  bot._watchdog = setInterval(() => {
    try {
      if (!bot.entity || !bot.entity.position || !bot._alive) return
      const target = getNearestEnemyPlayer(bot, 1000)
      if (!target) return
      const dist = bot.entity.position.distanceTo(target.position)
      if (dist <= 80) {
        bot.setControlState('sprint', true)
        if (dist <= 3.5) bot.setControlState('jump', true)
      }
    } catch (_) {}
  }, 300)

  bot._mainInterval = setInterval(() => {
    if (!bot.entity || !bot.entity.position) return

    const now   = Date.now()
    const state = bot._combatState
    const hp    = bot.health
    const rage  = hp > 12 || (state.rageUntil && now < state.rageUntil)

    // Giới hạn 1000 block từ home
    if (bot._homePos) {
      const homeDist = bot.entity.position.distanceTo(bot._homePos)
      if (homeDist > 1000) {
        if (bot.pvp && bot.pvp.target) bot.pvp.stop()
        bot.setControlState('jump', false)
        bot.setControlState('sprint', false)
        chaseWithPathfinder(bot, { position: bot._homePos })
        return
      }
    }

    let target = getNearestEnemyPlayer(bot, 1000)
    if (target && bot._homePos) {
      if (target.position.distanceTo(bot._homePos) > 1000) target = null
    }

    if (target) {
      // Dùng pvp chỉ để swing/attack — KHÔNG để pvp.attack() quản lý movement/pathfinder
      if (!bot.pvp.target || bot.pvp.target.id !== target.id) {
        // Stop pvp trước để nó không can thiệp movement
        try { if (bot.pvp.target) bot.pvp.stop() } catch (_) {}
        bot.pvp.attack(target)
      }

      const dist             = bot.entity.position.distanceTo(target.position)
      const haveCrystalStuff = hasCrystalStuff(bot)
      const inCombo          = bot._crystalBusy || bot._anchorBusy

      // lookAt chỉ khi không combo (combo tự quản lý hướng nhìn)
      if (!inCombo) {
        bot.lookAt(target.position.offset(0, 1.6, 0), true).catch(() => {})
      }

      // Movement LUÔN chạy — bot không đứng im khi đang combo
      if (dist <= 3.5) {
        bot.setControlState('jump', true)
        bot.setControlState('sprint', true)

        if (!inCombo) {
          quickEquip(bot, swords)

          if (now > state.nextWTap) {
            state.nextWTap = now + (rage ? 400 : 600)
            bot.setControlState('sprint', false)
            setTimeout(() => { try { bot.setControlState('sprint', true) } catch (_) {} }, 100)
          }

          if (haveCrystalStuff) {
            const crystalCd = rage ? 180 : 350
            const anchorCd  = rage ? 280 : 550
            if (now - state.lastCrystalCombo > crystalCd) {
              state.lastCrystalCombo = now
              crystalCombo(bot, target)
            }
            if (now - state.lastAnchorCombo > anchorCd && Math.random() < (rage ? 0.75 : 0.4)) {
              state.lastAnchorCombo = now
              anchorCombo(bot, target)
            }
          }

          useBuffPotion(bot)

          if (dist > 12 && dist < 80 && now - state.lastPearl > (rage ? 1200 : 2500)) {
            state.lastPearl = now
            throwPearlAt(bot, target)
          }

          if (isEntityInWeb(bot, target) && now - state.lastBow > 1000) {
            state.lastBow = now
            shootBowAt(bot, target)
          }
        }
      } else {
        bot.setControlState('jump', false)
        if (dist <= 80) {
          bot.setControlState('sprint', true)
          try { bot.pathfinder.setGoal(null) } catch (_) {}
        } else if (dist <= 300) {
          bot.setControlState('sprint', true)
          chaseWithPathfinder(bot, target)
        } else {
          bot.setControlState('sprint', false)
        }

        if (!inCombo) {
          useBuffPotion(bot)
          if (dist > 12 && dist < 80 && now - state.lastPearl > (rage ? 1200 : 2500)) {
            state.lastPearl = now
            throwPearlAt(bot, target)
          }
          if (isEntityInWeb(bot, target) && now - state.lastBow > 1000) {
            state.lastBow = now
            shootBowAt(bot, target)
          }
        }
      }

      // Detect target chạy — chạy cả khi đang combo
      if (state.lastDist !== null) {
        const isRunningAway = (dist - state.lastDist) > 2 && dist > 10
        if (isRunningAway) {
          state.rageUntil = now + 6000
          if (now - state.lastChat > 4000) {
            state.lastChat = now
            bot.chat(randChoice(CHASE_LINES))
          }
          if (!inCombo && now - state.lastPearl > (rage ? 900 : 1600)) {
            state.lastPearl = now
            throwPearlAt(bot, target)
          }
        }
      }
      state.lastDist = dist

    } else {
      if (bot.pvp && bot.pvp.target) bot.pvp.stop()
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      bot._combatState.lastDist = null
    }

    if (isBotInWeb(bot)) escapeWebWithWater(bot)

  }, 250) // tick 250ms — nhanh hơn 300ms cũ
}

// =======================
// Tạo bot
// =======================

function createBot (name) {
  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: name,
    auth: AUTH_MODE,
    keepAlive: true,
    checkTimeoutInterval: 600000
  })

  bot._alive = true
  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)

  bot.once('spawn', async () => {
    console.log(`[${name}] đã vào server! HT1 CRYSTAL BRAIN bật!`)

    const mcData = require('minecraft-data')(bot.version)
    bot._mcData  = mcData

    const crystalDef  = mcData.entitiesByName.end_crystal || mcData.entitiesByName.ender_crystal
    bot._endCrystalId = crystalDef ? crystalDef.id : null

    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)

    bot._homePos = bot.entity.position.clone()

    await ensureOffhandTotem(bot)
    setupHT1CrystalBrain(bot)
  })

  bot.on('kicked', r => console.log(`[${name}] bị kick:`, r))
  bot.on('error',  e => console.log(`[${name}] lỗi:`, e.message))

  bot.on('end', reason => {
    console.log(`[${name}] mất kết nối (${reason}), đang reconnect...`)
    bot._alive = false
    if (bot._mainInterval) clearInterval(bot._mainInterval)
    if (bot._watchdog)     clearInterval(bot._watchdog)
    if (bot._eatTimer)     clearTimeout(bot._eatTimer)
    const delay = 10000 + Math.floor(Math.random() * 20000)
    setTimeout(() => createBot(name), delay)
  })

  return bot
}

createBot(BOT_NAME)
