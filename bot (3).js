// bot.js — Mario06 Crystal PvP Bot (HT1 Brain)
// Yêu cầu: node 18+, mineflayer, mineflayer-pathfinder, mineflayer-pvp, vec3, minecraft-data

const mineflayer = require('mineflayer')
const {
  pathfinder,
  Movements,
  goals: { GoalNear }
} = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const { Vec3 } = require('vec3')

const SERVER_HOST = process.env.SERVER_HOST || 'node1.lumine.asia'
const SERVER_PORT = Number(process.env.SERVER_PORT || 25675)
const AUTH_MODE   = process.env.AUTH_MODE   || 'offline'
const BOT_NAME    = 'Mario06'

// =======================
// Câu chat PvP
// =======================
const CHASE_LINES = ['?']

// =======================
// Layout hotbar cố định
// =======================
// Slot index 0–8 (hotbar slot 1–9)
const HOTBAR = {
  SWORD:        0,  // slot 1
  CRYSTAL:      1,  // slot 2
  OBSIDIAN:     2,  // slot 3
  PEARL:        3,  // slot 4
  GAPPLE:       4,  // slot 5
  ANCHOR:       5,  // slot 6
  GLOWSTONE:    6,  // slot 7
  TOTEM:        7,  // slot 8  ← main hand totem (off-hand luôn có totem khác)
  WATER_BUCKET: 8   // slot 9
}

// Item names tương ứng mỗi slot
const HOTBAR_ITEMS = {
  [HOTBAR.SWORD]:        ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword'],
  [HOTBAR.CRYSTAL]:      ['end_crystal'],
  [HOTBAR.OBSIDIAN]:     ['obsidian','crying_obsidian'],
  [HOTBAR.PEARL]:        ['ender_pearl'],
  [HOTBAR.GAPPLE]:       ['enchanted_golden_apple','golden_apple'],
  [HOTBAR.ANCHOR]:       ['respawn_anchor'],
  [HOTBAR.GLOWSTONE]:    ['glowstone'],
  [HOTBAR.TOTEM]:        ['totem_of_undying'],
  [HOTBAR.WATER_BUCKET]: ['water_bucket']
}

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
  const swordNames = ['netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword']
  return bot.inventory.items().find(it => swordNames.includes(it.name))
}

function hasCrystalStuff (bot) {
  return !!(findItem(bot, 'end_crystal') || findItem(bot, 'respawn_anchor'))
}

// =======================
// Hotbar scroll + equip như người thật
// =======================

// Scroll đến slot hotbar (0–8) với delay nhỏ như người thật
async function scrollToSlot (bot, slot) {
  try {
    if (bot.quickBarSlot === slot) return
    bot.setQuickBarSlot(slot)
    // Delay nhỏ giống người thật cuộn chuột
    await wait(40 + Math.floor(Math.random() * 30))
  } catch (_) {}
}

// Equip item bằng cách scroll hotbar đến đúng slot trước
async function hotbarEquip (bot, slotIndex) {
  try {
    await scrollToSlot(bot, slotIndex)
    // Không cần bot.equip() — setQuickBarSlot đã chọn slot rồi
  } catch (_) {}
}

// Sắp xếp inventory vào hotbar đúng vị trí khi spawn / respawn
async function setupHotbar (bot) {
  try {
    await wait(500) // đợi inventory load
    for (const [slotStr, names] of Object.entries(HOTBAR_ITEMS)) {
      const slotIndex = Number(slotStr)
      const item = bot.inventory.items().find(it => names.includes(it.name))
      if (!item) continue

      // Nếu item đã ở hotbar slot đó rồi thì bỏ qua
      const hotbarSlot = slotIndex // hotbar slot 0–8 = window slot 36–44
      const windowSlot = 36 + slotIndex
      const current = bot.inventory.slots[windowSlot]
      if (current && names.includes(current.name)) continue

      // Move item vào đúng hotbar slot
      try {
        await bot.inventory.move(item.slot, windowSlot)
        await wait(80 + Math.floor(Math.random() * 40))
      } catch (_) {}
    }
    console.log(`[${bot.username}] Hotbar đã setup xong!`)
  } catch (_) {}
}

// =======================
// Auto totem — luôn giữ totem ở offhand
// =======================

async function ensureOffhandTotem (bot) {
  try {
    // Kiểm tra offhand hiện tại
    const offhand = bot.inventory.slots[45] // slot 45 = offhand
    if (offhand && offhand.name === 'totem_of_undying') return

    const totem = findItem(bot, 'totem_of_undying')
    if (!totem) return

    await bot.equip(totem, 'off-hand')
    console.debug(`[${bot.username}] Totem offhand OK`)
  } catch (_) {}
}

// =======================
// Heal / auto-eat
// =======================

async function emergencyHeal (bot) {
  try {
    const hp = bot.health
    if (hp <= 0) return
    if (hp <= 8) {
      // Scroll về slot gapple trước
      await hotbarEquip(bot, HOTBAR.GAPPLE)
      const item = findItem(bot, ['enchanted_golden_apple','golden_apple']) || findFoodItem(bot)
      if (item) {
        bot.activateItem()
        setTimeout(() => {
          try { bot.deactivateItem() } catch (_) {}
          // Sau khi heal xong, scroll về sword và reset movement
          hotbarEquip(bot, HOTBAR.SWORD)
          try { bot.setControlState('sprint', true) } catch (_) {}
        }, 900)
      }
    }
  } catch (_) {}
}

function autoEatLoop (bot) {
  if (bot._autoEating) return
  bot._autoEating = true

  const eatTick = async () => {
    try {
      if (!bot._alive) return
      if (!bot.player || !bot.entity) return
      if (bot.health <= 0) return
      if (bot.food < 16) {
        const food = findFoodItem(bot)
        if (food) {
          await bot.equip(food, 'hand')
          bot.activateItem()
          setTimeout(() => { try { bot.deactivateItem() } catch (_) {} }, 900)
        }
      }
    } catch (_) {
    } finally {
      if (bot._alive) bot._eatTimer = setTimeout(eatTick, 1200)
    }
  }

  bot._eatTimer = setTimeout(eatTick, 1200)
}

// =======================
// Enemy / target
// =======================

function getNearestEnemyPlayer (bot, maxDistance) {
  let best = null
  let bestDist = maxDistance

  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!e || e.type !== 'player') continue
    if (!e.username || e.username === bot.username) continue
    if (!e.position) continue

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

    await hotbarEquip(bot, HOTBAR.PEARL)
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
    await hotbarEquip(bot, HOTBAR.WATER_BUCKET)

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
    if (!bot._endCrystalId) {
      if (!e.name || !e.name.toLowerCase().includes('crystal')) continue
    }
    const d = e.position.distanceTo(pos)
    if (d < bestDist) { bestDist = d; best = e }
  }
  return best
}

// =======================
// Crystal combo — sword hit → obsidian → crystal → nổ → sword
// =======================

async function crystalCombo (bot, target) {
  if (bot._crystalBusy) return
  if (!findItem(bot, ['obsidian','crying_obsidian'])) return
  if (!findItem(bot, 'end_crystal')) return

  const dist = bot.entity.position.distanceTo(target.position)
  if (dist > 7) return

  const offsets = [
    new Vec3(0,-1,0),
    new Vec3(1,-1,0), new Vec3(-1,-1,0),
    new Vec3(0,-1,1), new Vec3(0,-1,-1)
  ]

  bot._crystalBusy = true
  try {
    const feet = target.position.floored()

    // 1. Sword hit trước — knockback đẩy target vào blast radius
    await hotbarEquip(bot, HOTBAR.SWORD)
    await bot.lookAt(target.position.offset(0, 1.6, 0), true)
    bot.attack(target)
    await wait(55 + Math.floor(Math.random() * 25))

    // 2. Đặt obsidian + crystal ngay sau knockback
    for (const off of offsets) {
      const baseBlock = bot.blockAt(feet.offset(off.x, off.y, off.z))
      if (!baseBlock || baseBlock.boundingBox !== 'block') continue

      const topPos   = feet.offset(off.x, off.y + 1, off.z)
      const topBlock = bot.blockAt(topPos)
      if (topBlock && topBlock.boundingBox === 'block') continue

      // Obsidian
      await hotbarEquip(bot, HOTBAR.OBSIDIAN)
      await bot.lookAt(baseBlock.position.offset(0.5, 1, 0.5), true)
      try { await bot.placeBlock(baseBlock, new Vec3(0, 1, 0)) } catch (_) {}
      await wait(150)

      const placedObs = bot.blockAt(topPos)
      if (!placedObs || !placedObs.name.includes('obsidian')) continue

      // Crystal
      await hotbarEquip(bot, HOTBAR.CRYSTAL)
      await bot.lookAt(placedObs.position.offset(0.5, 1, 0.5), true)
      try { await bot.placeBlock(placedObs, new Vec3(0, 1, 0)) } catch (_) {}
      await wait(150)

      // 3. Đánh nổ crystal
      const crystal = getNearestCrystalEntity(bot, placedObs.position.offset(0.5, 1, 0.5), 4)
      if (crystal) bot.attack(crystal)

      // 4. Về sword tiếp tục đánh
      await hotbarEquip(bot, HOTBAR.SWORD)
      // Reset movement để bot không bị đứng im sau combo
      try { bot.setControlState('sprint', true); bot.setControlState('jump', true) } catch (_) {}
      break
    }
  } catch (err) {
    console.debug(`[${bot.username}] crystalCombo err:`, err.message)
  } finally {
    bot._crystalBusy = false
    // Luôn reset movement khi combo kết thúc (kể cả khi lỗi)
    try { bot.setControlState('sprint', true); bot.setControlState('jump', true) } catch (_) {}
  }
}

// =======================
// Anchor combo — sword hit → obsidian → anchor → glowstone nổ → totem → sword
// =======================

async function anchorCombo (bot, target) {
  if (bot._anchorBusy) return
  if (!findItem(bot, 'respawn_anchor')) return
  if (!findItem(bot, 'glowstone')) return

  const dist = bot.entity.position.distanceTo(target.position)
  if (dist > 7) return

  bot._anchorBusy = true
  try {
    const feet      = target.position.floored()
    const baseBelow = bot.blockAt(feet.offset(0, -1, 0))
    if (!baseBelow) return

    // 1. Sword hit trước — knockback đẩy target đúng chỗ
    await hotbarEquip(bot, HOTBAR.SWORD)
    await bot.lookAt(target.position.offset(0, 1.6, 0), true)
    bot.attack(target)
    await wait(55 + Math.floor(Math.random() * 25))

    // 2. Đặt obsidian làm nền (anchor cần đặt trên solid block)
    const obsidian = findItem(bot, ['obsidian','crying_obsidian'])
    if (obsidian) {
      await hotbarEquip(bot, HOTBAR.OBSIDIAN)
      await bot.lookAt(baseBelow.position.offset(0.5, 1, 0.5), true)
      try { await bot.placeBlock(baseBelow, new Vec3(0, 1, 0)) } catch (_) {}
      await wait(150)
    }

    // 3. Đặt anchor lên
    await hotbarEquip(bot, HOTBAR.ANCHOR)
    const obsBase = bot.blockAt(feet.offset(0, -1, 0))
    await bot.lookAt(feet.offset(0.5, 0, 0.5), true)
    try { await bot.placeBlock(obsBase, new Vec3(0, 1, 0)) } catch (_) {}
    await wait(180)

    const anchorBlock = bot.blockAt(feet)
    if (!anchorBlock || anchorBlock.name !== 'respawn_anchor') return

    // Không kích nổ nếu bot đứng quá gần
    if (bot.entity.position.distanceTo(anchorBlock.position) < 3) return

    // 4. Glowstone kích nổ
    await hotbarEquip(bot, HOTBAR.GLOWSTONE)
    await bot.lookAt(anchorBlock.position.offset(0.5, 0.5, 0.5), true)
    await bot.activateBlock(anchorBlock)
    await wait(100)

    // 5. Scroll về totem main hand (offhand totem vẫn active — 2 totem bảo vệ)
    await hotbarEquip(bot, HOTBAR.TOTEM)
    await wait(60)

    // 6. Về sword tiếp tục đánh
    await hotbarEquip(bot, HOTBAR.SWORD)
    // Reset movement để bot không bị đứng im sau combo
    try { bot.setControlState('sprint', true); bot.setControlState('jump', true) } catch (_) {}

  } catch (err) {
    console.debug(`[${bot.username}] anchorCombo err:`, err.message)
  } finally {
    bot._anchorBusy = false
    // Luôn reset movement khi combo kết thúc (kể cả khi lỗi)
    try { bot.setControlState('sprint', true); bot.setControlState('jump', true) } catch (_) {}
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
    if (!findItem(bot, 'bow')) return
    if (!findItem(bot, ['arrow','tipped_arrow'])) return
    await bot.equip(findItem(bot, 'bow'), 'hand')
    await bot.lookAt(target.position.offset(0, 1.4, 0), true)
    bot.activateItem()
    setTimeout(() => { try { bot.deactivateItem() } catch (_) {} }, 450)
    setTimeout(() => { hotbarEquip(bot, HOTBAR.SWORD) }, 500)
  } catch (_) {}
}

// =======================
// Pathfinder chase
// =======================

function chaseWithPathfinder (bot, target) {
  try {
    const goal = new GoalNear(target.position.x, target.position.y, target.position.z, 4)
    bot.pathfinder.setGoal(goal)
  } catch (_) {}
}

// =======================
// Não HT1 Crystal "điên"
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

  // Auto totem khi inventory thay đổi (nhặt totem, craft, v.v.)
  bot.on('playerCollect', async (collector) => {
    ensureOffhandTotem(bot)
    // Nếu chính bot nhặt đồ → re-setup hotbar để đồ nhặt vào đúng slot
    if (collector && collector.username === bot.username) {
      await wait(300)
      await setupHotbar(bot)
    }
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
    await setupHotbar(bot)
    await ensureOffhandTotem(bot)
  })

  autoEatLoop(bot)

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
      if (!bot.pvp.target || bot.pvp.target.id !== target.id) {
        bot.pvp.attack(target)
      }

      bot.lookAt(target.position.offset(0, 1.6, 0), true).catch(() => {})

      const dist             = bot.entity.position.distanceTo(target.position)
      const haveCrystalStuff = hasCrystalStuff(bot)

      if (dist < 7) {
        // Cận chiến — scroll về sword
        hotbarEquip(bot, HOTBAR.SWORD)
        bot.setControlState('jump', true)
        bot.setControlState('sprint', true)

        if (now > state.nextWTap) {
          state.nextWTap = now + (rage ? 400 : 600)
          bot.setControlState('sprint', false)
          setTimeout(() => { try { bot.setControlState('sprint', true) } catch (_) {} }, 120)
        }

        if (haveCrystalStuff) {
          const crystalCd = rage ? 160 : 320
          const anchorCd  = rage ? 260 : 520
          if (now - state.lastCrystalCombo > crystalCd) {
            state.lastCrystalCombo = now
            crystalCombo(bot, target)
          }
          if (now - state.lastAnchorCombo > anchorCd && Math.random() < (rage ? 0.75 : 0.4)) {
            state.lastAnchorCombo = now
            anchorCombo(bot, target)
          }
        }
      } else {
        bot.setControlState('jump', false)
        if (dist <= 80) {
          // Khoảng cách 7–80: sprint thẳng vào target, không cần pathfinder
          bot.setControlState('sprint', true)
          try { bot.pathfinder.setGoal(null) } catch (_) {}
        } else if (dist > 80 && dist < 300) {
          bot.setControlState('sprint', true)
          chaseWithPathfinder(bot, target)
        } else if (dist >= 300) {
          bot.setControlState('sprint', false)
        }
      }

      useBuffPotion(bot)

      if (state.lastDist !== null) {
        const diff          = dist - state.lastDist
        const isRunningAway = diff > 2 && dist > 10

        if (isRunningAway) {
          state.rageUntil = now + 6000

          if (now - state.lastChat > 4000) {
            state.lastChat = now
            bot.chat(randChoice(CHASE_LINES))
          }

          const pearlCd = rage ? 900 : 1600
          if (now - state.lastPearl > pearlCd) {
            state.lastPearl = now
            throwPearlAt(bot, target)
          }

          if (haveCrystalStuff) {
            const runCrystalCd = rage ? 220 : 380
            const runAnchorCd  = rage ? 260 : 480
            if (now - state.lastCrystalCombo > runCrystalCd && Math.random() < 0.9) {
              state.lastCrystalCombo = now
              crystalCombo(bot, target)
            }
            if (now - state.lastAnchorCombo > runAnchorCd && Math.random() < 0.9) {
              state.lastAnchorCombo = now
              anchorCombo(bot, target)
            }
          }
        }
      }
      state.lastDist = dist

      if (dist > 12 && dist < 80 && now - state.lastPearl > (rage ? 1200 : 2500)) {
        state.lastPearl = now
        throwPearlAt(bot, target)
      }

      if (isEntityInWeb(bot, target) && now - state.lastBow > 1000) {
        state.lastBow = now
        shootBowAt(bot, target)
      }

    } else {
      if (bot.pvp && bot.pvp.target) bot.pvp.stop()
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      bot._combatState.lastDist = null
    }

    if (isBotInWeb(bot)) escapeWebWithWater(bot)

  }, 300)
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

    // Setup hotbar + totem trước khi bật brain
    await setupHotbar(bot)
    await ensureOffhandTotem(bot)

    setupHT1CrystalBrain(bot)
  })

  bot.on('kicked', r => console.log(`[${name}] bị kick:`, r))
  bot.on('error',  e => console.log(`[${name}] lỗi:`, e.message))

  bot.on('end', reason => {
    console.log(`[${name}] mất kết nối (${reason}), đang reconnect...`)
    bot._alive = false
    if (bot._mainInterval) clearInterval(bot._mainInterval)
    if (bot._eatTimer)     clearTimeout(bot._eatTimer)
    const delay = 10000 + Math.floor(Math.random() * 20000)
    setTimeout(() => createBot(name), delay)
  })

  return bot
}

// =======================
// Start
// =======================

createBot(BOT_NAME)
