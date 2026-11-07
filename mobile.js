/* Mobile controls share the existing game simulation and save format. */
(() => {
    const touchDevice = new URLSearchParams(location.search).get('mobile') === '1' || matchMedia('(pointer: coarse)').matches ||
        (navigator.maxTouchPoints > 0 && Math.min(innerWidth, innerHeight) < 1100);
    document.documentElement.classList.toggle('mobile-ui', touchDevice);
    if (!touchDevice) return;

    const state = { stickId: null, attackId: null, x: 0, y: 0, aimX: .707, aimY: -.707, attack: false, ownsTarget: false };
    const controls = document.createElement('div');
    controls.id = 'mobile-controls';
    controls.innerHTML = '<div id="move-stick" role="group" aria-label="Джойстик движения"><span id="stick-thumb"></span></div><button id="mobile-attack" class="mobile-action" aria-label="Атака ближайшего врага: удерживать">⚔ АТАКА</button><button id="mobile-interact" class="mobile-action" aria-label="Подобрать добычу или взаимодействовать">Взять /<br>открыть</button>';
    $('game-shell').append(controls);
    const stick = $('move-stick'), thumb = $('stick-thumb'), attack = $('mobile-attack');
    const playable = () => game.started && !game.paused && !game.selectedPanel && $('death-screen').hidden && $('victory-screen').hidden;

    function releaseStick() {
        state.stickId = null;
        state.x = state.y = 0;
        thumb.style.transform = '';
        stick.classList.remove('pressed');
    }
    function releaseAttack() {
        state.attackId = null;
        state.attack = false;
        attack.classList.remove('pressed');
        if (state.ownsTarget && game.started) { player.target = null; player.path = []; }
        state.ownsTarget = false;
    }
    function resetInput() { releaseStick(); releaseAttack(); }
    function aim() {
        const target = skillTarget();
        if (target) return { x: target.x, y: target.y };
        return { x: player.x + state.aimX * 4, y: player.y + state.aimY * 4 };
    }
    function updateStick(e) {
        const r = stick.getBoundingClientRect();
        const dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
        const length = Math.hypot(dx, dy), radius = r.width / 2 - 19;
        const scale = Math.min(1, radius / (length || 1));
        thumb.style.transform = `translate(${dx * scale}px,${dy * scale}px)`;
        state.x = length > 9 ? dx / (length || 1) * Math.min(1, length / radius) : 0;
        state.y = length > 9 ? dy / (length || 1) * Math.min(1, length / radius) : 0;
    }
    stick.addEventListener('pointerdown', e => {
        if (!playable() || state.stickId !== null) return;
        e.preventDefault();
        state.stickId = e.pointerId;
        stick.setPointerCapture(e.pointerId);
        player.path = []; player.target = null; player.targetLoot = null; player.vendorGoal = false;
        stick.classList.add('pressed');
        updateStick(e);
    });
    stick.addEventListener('pointermove', e => { if (e.pointerId === state.stickId) { e.preventDefault(); updateStick(e); } });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        stick.addEventListener(event, e => { if (e.pointerId === state.stickId) releaseStick(); });
        attack.addEventListener(event, e => { if (e.pointerId === state.attackId) releaseAttack(); });
    }
    attack.addEventListener('pointerdown', e => {
        if (!playable() || state.attackId !== null) return;
        e.preventDefault();
        state.attackId = e.pointerId; state.attack = true;
        attack.setPointerCapture(e.pointerId);
        attack.classList.add('pressed');
        if (ac?.state === 'suspended') ac.resume().catch(() => {});
    });
    // Pointer events avoid duplicate synthetic mouse clicks and support two thumbs.
    canvas.removeEventListener('mousedown', handleClick);
    canvas.addEventListener('pointerdown', e => {
        if (e.pointerType === 'mouse') { handleClick(e); return; }
        if (!playable()) return;
        e.preventDefault(); resetInput();
        if (ac?.state === 'suspended') ac.resume().catch(() => {});
        handleClick({ clientX: e.clientX, clientY: e.clientY, button: 0 });
    });

    const baseUpdate = update;
    update = function(dt) {
        if (!playable()) { resetInput(); baseUpdate(dt); return; }
        const moving = state.stickId !== null && Math.hypot(state.x, state.y) > 0;
        if (moving) {
            const a = state.x / ISO_X, b = state.y / ISO_Y;
            const direction = norm((a + b) / 2, (b - a) / 2);
            state.aimX = direction.x; state.aimY = direction.y;
            mouse.wx = player.x + direction.x * 4; mouse.wy = player.y + direction.y * 4;
            player.path = []; player.target = null; player.targetLoot = null; player.vendorGoal = false;
            moveActor(player, player.x + direction.x, player.y + direction.y, player.speed * Math.min(1, Math.hypot(state.x, state.y)), dt);
        }
        if (state.attack) {
            const target = nearestEnemy(9);
            if (target) {
                player.target = target; state.ownsTarget = true;
                if (moving) { attackBasic(); player.target = null; }
            }
        }
        baseUpdate(dt);
        const dodgeButton = $('dodge-btn');
        dodgeButton.disabled = player.dodgeCD > 0;
        dodgeButton.querySelector('span').textContent = player.dodgeCD > 0 ? Math.ceil(player.dodgeCD) + ' с' : 'РЫВОК';
    };
    const baseHotbar = refreshHotbar;
    refreshHotbar = function() {
        baseHotbar();
        $('hotbar').querySelectorAll('button').forEach(b => {
            b.onclick = () => { if (!playable()) return; const p = aim(); player.selected = +b.dataset.index; castSkill(player.selected, p.x, p.y); };
        });
    };
    $('dodge-btn').onclick = () => {
        if (!playable()) return;
        mouse.wx = player.x + state.aimX * 4; mouse.wy = player.y + state.aimY * 4;
        dodge();
    };
    $('mobile-interact').onclick = () => {
        if (!playable()) return;
        const vendor = { x: 10.5, y: 11.5 };
        if (game.zoneId === 'town' && dist(player, vendor) < 2.8) { resetInput(); vendorDialog(); return; }
        const objects = [
            ...game.zone.drops.map(o => ({ o, kind: 'drop' })),
            ...game.zone.chests.filter(o => !o.open).map(o => ({ o, kind: 'chest' })),
            ...game.zone.portals.map(o => ({ o, kind: 'portal' }))
        ].filter(({ o }) => dist(player, o) < 4).sort((a, b) => dist(player, a.o) - dist(player, b.o));
        const choice = objects[0];
        if (!choice) { toast('Подойди к добыче, сундуку или порталу'); return; }
        setPath(choice.o.x, choice.o.y);
        if (choice.kind === 'drop') player.targetLoot = choice.o;
    };

    const baseOpen = openPanel;
    openPanel = function(id) { resetInput(); baseOpen(id); if (game.started && game.selectedPanel) game.paused = true; };
    const baseTab = showJournalTab;
    showJournalTab = function(tab) { $('inventory-panel').dataset.tab = tab; baseTab(tab); };
    const baseInventory = renderInventory;
    renderInventory = function() {
        baseInventory();
        if (!game.started) return;
        $('inventory-grid').querySelectorAll('[data-id]').forEach(el => {
            el.draggable = false;
            el.onclick = () => showMobileItem(player.inv.find(i => i.id === +el.dataset.id));
        });
        $('equip-slots').querySelectorAll('[data-equip]').forEach(el => {
            el.onclick = () => showMobileItem(player.equip[el.dataset.equip], el.dataset.equip);
        });
        $('item-desc').innerHTML = '<b>Снаряжение</b><div>Нажми на предмет, чтобы посмотреть свойства, надеть или выбросить его.</div>';
    };
    function showMobileItem(item, equippedSlot = '') {
        if (!item) { showItemDesc(null); return; }
        showItemDesc(item);
        const actions = document.createElement('div'); actions.className = 'mobile-item-actions';
        const equip = document.createElement('button');
        equip.textContent = equippedSlot ? 'Снять' : 'Надеть';
        equip.onclick = () => equippedSlot ? unequipItem(equippedSlot) : equipItem(item.id);
        actions.append(equip);
        if (!equippedSlot) {
            const drop = document.createElement('button'); drop.textContent = 'Выбросить';
            drop.onclick = () => dropItem(item.id); actions.append(drop);
        }
        $('item-desc').append(actions);
        $('item-desc').scrollIntoView({ block: 'nearest' });
    }

    const fullscreen = document.createElement('button'); fullscreen.id = 'fullscreen-btn'; fullscreen.className = 'secondary';
    fullscreen.textContent = '⛶ На весь экран';
    fullscreen.onclick = async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
            else toast('Полный экран недоступен в этом браузере');
        } catch { toast('Полный экран недоступен в этом браузере'); }
    };
    $('pause-panel').querySelector('.menu-options').append(fullscreen);
    $('how-btn').textContent = '?';
    $('how-btn').setAttribute('aria-label', 'Как играть');
    $('dodge-btn').querySelector('span').textContent = 'РЫВОК';
    document.querySelector('.bag-helper').textContent = 'Нажми на предмет, посмотри свойства и выбери «Надеть». Снаряжение героя — ниже.';
    document.querySelector('.stage-label').textContent = 'Нажми на снаряжение, чтобы посмотреть свойства или снять';
    $('welcome').querySelector('.micro-note').textContent = 'Слева — движение. Справа — атака (удерживай), навыки и зелья. Касайся земли, врагов и порталов. Удобнее играть горизонтально. Прогресс сохраняется автоматически.';
    $('help-panel').querySelector('.help-copy').innerHTML = '<p><b>Левый джойстик</b> — движение. Направление совпадает с движением пальца.</p><p><b>Удерживай «Атака»</b>, чтобы преследовать ближайшего врага и сражаться. Можно одновременно двигаться и атаковать. Навыки направляются в ближайшую цель. <b>Рывок</b> — в последнем направлении движения.</p><p><b>Касание земли</b> — идти к точке. Касание врага — атаковать его. Касание сундука, добычи, торговца или портала — подойти. <b>Взять / открыть</b> — взаимодействовать с ближайшим объектом.</p><p><b>Рюкзак</b> открывает снаряжение, характеристики, навыки, задания и карту. Проводи по вкладкам, чтобы увидеть остальные. Нажми на предмет, затем «Надеть» или «Снять». При открытых окнах игра стоит на паузе.</p><p>Для большего обзора поверни телефон горизонтально. В меню есть кнопка <b>«На весь экран»</b>. Прогресс хранится в этом браузере.</p>';
    window.addEventListener('blur', resetInput);
    window.addEventListener('pagehide', () => { resetInput(); saveGame(); });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) { resetInput(); saveGame(); if (game.started && !game.selectedPanel && !game.paused) openPanel('pause-panel'); }
    });
    const baseResize = resize;
    resize = function() { resetInput(); baseResize(); };
    window.addEventListener('resize', resetInput);
    window.visualViewport?.addEventListener('resize', resize);
    if (game.started) { refreshHotbar(); renderInventory(); }
    resize();
})();
