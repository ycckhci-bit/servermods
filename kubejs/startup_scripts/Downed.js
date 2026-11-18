// Положити в: kubejs/startup_scripts/bandage_startup.js
// Реєструє предмет «Бінт» (kubejs:bandage). Після додавання потрібен ПОВНИЙ перезапуск
// сервера і клієнтів (startup-скрипти не підтягуються через /reload).

StartupEvents.registry('item', event => {

    const bandage = event.create('bandage')
        .displayName('Бінт')
        .maxStackSize(16)
        .texture('minecraft:item/paper')   // тимчасова текстура; свою можна додати пізніше

    // ці налаштування «утримання ПКМ» огорнуті в try: якщо в вашій збірці KubeJS
    // якийсь метод названо інакше, предмет усе одно створиться
    try { bandage.useAnimation('bow') } catch (e) { console.warn('[bandage] useAnimation: ' + e) }
    try { bandage.useDuration(() => 200) } catch (e) { console.warn('[bandage] useDuration: ' + e) }
    try { bandage.use(() => true) } catch (e) { console.warn('[bandage] use: ' + e) }
})