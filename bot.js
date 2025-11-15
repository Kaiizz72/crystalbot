// bot.js — HT1 Crystal PvP bots "điên loạn" + fallback kiếm (tầm nhìn 1000 block)
// Yêu cầu: node 18+, mineflayer 4.31+, pathfinder, pvp, vec3

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
const AUTH_MODE = process.env.AUTH_MODE || 'offline'

// =======================
// Danh sách bot
// =======================

const BOT_NAMES = [
  'Dream', 'Marlow', 'MrBeast',
  'xCrystal', 'TrumCrytal', 'BoMayChapHet', 'MayChemTQ', 'MeoCuNho', 'Pundangyeu', 'Tai2k8',

  'xPVP2', 'CauBeNgoc', 'MayChemHaTinh', 'Memaybel', 'Bomaychaphet', 'noomn', 'tretraumc', 'Phu2k8', 'LinhDepGai',
  'CryGod', 'CrystalVN', 'TryHarder', 'KillauraGia', 'ComboLord', 'RefillPro', 'HeadShotVN', 'DragClicker', 'WtapGod', 'JitterKing',
  'SweatAsia', 'HitRegOK', 'Click36cps', 'LegitButOP', 'FakeCheater', 'Ping1ms', 'Ping200ms', 'LagButPro', 'NetheriteKing', 'DiamondKid',
  'SoupPvPer', 'PotPvPer', 'AnchorMain', 'TotemAbuser', 'FFAEnjoyer', 'QueueWarrior', 'RankGrinder', 'SkybridgeKid', 'BoxPvPKing', 'ArenaTryhard',
  'CrystalRunner'
]

// Team bạn: 3 thằng này không đánh nhau
const TEAM_FRIENDS = ['Dream', 'Marlow', 'MrBeast']

function sameTeam (nameA, nameB) {
  if (TEAM_FRIENDS.includes(nameA) && TEAM_FRIENDS.includes(nameB)) return true
  return false
}

// Câu chat PvP
const CHASE_LINES = [
  "?"
]

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
    'cooked_beef',
    'cooked_porkchop',
    'cooked_chicken',
    'bread',
    'cooked_mutton',
    'cooked_rabbit',
    'baked_potato',
    'cooked_cod',
    'cooked_salmon',
    'pumpkin_pie'
  ]
  return bot.inventory.items().find(it => foodNames.includes(it.name))
}

function findSword (bot) {
  const swordNames = [
    'netherite_sword',
    'diamond_sword',
    'iron_sword',
    'stone_sword',
    'golden_sword',
    'wooden_sword'
  ]
  return bot.inventory.items().find(it => list.includes(it.name))
}

async function equipSword (bot) {
  try {
    const sword = findSword(bot)
    if (sword) await bot.equip(sword, 'hand')
  } catch (_) {}
}

// Check còn crystal/anchor không
function hasCrystalStuff (bot) {
  const crystalItem = findItem(bot, 'end_crystal')
  const anchorItem = findItem(bot, 'respawn_anchor')
  return !!(crystalItem || anchorItem)
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

    // Không đánh nếu cùng team (Dream/Marlow/MrBeast với nhau)
    if (sameTeam(bot.username, e.username)) continue

    const dist = bot.entity.position.distanceTo(e.position)
    if (dist < bestDist) {
      best = e
      bestDist = dist
    }
  }

  return best
}

function isEntityInWeb (bot, entity) {
  if (!entity || !entity.position) return false
  const feet = entity.position.offset(0, 0.1, 0)
  const block = bot.blockAt(feet)
  if (!block) return false
  return block.name && block.name.includes('web')
}

function isBotInWeb (bot) {
  return isEntityInWeb(bot, bot.entity)
}

// =======================
// Totem / heal / auto-eat
// =======================

async function ensureOffhandTotem (bot) {
  try {
    const totem = findItem(bot, ['totem_of_undying', 'totem'])
    if (totem) await bot.equip(totem, 'off-hand')
  } catch (_) {}
}

async function emergencyHeal (bot) {
  try {
    const hp = bot.health
    if (hp <= 0) return

    // Giữ trên 3 tim: <= 8 máu là ăn ngay
    if (hp <= 8) {
      const gapple = findItem(bot, ['enchanted_golden_apple', 'golden_apple'])
      const food = findFoodItem(bot)
      const item = gapple || food
      if (item) {
        await bot.equip(item, 'hand')
        bot.activateItem()
        setTimeout(() => {
          try { bot.deactivateItem() } catch (_) {}
        }, 900)
      }
    }
  } catch (_) {}
}

async function autoEatLoop (bot) {
  if (bot._autoEating) return
  bot._autoEating = true

  const eatInterval = 1200

  const eatTick = async () => {
    try {
      if (!bot.player || !bot.entity) return
      if (bot.health <= 0) return

      if (bot.food < 16) {
        const food = findFoodItem(bot)
        if (food) {
          await bot.equip(food, 'hand')
          bot.activateItem()
          setTimeout(() => {
            try { bot.deactivateItem() } catch (_) {}
          }, 900)
        }
      }
    } catch (_) {
    } finally {
      setTimeout(eatTick, eatInterval)
    }
  }

  setTimeout(eatTick, eatInterval)
}

// =======================
// Pearl / nước / crystal / anchor
// =======================

async function throwPearlAt (bot, target) {
  try {
    const pearl = findItem(bot, 'ender_pearl')
    if (!pearl) return

    await bot.equip(pearl, 'hand')
    await bot.lookAt(target.position.offset(0, 1.5, 0), true)
    bot.activateItem()
  } catch (_) {}
}

async function escapeWebWithWater (bot) {
  try {
    if (bot._escapingWeb) return
    const waterBucket = findItem(bot, 'water_bucket')
    if (!waterBucket) return

    bot._escapingWeb = true

    const feet = bot.entity.position.floored()
    const below = bot.blockAt(feet.offset(0, -1, 0))
    if (below) {
      await bot.equip(waterBucket, 'hand')
      await bot.lookAt(below.position.offset(0.5, 1, 0.5), true)
      await bot.placeBlock(below, new Vec3(0, 1, 0))
    }

    setTimeout(async () => {
      try {
        const bucket = findItem(bot, 'bucket')
        if (!bucket) return
        const water = bot.findBlock({
          matching: b => b && b.name === 'water',
          maxDistance: 5
        })
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

// End crystal entity
function getNearestCrystalEntity (bot, pos, radius) {
  let best = null
  let bestDist = radius
  for (const id in bot.entities) {
    const e = bot.entities[id]
    if (!e || !e.position) continue

    if (bot._endCrystalId && e.entityType !== bot._endCrystalId) continue
    if (!bot._endCrystalId) {
      if (!e.name) continue
      const name = e.name.toLowerCase()
      if (!name.includes('crystal')) continue
    }

    const d = e.position.distanceTo(pos)
    if (d < bestDist) {
      bestDist = d
      best = e
    }
  }
  return best
}

// Combo crystal: obsidian + crystal + ĐỢI rồi mới đánh nổ
async function crystalCombo (bot, target) {
  if (bot._crystalBusy) return
  const obsidian = findItem(bot, ['obsidian', 'crying_obsidian'])
  const crystalItem = findItem(bot, 'end_crystal')
  if (!obsidian || !crystalItem) return

  const dist = bot.entity.position.distanceTo(target.position)
  if (dist > 7) return

  bot._crystalBusy = true
  try {
    const feet = target.position.floored()
    const baseBelow = bot.blockAt(feet.offset(0, -1, 0))
    if (!baseBelow) return

    // Nhìn + đặt obsidian
    await bot.lookAt(baseBelow.position.offset(0.5, 1, 0.5), true)
    await bot.equip(obsidian, 'hand')
    await bot.placeBlock(baseBelow, new Vec3(0, 1, 0))

    // ĐỢI cho block được update
    await wait(180)

    const obsBlock = bot.blockAt(feet)
    if (!obsBlock || !obsBlock.name.includes('obsidian')) return

    // Đặt crystal
    await bot.equip(crystalItem, 'hand')
    await bot.lookAt(obsBlock.position.offset(0.5, 1, 0.5), true)
    await bot.placeBlock(obsBlock, new Vec3(0, 1, 0))

    // ĐỢI cho entity crystal spawn
    await wait(180)

    const crystal = getNearestCrystalEntity(
      bot,
      obsBlock.position.offset(0.5, 1, 0.5),
      4
    )
    if (crystal) {
      bot.attack(crystal)
    }
  } catch (_) {
    // ignore lỗi nhỏ
  } finally {
    bot._crystalBusy = false
  }
}

// Combo anchor: anchor + ĐỢI + glowstone kích nổ
async function anchorCombo (bot, target) {
  if (bot._anchorBusy) return
  const anchorItem = findItem(bot, 'respawn_anchor')
  const glowstoneItem = findItem(bot, 'glowstone')
  if (!anchorItem || !glowstoneItem) return

  const dist = bot.entity.position.distanceTo(target.position)
  if (dist > 7) return

  bot._anchorBusy = true
  try {
    const feet = target.position.floored()
    const baseBelow = bot.blockAt(feet.offset(0, -1, 0))
    if (!baseBelow) return

    await bot.lookAt(baseBelow.position.offset(0.5, 1, 0.5), true)
    await bot.equip(anchorItem, 'hand')
    await bot.placeBlock(baseBelow, new Vec3(0, 1, 0))

    // ĐỢI anchor hiện ra
    await wait(180)

    const anchorBlock = bot.blockAt(feet)
    if (!anchorBlock || anchorBlock.name !== 'respawn_anchor') return

    await bot.equip(glowstoneItem, 'hand')
    await bot.lookAt(anchorBlock.position.offset(0.5, 0.5, 0.5), true)
    await bot.activateBlock(anchorBlock)

    // Đợi thêm chút cho server xử lý nổ
    await wait(150)
  } catch (_) {
  } finally {
    bot._anchorBusy = false
  }
}

// Pot speed/strength
async function useBuffPotion (bot) {
  try {
    const now = Date.now()
    if (bot._lastPotion && now - bot._lastPotion < 7000) return

    const pot = findItem(bot, ['potion', 'splash_potion', 'lingering_potion'])
    if (!pot) return

    bot._lastPotion = now
    await bot.equip(pot, 'hand')
    bot.activateItem()
    setTimeout(() => {
      try { bot.deactivateItem() } catch (_) {}
    }, 850)
  } catch (_) {}
}

async function shootBowAt (bot, target) {
  try {
    const bow = findItem(bot, 'bow')
    const arrow = findItem(bot, ['arrow', 'tipped_arrow'])
    if (!bow || !arrow) return

    await bot.equip(bow, 'hand')
    await bot.lookAt(target.position.offset(0, 1.4, 0), true)
    bot.activateItem()
    setTimeout(() => {
      try { bot.deactivateItem() } catch (_) {}
    }, 450)

    equipSword(bot)
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

  bot.on('death', () => {
    bot.setControlState('jump', false)
    bot.setControlState('sprint', false)
    if (bot.pvp.target) bot.pvp.stop()
  })

  bot.on('respawn', () => {
    console.log(`[${bot.username}] respawned, ready to crystal again`)
    bot._homePos = bot.entity.position.clone()
    bot._combatState.lastDist = null
    bot._combatState.rageUntil = Date.now() + 4000
  })

  autoEatLoop(bot)

  setInterval(() => {
    if (!bot.entity || !bot.entity.position) return

    const now = Date.now()
    const state = bot._combatState
    const hp = bot.health
    const rage =
      hp > 12 || (state.rageUntil && now < state.rageUntil)

    // Không đi quá xa home ~1000 block
    if (bot._homePos) {
      const homeDist = bot.entity.position.distanceTo(bot._homePos)
      if (homeDist > 1000) {
        if (bot.pvp.target) bot.pvp.stop()
        bot.setControlState('jump', false)
        bot.setControlState('sprint', false)
        const goal = new GoalNear(
          bot._homePos.x,
          bot._homePos.y,
          bot._homePos.z,
          2
        )
        bot.pathfinder.setGoal(goal)
        return
      }
    }

    // Tầm nhìn rất xa: 1000 block
    let target = getNearestEnemyPlayer(bot, 1000)

    if (target && bot._homePos) {
      const distFromHomeToTarget = target.position.distanceTo(bot._homePos)
      if (distFromHomeToTarget > 1000) target = null
    }

    if (target) {
      if (!bot.pvp.target || bot.pvp.target.id !== target.id) {
        bot.pvp.attack(target)
      }

      bot.lookAt(target.position.offset(0, 1.6, 0), true).catch(() => {})

      const dist = bot.entity.position.distanceTo(target.position)
      const haveCrystalStuff = hasCrystalStuff(bot)

      // Cận chiến
      if (dist < 7) {
        equipSword(bot)
        bot.setControlState('jump', true)
        bot.setControlState('sprint', true)

        if (now > state.nextWTap) {
          state.nextWTap = now + (rage ? 400 : 600)
          bot.setControlState('sprint', false)
          setTimeout(() => {
            try { bot.setControlState('sprint', true) } catch (_) {}
          }, 120)
        }

        // Nếu còn crystal/anchor => spam có delay
        if (haveCrystalStuff) {
          const crystalCd = rage ? 160 : 320
          const anchorCd = rage ? 260 : 520

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
      }

      // Potion buff
      useBuffPotion(bot)

      // Detect chạy trốn
      if (state.lastDist !== null) {
        const diff = dist - state.lastDist
        const isRunningAway = diff > 2 && dist > 10

        if (isRunningAway) {
          state.rageUntil = now + 6000

          if (now - state.lastChat > 4000) {
            state.lastChat = now
            bot.chat(randChoice(CHASE_LINES))
          }

          // Pearl dí gắt
          const pearlCd = rage ? 900 : 1600
          if (now - state.lastPearl > pearlCd) {
            state.lastPearl = now
            throwPearlAt(bot, target)
          }

          // Còn crystal/anchor thì spam random khi đối thủ chạy
          if (haveCrystalStuff) {
            const runCrystalCd = rage ? 220 : 380
            const runAnchorCd = rage ? 260 : 480

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

      // Tầm xa: luôn dùng pearl tiếp cận (kể cả hết crystal/anchor)
      const farPearlMin = 12
      const farPearlMax = 80
      const farPearlCd = rage ? 1200 : 2500
      if (dist > farPearlMin && dist < farPearlMax && now - state.lastPearl > farPearlCd) {
        state.lastPearl = now
        throwPearlAt(bot, target)
      }

      // Dính tơ -> bắn cung
      if (isEntityInWeb(bot, target) && now - state.lastBow > 1000) {
        state.lastBow = now
        shootBowAt(bot, target)
      }
    } else {
      if (bot.pvp.target) bot.pvp.stop()
      bot.setControlState('jump', false)
      bot.setControlState('sprint', false)
      bot._combatState.lastDist = null
    }

    if (isBotInWeb(bot)) {
      escapeWebWithWater(bot)
    }
  }, 250)
}

// =======================
// Tạo bot + chống timeout hàng loạt
// =======================

function createBot (name) {
  const bot = mineflayer.createBot({
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: name,
    auth: AUTH_MODE,

    // Giảm lỗi client timed out 30s
    keepAlive: true,
    checkTimeoutInterval: 600000 // 10 phút
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(pvp)

  bot.once('spawn', () => {
    console.log(`[${name}] joined with HT1 CRYSTAL MAD brain!`)

    const mcData = require('minecraft-data')(bot.version)
    bot._mcData = mcData

    const crystalDef =
      mcData.entitiesByName.end_crystal || mcData.entitiesByName.ender_crystal
    bot._endCrystalId = crystalDef ? crystalDef.id : null

    const movements = new Movements(bot, mcData)
    bot.pathfinder.setMovements(movements)

    bot._homePos = bot.entity.position.clone()

    setupHT1CrystalBrain(bot)
    ensureOffhandTotem(bot)
  })

  bot.on('kicked', r => console.log(`[${name}] kicked:`, r))
  bot.on('error', e => console.log(`[${name}] error:`, e))

  bot.on('end', reason => {
    console.log(`[${name}] disconnected (${reason}), reconnecting...`)
    const delay = 10000 + Math.floor(Math.random() * 20000) // 10–30s random
    setTimeout(() => {
      createBot(name)
    }, delay)
  })

  return bot
}

// =======================
// Spawn cả đàn bot
// =======================

;(async () => {
  for (const name of BOT_NAMES) {
    createBot(name)
    // Join cách nhau 20s tránh spam login
    await wait(20000)
  }
})()
      
