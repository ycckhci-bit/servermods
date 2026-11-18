// Положити в: kubejs/server_scripts/downed.js
// Стан «поранений» + бінтування + ліміт підйомів.
// Весь код в обгортці, щоб імена не конфліктували з іншими скриптами.

(function () {

    // ===================== НАЛАШТУВАННЯ =====================
    const BANDAGE_ID = 'kubejs:bandage'
    const DOWN_SECONDS = 60            // скільки секунд поранений може чекати допомоги
    const MAX_REVIVES = 2              // скільки разів можна підняти; на наступне падіння гравець помирає одразу
    const REVIVE_SECONDS = 6           // скільки секунд бінтувати (треба тримати ПКМ)
    const REVIVE_DISTANCE = 2.5        // відстань до пораненого, блоків
    const REVIVE_HEALTH = 8            // хп після підйому (8 = 4 серця)
    const HIT_PENALTY_SECONDS = 2      // скільки секунд відбирає кожен удар по пораненому
    const RECOVER_MINUTES = 30         // за скільки хвилин ОНЛАЙН відновлюється одне «падіння» (0 = вимкнути)
    const ANNOUNCE_RADIUS = 48         // радіус, у якому гравці бачать повідомлення про пораненого
    // ========================================================

    const DOWN_TICKS = DOWN_SECONDS * 20
    const REVIVE_TICKS = REVIVE_SECONDS * 20
    const RECOVER_TICKS = RECOVER_MINUTES * 60 * 20
    const BYPASS_SOURCES = ['outOfWorld', 'genericKill', 'fellOutOfWorld']   // /kill, прірва: без падіння

    let errorsLogged = 0
    function guard(label, fn) {
        return function (event) {
            try { fn(event) } catch (e) {
                if (errorsLogged < 5) {
                    errorsLogged++
                    console.error('[downed] ' + label + ': ' + e)
                }
            }
        }
    }

    function isDowned(p) {
        return p != null && p.tags.contains('dwDowned')
    }

    function cmd(p, text) {
        p.server.runCommandSilent(text.replace(/@n/g, String(p.username)))
    }

    function actionbar(p, text) {
        p.server.runCommandSilent('title ' + p.username + ' actionbar ' + JSON.stringify({ text: text }))
    }

    // ---------- крафт бінта (можна змінити під себе) ----------
    ServerEvents.recipes(event => {
        event.shapeless('2x ' + BANDAGE_ID, ['minecraft:white_wool', 'minecraft:paper', 'minecraft:paper'])
            .id('elysium:bandage')
    })

    // ---------- падіння ----------
    function goDown(p, downs) {
        p.health = 1
        p.tags.add('dwDowned')
        p.persistentData.putInt('dwLeft', DOWN_TICKS)
        p.persistentData.putInt('dwDowns', downs + 1)
        try { p.closeMenu() } catch (e) { }

        cmd(p, 'effect give @n minecraft:slowness 999999 3 true')
        cmd(p, 'effect give @n minecraft:weakness 999999 9 true')
        cmd(p, 'effect give @n minecraft:glowing 999999 0 true')

        const left = MAX_REVIVES - downs
        p.tell('§c§lВи поранені! §fЧекайте на бінт: §e' + DOWN_SECONDS + ' с§f. Підйомів лишилось: §e' + left)
        if (left <= 0) p.tell('§4Наступного падіння ви помрете одразу.')

        const name = String(p.username)
        p.server.players.forEach(o => {
            if (o === p) return
            try {
                if (o.distanceToSqr(p) <= ANNOUNCE_RADIUS * ANNOUNCE_RADIUS)
                    o.tell('§c[!] §e' + name + ' §cпоранений і потребує бінта! §7(тримайте ПКМ з бінтом поруч)')
            } catch (e) { }
        })
    }

    function revive(target, by) {
        target.tags.remove('dwDowned')
        target.persistentData.remove('dwLeft')
        target.health = REVIVE_HEALTH
        cmd(target, 'effect clear @n minecraft:slowness')
        cmd(target, 'effect clear @n minecraft:weakness')
        cmd(target, 'effect clear @n minecraft:glowing')
        cmd(target, 'effect give @n minecraft:regeneration 8 1 true')
        cmd(target, 'effect give @n minecraft:resistance 4 2 true')
        target.tell('§aВас забинтував §e' + by.username + '§a. Ви на ногах!')
        by.tell('§aВи забинтували §e' + target.username)
        actionbar(target, '')
    }

    function die(p, reason) {
        p.tags.remove('dwDowned')
        p.persistentData.putBoolean('dwForceDie', true)
        cmd(p, 'effect clear @n minecraft:slowness')
        cmd(p, 'effect clear @n minecraft:weakness')
        cmd(p, 'effect clear @n minecraft:glowing')
        p.tell('§4' + reason)
        p.kill()
    }

    // ---------- перехоплення смерті ----------
    EntityEvents.death(guard('death', event => {
        const p = event.entity
        if (!p || !p.isPlayer()) return
        if (p.persistentData.getBoolean('dwForceDie')) return

        let msg = ''
        try { msg = String(event.source.getMsgId()) } catch (e) { }
        if (BYPASS_SOURCES.indexOf(msg) !== -1) return

        if (isDowned(p)) {
            // удар по пораненому: не вбиваємо, лише скорочуємо таймер
            event.cancel()
            p.health = 1
            const left = p.persistentData.getInt('dwLeft') - HIT_PENALTY_SECONDS * 20
            p.persistentData.putInt('dwLeft', left)
            return
        }

        const downs = p.persistentData.getInt('dwDowns')
        if (downs >= MAX_REVIVES) {
            p.tell('§4Ви вже падали ' + downs + ' раз(и), цього разу підняти не вийде.')
            return   // звичайна смерть
        }

        event.cancel()
        goDown(p, downs)
    }))

    // ---------- щотіку: таймер, бінтування, відновлення лічильника ----------
    PlayerEvents.tick(guard('tick', event => {
        const p = event.player

        // 1) поранений: таймер
        if (isDowned(p)) {
            const left = p.persistentData.getInt('dwLeft') - 1
            p.persistentData.putInt('dwLeft', left)
            if (left <= 0) {
                die(p, 'Ви стікли кров\'ю: допомоги не було.')
                return
            }
            if (p.tickCount % 20 === 0)
                actionbar(p, '§c§lПОРАНЕНИЙ §7| §fзалишилось: §e' + Math.ceil(left / 20) + ' с')
            if (p.health > 1) p.health = 1
            return
        }

        // 2) відновлення «падіння» за час онлайн
        if (RECOVER_TICKS > 0 && p.tickCount % 20 === 0) {
            const downs = p.persistentData.getInt('dwDowns')
            if (downs > 0) {
                const rec = p.persistentData.getInt('dwRec') + 20
                if (rec >= RECOVER_TICKS) {
                    p.persistentData.putInt('dwRec', 0)
                    p.persistentData.putInt('dwDowns', downs - 1)
                    p.tell('§aВи відновилися: ліміт підйомів збільшено. Підйомів доступно: §e' + (MAX_REVIVES - (downs - 1)))
                } else {
                    p.persistentData.putInt('dwRec', rec)
                }
            }
        }

        // 3) бінтування: гравець тримає ПКМ з бінтом
        if (!p.isUsingItem()) return
        const held = p.mainHandItem.id === BANDAGE_ID ? p.mainHandItem
            : (p.offHandItem.id === BANDAGE_ID ? p.offHandItem : null)
        if (!held) return

        let target = null
        p.server.players.forEach(t => {
            if (target || t === p || !isDowned(t)) return
            if (p.distanceToSqr(t) <= REVIVE_DISTANCE * REVIVE_DISTANCE) target = t
        })

        if (!target) {
            p.stopUsingItem()
            return
        }

        const used = p.ticksUsingItem
        if (used >= REVIVE_TICKS) {
            revive(target, p)
            held.shrink(1)
            p.stopUsingItem()
            return
        }
        if (used % 5 === 0)
            actionbar(p, '§aБінтування: §f' + Math.floor(used * 100 / REVIVE_TICKS) + '%')
    }))

    // удар по рятівнику перериває бінтування
    EntityEvents.beforeHurt(guard('beforeHurt', event => {
        const e = event.entity
        if (!e || !e.isPlayer()) return
        if (e.isUsingItem() && (e.mainHandItem.id === BANDAGE_ID || e.offHandItem.id === BANDAGE_ID))
            e.stopUsingItem()

        // поранений не може бити
        const src = event.source
        const att = src ? (src.player || src.actual) : null
        if (att && att.isPlayer() && isDowned(att)) event.cancel()
    }))

    // ---------- обмеження для пораненого ----------
    ItemEvents.rightClicked(guard('itemRight', event => {
        if (isDowned(event.player)) event.cancel()
    }))
    BlockEvents.rightClicked(guard('blockRight', event => {
        if (isDowned(event.player)) event.cancel()
    }))
    BlockEvents.broken(guard('blockBroken', event => {
        if (isDowned(event.player)) event.cancel()
    }))
    ItemEvents.entityInteracted(guard('entityInteracted', event => {
        if (isDowned(event.player || event.entity)) event.cancel()
    }))

    // ---------- справжня смерть: скидаємо стан ----------
    PlayerEvents.respawned(guard('respawned', event => {
        const p = event.player
        p.tags.remove('dwDowned')
        p.persistentData.remove('dwLeft')
        p.persistentData.remove('dwForceDie')
        p.persistentData.putInt('dwDowns', 0)
        p.persistentData.putInt('dwRec', 0)
    }))

    console.info('[downed] скрипт завантажено: падіння ' + DOWN_SECONDS + ' с, підйомів ' + MAX_REVIVES)
})()