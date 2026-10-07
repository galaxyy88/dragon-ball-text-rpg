(() => {
  const SAVE_KEY = "dbz-text-rpg-save-v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clone = value => JSON.parse(JSON.stringify(value));
  const safeText = value => String(value ?? "");
  const xpForLevel = level => Math.floor(100 + (level - 1) * 65 + (level - 1) ** 1.6 * 15);
  let state = null;
  let currentTab = "story";
  let currentCodexFilter = "PERSONAGENS";
  let soundEnabled = false;
  let audioContext = null;
  let actionLocked = false;
  let toastTimer = 0;

  const defaults = {
    level: 1, xp: 0, maxHp: 120, hp: 120, maxKi: 60, ki: 60,
    strength: 21, defense: 15, speed: 16, kiPower: 18,
    techniques: ["strike"], transformations: ["normal"], currentForm: "normal",
    inventory: { senzu: 1, water: 2 }, relationships: { goku: 0, piccolo: 0, gohan: 0, krillin: 0, vegeta: -10, roshi: 0, tien: 0, yamcha: 0 },
    codex: { characters: [], enemies: [], techniques: ["strike"], transformations: ["normal"], arcs: ["saiyan"] },
    flags: {}, journal: [], arcId: "saiyan", eventId: "opening", battle: null, battleEscaped: false, pendingNextEvent: null, defeated: false, completed: [], lastSaved: null
  };

  const characterInfo = id => window.CHARACTERS[id];
  const techniqueInfo = id => window.ATTACKS[id];
  const transformationInfo = id => window.TRANSFORMATIONS[id];
  const eventInfo = id => window.ARCS[state?.arcId || "saiyan"]?.chapters.find(item => item.id === id);
  const playerPower = () => Math.round((state.strength + state.defense + state.speed + state.kiPower + state.level * 26) * transformationInfo(state.currentForm).multiplier);
  const progressIndex = () => Math.max(0, window.ARCS[state.arcId].chapters.findIndex(item => item.id === state.eventId));
  const iconMarkup = (name, className = "ui-icon") => `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
  const fighterIcon = id => ({ goku: "saiyan", piccolo: "ki", gohan: "saiyan", krillin: "guard", roshi: "dragon-ball", tien: "fist", yamcha: "fist" })[id] || "saiyan";
  const enemyIcon = id => ({ raditz: "saiyan", saibaman: "ki", nappa: "fist", vegeta: "saiyan", piccolo_spar: "ki" })[id] || "scouter";

  function makeNewState(formData) {
    const style = formData.get("style");
    const adjustments = {
      melee: { strength: 7, defense: 4, speed: 1, kiPower: -2, maxHp: 16, maxKi: -8 },
      ki: { strength: -2, defense: 0, speed: 2, kiPower: 8, maxHp: -8, maxKi: 20 },
      balanced: { strength: 2, defense: 2, speed: 2, kiPower: 2, maxHp: 4, maxKi: 8 }
    }[style] || {};
    const player = {
      name: safeText(formData.get("name")).trim() || "Kaito", gender: safeText(formData.get("gender")), race: safeText(formData.get("race")) || "saiyan", style,
      ...clone(defaults)
    };
    for (const key of ["strength", "defense", "speed", "kiPower", "maxHp", "maxKi"]) player[key] += adjustments[key] || 0;
    player.hp = player.maxHp;
    player.ki = player.maxKi;
    player.codex.characters = ["goku", "piccolo"];
    player.journal.push({ day: "DIA 001", text: `A jornada de ${player.name} começou na Terra.` });
    return player;
  }

  function toast(message, kind = "") {
    const region = $("#toast-region");
    const item = document.createElement("div");
    item.className = `toast ${kind}`;
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => item.remove(), 2900);
  }

  function beep(frequency = 220, duration = 0.08, type = "sine") {
    if (!soundEnabled) return;
    try {
      audioContext ||= new AudioContext();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.045, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration);
    } catch { soundEnabled = false; }
  }

  function note(text) {
    if (!text) return;
    state.journal.unshift({ day: eventInfo(state.eventId)?.time?.split(" // ")[0] || "DIA 001", text });
    state.journal = state.journal.slice(0, 80);
    updateCounts();
  }

  function addBond(changes = {}) {
    for (const [id, amount] of Object.entries(changes)) {
      if (!(id in state.relationships)) state.relationships[id] = 0;
      state.relationships[id] = Math.max(-100, Math.min(100, state.relationships[id] + amount));
    }
  }

  function unlockTechnique(id) {
    if (!id || state.techniques.includes(id)) return;
    state.techniques.push(id);
    state.codex.techniques.push(id);
    note(`Nova técnica aprendida: ${techniqueInfo(id)?.name || id}.`);
    toast(`${techniqueInfo(id)?.name || id} aprendido!`, "good");
  }

  function unlockTransformation(id) {
    if (!id || state.transformations.includes(id)) return;
    state.transformations.push(id);
    if (!state.codex.transformations.includes(id)) state.codex.transformations.push(id);
    note(`Transformação desbloqueada: ${transformationInfo(id)?.name || id}.`);
    toast(`${transformationInfo(id)?.name || id} desbloqueado!`, "good");
  }

  function applyReward(reward = {}) {
    if (reward.xp) gainXp(reward.xp);
    if (reward.ki) state.ki = Math.min(state.maxKi, state.ki + reward.ki);
    if (reward.hp) state.hp = Math.min(state.maxHp, state.hp + reward.hp);
    if (reward.item) state.inventory[reward.item] = (state.inventory[reward.item] || 0) + (reward.itemCount || 1);
  }

  function enterEvent(id) {
    const arc = window.ARCS[state.arcId];
    const next = arc?.chapters.find(item => item.id === id);
    if (!next) return;
    state.eventId = id;
    state.pendingNextEvent = null;
    state.battle = null;
    state.battleEscaped = false;
    state.defeated = false;
    if (next.id === "saiyan_epilogue" && !state.completed.includes("saiyan")) state.completed.push("saiyan");
    if (!state.codex.arcs.includes(state.arcId)) state.codex.arcs.push(state.arcId);
    if (id === "raditz_talk" || id === "raditz_fight") ["goku", "piccolo", "raditz"].forEach(addCodex);
    if (id === "training") ["goku", "piccolo", "krillin", "tien", "yamcha"].forEach(addCodex);
    note(`Novo registro: ${next.title}.`);
    renderAll();
    if (next.battle) beginBattle(next.battle, next.objective);
  }

  function addCodex(id) {
    if (window.CHARACTERS[id]) {
      if (!state.codex.characters.includes(id)) state.codex.characters.push(id);
    } else if (window.ENEMIES[id] && !state.codex.enemies.includes(id)) state.codex.enemies.push(id);
  }

  function chooseEvent(choice) {
    if (choice.bond) addBond(choice.bond);
    if (choice.relationshipPenalty) addBond(Object.fromEntries(Object.entries(choice.relationshipPenalty).map(([key, value]) => [key, -Math.abs(value)])));
    if (choice.flag) state.flags[choice.flag] = true;
    (choice.codex || []).forEach(addCodex);
    if (choice.unlockAttack) unlockTechnique(choice.unlockAttack);
    if (choice.unlockTransformation) unlockTransformation(choice.unlockTransformation);
    if (choice.reward) applyReward(choice.reward);
    if (choice.heal) state.hp = Math.min(state.maxHp, state.hp + choice.heal);
    if (choice.journal) note(choice.journal);
    saveGame(false);
    enterEvent(choice.next);
  }

  function playerStats() {
    const form = transformationInfo(state.currentForm);
    return {
      strength: Math.round(state.strength * form.modifiers.strength), defense: Math.round(state.defense * form.modifiers.defense),
      speed: Math.round(state.speed * form.modifiers.speed), kiPower: Math.round(state.kiPower * form.modifiers.kiPower)
    };
  }

  function beginBattle(enemyId, objective) {
    const template = window.ENEMIES[enemyId];
    if (!template) return;
    state.battle = { enemyId, enemy: { ...clone(template), hp: template.maxHp, ki: template.maxKi, phaseIndex: 0, defending: false, blind: false }, turn: 1, playerDefending: false, enemyDefending: false, objective, log: [`${template.name} entrou na batalha.`, "Analise a energia do oponente e escolha sua abertura."], enemyPattern: 0, nextEvent: eventInfo(state.eventId)?.victory || null, resolved: false };
    state.codex.enemies.includes(enemyId) || state.codex.enemies.push(enemyId);
    state.codex.arcs.includes(state.arcId) || state.codex.arcs.push(state.arcId);
    switchTab("story");
    renderBattle();
    renderAll();
    logBattle(`${template.name} bloqueia seu caminho.`);
    beep(120, 0.18, "triangle");
  }

  function logBattle(message, kind = "") {
    if (!state?.battle) return;
    state.battle.log.push({ message, kind });
    state.battle.log = state.battle.log.slice(-28);
    const log = $("#battle-log");
    if (log) {
      log.innerHTML = state.battle.log.map(line => typeof line === "string" ? `<p class="battle-line">${escapeHtml(line)}</p>` : `<p class="battle-line ${line.kind || ""}">${escapeHtml(line.message)}</p>`).join("");
      log.scrollTop = log.scrollHeight;
    }
  }

  function escapeHtml(value) {
    return safeText(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
  }

  function pulse(kind = "") {
    const flash = $("#combat-flash");
    flash.className = `combat-flash ${kind ? `flash-${kind}` : ""}`;
    void flash.offsetWidth;
    flash.classList.add("active");
    const panel = $("#battle-panel");
    if (kind === "impact" && panel) {
      panel.classList.remove("shake");
      void panel.offsetWidth;
      panel.classList.add("shake");
    }
  }

  function gainXp(amount) {
    state.xp += amount;
    toast(`+${amount} XP`, "good");
    while (state.xp >= xpForLevel(state.level)) {
      state.xp -= xpForLevel(state.level);
      state.level += 1;
      state.maxHp += 18;
      state.maxKi += 8;
      state.strength += 3;
      state.defense += 2;
      state.speed += 2;
      state.kiPower += 3;
      state.hp = state.maxHp;
      state.ki = state.maxKi;
      state.techniques.slice();
      const newlyAvailable = Object.entries(window.ATTACKS).find(([id, attack]) => attack.unlockLevel === state.level && id !== "strike" && !state.techniques.includes(id));
      if (newlyAvailable) unlockTechnique(newlyAvailable[0]);
      $("#levelup-detail").textContent = `NÍVEL ${String(state.level).padStart(2, "0")}`;
      $("#levelup-screen").hidden = false;
      beep(540, 0.12, "triangle");
      window.setTimeout(() => { $("#levelup-screen").hidden = true; renderPlayer(); }, 1600);
      note(`Subiu para o nível ${state.level}.`);
    }
    renderPlayer();
  }

  function computeDamage(attacker, defender, multiplier, isKi = false) {
    const offense = isKi ? attacker.kiPower : attacker.strength;
    const variance = 0.88 + Math.random() * 0.24;
    const raw = offense * multiplier - defender.defense * (isKi ? 0.34 : 0.5);
    return Math.max(5, Math.round(raw * variance));
  }

  function playerAction(action) {
    if (!state?.battle || state.battle.resolved || actionLocked) return;
    if (action === "technique") return showTechniquePicker();
    if (action === "transform") return showTransformationPicker();
    if (action === "item") return showItemPicker();
    if (action === "flee") return fleeBattle();
    actionLocked = true;
    const battle = state.battle;
    const enemy = battle.enemy;
    const stats = playerStats();
    const target = { defense: enemy.defending ? enemy.defense * 1.65 : enemy.defense };
    battle.playerDefending = false;
    enemy.defending = false;
    if (action === "attack") {
      const damage = computeDamage(stats, target, 1.05);
      enemy.hp = Math.max(0, enemy.hp - damage);
      logBattle(`${state.name} acerta uma combinação. ${enemy.name} perde ${damage} HP.`);
      pulse("impact"); beep(170, 0.06, "square");
    } else if (action === "defend") {
      battle.playerDefending = true;
      logBattle(`${state.name} assume uma guarda firme. Dano recebido será reduzido em 60%.`);
    } else if (action === "charge") {
      const recovered = Math.min(Math.ceil(state.maxKi * 0.28), state.maxKi - state.ki);
      state.ki += recovered;
      battle.playerDefending = true;
      logBattle(`${state.name} concentra o Ki e recupera ${recovered} pontos. A guarda fica aberta.`);
      pulse("ki"); beep(340, 0.12);
    }
    resolvePlayerTurn();
  }

  function useTechnique(id) {
    if (!state?.battle || actionLocked) return;
    const move = techniqueInfo(id);
    if (!move || !state.techniques.includes(id) || state.ki < move.kiCost) return;
    closeModal();
    actionLocked = true;
    const battle = state.battle;
    const enemy = battle.enemy;
    state.ki -= move.kiCost;
    battle.playerDefending = false;
    enemy.defending = false;
    const color = move.animation;
    if (move.effect === "blind") {
      enemy.blind = true;
      const damage = computeDamage(playerStats(), enemy, move.damage, false);
      enemy.hp = Math.max(0, enemy.hp - damage);
      logBattle(`${state.name} usa ${move.name}! ${enemy.name} perde ${damage} HP e perde a mira.`);
    } else {
      const damage = computeDamage(playerStats(), { defense: enemy.defending ? enemy.defense * 1.65 : enemy.defense }, move.damage, true);
      enemy.hp = Math.max(0, enemy.hp - damage);
      logBattle(`${state.name} lança ${move.name}! ${enemy.name} recebe ${damage} de dano.`);
    }
    pulse(color === "flash" ? "light" : "ki");
    beep(color === "gold" ? 690 : 430, 0.22, "sawtooth");
    if (["beam", "violet", "gold", "pierce", "orb"].includes(color)) showTechniqueBanner(move.name, color);
    resolvePlayerTurn();
  }

  function showTechniqueBanner(name, color) {
    const banner = document.createElement("div");
    banner.className = `technique-banner ${color}`;
    banner.innerHTML = `<span>████████████████</span><b>${escapeHtml(name.toUpperCase())}</b><span>████████████████</span>`;
    $("#battle-panel").append(banner);
    window.setTimeout(() => banner.remove(), 1050);
  }

  function resolvePlayerTurn() {
    renderBattle();
    if (state.battle.enemy.hp <= 0) return finishBattle(true);
    applyBossPhase();
    if (state.battle.enemy.hp <= 0) return finishBattle(true);
    window.setTimeout(() => {
      if (!state?.battle || state.battle.resolved) { actionLocked = false; return; }
      enemyTurn();
      renderBattle();
      if (state.battle && state.hp <= 0) finishBattle(false);
      else if (state.battle) {
        state.battle.turn += 1;
        $("#turn-count").textContent = String(state.battle.turn).padStart(2, "0");
        actionLocked = false;
        renderBattle();
      }
    }, 520);
  }

  function applyBossPhase() {
    const battle = state.battle;
    if (!battle) return;
    const phase = battle.enemy.phases[battle.enemy.phaseIndex];
    if (!phase || battle.enemy.hp / battle.enemy.maxHp > phase.at) return;
    const enemy = battle.enemy;
    enemy.phaseIndex += 1;
    const oldRatio = enemy.hp / enemy.maxHp;
    for (const key of ["strength", "defense", "speed", "kiPower", "maxHp", "maxKi", "attacks", "glyph"]) if (phase[key] !== undefined) enemy[key] = phase[key];
    enemy.hp = Math.min(enemy.maxHp, Math.max(Math.ceil(enemy.maxHp * 0.68), Math.round(enemy.maxHp * oldRatio)));
    enemy.ki = Math.min(enemy.maxKi, Math.max(enemy.ki, Math.round(enemy.maxKi * 0.5)));
    logBattle(phase.message, "system-line");
    battle.enemyPhaseName = phase.name;
    pulse("boss"); beep(96, 0.28, "sawtooth");
    toast(`${phase.name.toUpperCase()}!`, "bad");
  }

  function enemyTurn() {
    const battle = state.battle;
    if (!battle) return;
    const enemy = battle.enemy;
    const actionNo = battle.enemyPattern++;
    const aggressive = enemy.ai === "aggressive" || enemy.ai === "boss";
    if ((enemy.ai === "strategic" && enemy.ki < enemy.maxKi * 0.4) || (enemy.ai === "boss" && actionNo % 4 === 1 && enemy.ki >= 16)) {
      const recovered = Math.min(Math.ceil(enemy.maxKi * 0.3), enemy.maxKi - enemy.ki);
      enemy.ki += recovered;
      enemy.defending = true;
      logBattle(`${enemy.name} recua e concentra energia. Ki +${recovered}.`, "enemy-line");
      return;
    }
    if (enemy.ai === "strategic" && actionNo % 4 === 0) {
      battle.enemyDefending = true;
      enemy.defending = true;
      logBattle(`${enemy.name} assume uma guarda calculada.`, "enemy-line");
      return;
    }
    const available = enemy.attacks.filter(id => {
      const move = techniqueInfo(id);
      return move && (!move.kiCost || enemy.ki >= move.kiCost);
    });
    const special = available.find(id => id !== "strike");
    const useSpecial = special && (aggressive ? Math.random() < 0.48 : Math.random() < 0.63);
    let damage;
    if (useSpecial) {
      const move = techniqueInfo(special);
      enemy.ki -= move.kiCost;
      damage = computeDamage(enemy, playerStats(), move.damage * 0.63, true);
      logBattle(`${enemy.name} usa ${move.name}! ${state.name} recebe ${damage} de dano.`, "enemy-line");
    } else {
      damage = computeDamage(enemy, playerStats(), 0.88, false);
      logBattle(`${enemy.name} ataca sem dar espaço. ${state.name} recebe ${damage} de dano.`, "enemy-line");
    }
    if (enemy.blind) { damage = Math.round(damage * 0.45); enemy.blind = false; logBattle(`${enemy.name} ainda está desorientado; o golpe perde força.`, "system-line"); }
    if (battle.playerDefending) { damage = Math.round(damage * 0.4); logBattle(`Sua defesa reduz o dano em 60%.`, "system-line"); }
    state.hp = Math.max(0, state.hp - damage);
    battle.playerDefending = false;
    pulse("impact"); beep(90, 0.08, "square");
    if (transformationInfo(state.currentForm).kiDrain) {
      state.ki = Math.max(0, state.ki - transformationInfo(state.currentForm).kiDrain);
      if (!state.ki && state.currentForm !== "normal") { state.currentForm = "normal"; logBattle("Sua energia se esgota; a transformação termina.", "system-line"); }
    }
  }

  function finishBattle(won) {
    const battle = state.battle;
    if (!battle || battle.resolved) return;
    battle.resolved = true;
    actionLocked = true;
    if (won) {
      const enemyId = battle.enemyId;
      const template = window.ENEMIES[enemyId];
      if (enemyId === "piccolo_spar") state.flags.transformationSparDone = true;
      logBattle(`${battle.enemy.name} foi derrotado. VITÓRIA!`, "system-line");
      const xp = template.xp;
      gainXp(xp);
      state.ki = Math.min(state.maxKi, state.ki + Math.ceil(state.maxKi * 0.12));
      note(`Derrotou ${template.name} e recebeu ${xp} XP.`);
      $("#objective-text").textContent = `Vitória! +${xp} XP. A próxima etapa aguarda.`;
      $("#story-continue").hidden = false;
      $("#story-continue").innerHTML = `VITÓRIA · +${xp} XP <span>CONTINUAR →</span>`;
      $("#story-continue").dataset.nextEvent = battle.nextEvent || "";
      $("#battle-title").textContent = "VITÓRIA!";
      $("#battle-phase").textContent = "ENCONTRO CONCLUÍDO";
      $("#battle-actions").classList.add("disabled-actions");
      pulse("victory"); beep(720, 0.25, "triangle");
      saveGame(false);
    } else {
      state.hp = 0;
      state.defeated = true;
      logBattle(`${state.name} não consegue continuar.`, "system-line");
      $("#objective-text").textContent = "Recupere-se e tente outra abordagem.";
      showModal(`<div class="eyebrow">FIM DE COMBATE</div><h2 class="modal-heading">VOCÊ FOI DERROTADO</h2><p class="modal-copy">O destino da Terra mudou. Seu progresso permanece salvo; escolha como continuar.</p><div class="modal-actions"><button class="modal-action" data-modal-action="retry">RECOMEÇAR BATALHA</button><button class="modal-action" data-modal-action="load">CARREGAR SAVE</button><button class="modal-action danger" data-modal-action="menu">VOLTAR AO MENU</button></div>`);
    }
    renderBattle();
    renderPlayer();
  }

  function fleeBattle() {
    if (!state?.battle || actionLocked) return;
    actionLocked = true;
    if (Math.random() < 0.6) {
      logBattle(`${state.name} consegue recuar do combate.`, "system-line");
      state.battle = null;
      state.battleEscaped = true;
      state.pendingNextEvent = state.eventId;
      toast("Você recuou. A história aguarda.");
      renderAll();
      $("#story-continue").hidden = false;
      $("#story-continue").textContent = "RETOMAR ENCONTRO →";
      $("#story-continue").dataset.nextEvent = state.eventId;
    } else {
      logBattle(`${state.name} tenta fugir, mas ${state.battle.enemy.name} bloqueia a rota.`, "enemy-line");
      state.battle.turn += 1;
      enemyTurn();
      renderBattle();
      if (state.hp <= 0) finishBattle(false); else actionLocked = false;
    }
  }

  function showModal(content) {
    $("#modal-content").innerHTML = content;
    $("#modal-screen").hidden = false;
  }
  function closeModal() { $("#modal-screen").hidden = true; }

  function showTechniquePicker() {
    if (!state?.battle) return;
    const options = state.techniques.map(id => {
      const move = techniqueInfo(id);
      return `<button class="selection-option" data-technique="${id}" ${state.ki < move.kiCost ? "disabled" : ""}><span><b>${escapeHtml(move.name)}</b><small>${escapeHtml(move.description)}</small></span><small>${move.kiCost ? `KI ${move.kiCost}` : "SEM CUSTO"}</small></button>`;
    }).join("");
    showModal(`<div class="eyebrow">ARSENAL // KI ${state.ki}/${state.maxKi}</div><h2 class="modal-heading">Escolha uma técnica</h2><div class="selection-list">${options}</div>`);
  }

  function showTransformationPicker() {
    if (!state?.battle) return;
    const options = state.transformations.map(id => {
      const form = transformationInfo(id);
      const active = state.currentForm === id;
      return `<button class="selection-option" data-transformation="${id}" ${active ? "disabled" : ""}><span><b>${escapeHtml(form.name)}</b><small>Força ×${form.modifiers.strength} · Ki ×${form.modifiers.kiPower}</small></span><small>${active ? "ATIVA" : `DRENO ${form.kiDrain}/T`}</small></button>`;
    }).join("");
    options += `<button class="selection-option" data-transformation="normal" ${state.currentForm === "normal" ? "disabled" : ""}><span><b>Voltar à forma normal</b><small>Interrompe o consumo contínuo de Ki.</small></span><small>KI 0/T</small></button>`;
    showModal(`<div class="eyebrow">TRANSFORMAÇÕES // KI ${state.ki}/${state.maxKi}</div><h2 class="modal-heading">Mude sua forma</h2><div class="selection-list">${options}</div>`);
  }

  function showItemPicker() {
    if (!state?.battle) return;
    const options = Object.entries(state.inventory).map(([id, quantity]) => {
      const isSenzu = id === "senzu";
      const name = isSenzu ? "Semente dos Deuses" : "Água fresca";
      const description = isSenzu ? `Recupera ${Math.ceil(state.maxHp * 0.75)} HP.` : `Recupera ${Math.ceil(state.maxKi * 0.35)} Ki.`;
      return `<button class="selection-option" data-item="${id}" ${quantity < 1 ? "disabled" : ""}><span><b>${name}</b><small>${description}</small></span><small>×${quantity}</small></button>`;
    }).join("");
    showModal(`<div class="eyebrow">INVENTÁRIO DE CAMPO</div><h2 class="modal-heading">Escolha um item</h2><div class="selection-list">${options || "<p class='modal-copy'>Nenhum item disponível.</p>"}</div>`);
  }

  function consumeItem(id) {
    if (!state?.battle || !state.inventory[id]) return;
    const amount = id === "senzu" ? Math.ceil(state.maxHp * 0.75) : Math.ceil(state.maxKi * 0.35);
    if ((id === "senzu" && state.hp === state.maxHp) || (id === "water" && state.ki === state.maxKi)) return toast("Esse recurso já está no máximo.");
    state.inventory[id] -= 1;
    if (!state.inventory[id]) delete state.inventory[id];
    if (id === "senzu") state.hp = Math.min(state.maxHp, state.hp + amount); else state.ki = Math.min(state.maxKi, state.ki + amount);
    closeModal();
    logBattle(`${state.name} usa ${id === "senzu" ? "uma Semente dos Deuses" : "água fresca"}. +${amount} ${id === "senzu" ? "HP" : "Ki"}.`);
    actionLocked = true;
    resolvePlayerTurn();
  }

  function transformTo(id) {
    if (!state?.battle) return;
    closeModal();
    state.currentForm = id;
    if (id !== "normal") state.flags[transformationInfo(id).requirements.flag] = true;
    logBattle(id === "normal" ? `${state.name} retorna à forma normal.` : `${state.name} se transforma em ${transformationInfo(id).name}! Seu poder cresce.`, "system-line");
    pulse("gold"); beep(520, 0.2, "sawtooth");
    actionLocked = true;
    resolvePlayerTurn();
  }

  function retryBattle() {
    const event = eventInfo(state.eventId);
    state.hp = Math.max(1, Math.round(state.maxHp * 0.75));
    state.ki = Math.max(state.ki, Math.round(state.maxKi * 0.45));
    state.currentForm = "normal";
    state.defeated = false;
    closeModal();
    beginBattle(event.battle);
    toast("Uma nova tentativa. O campo aguarda.");
    actionLocked = false;
  }

  function renderPlayer() {
    if (!state) return;
    const hpRatio = Math.max(0, state.hp / state.maxHp * 100);
    const kiRatio = Math.max(0, state.ki / state.maxKi * 100);
    const xpRatio = Math.max(0, state.xp / xpForLevel(state.level) * 100);
    $("#player-name").textContent = state.name;
    $("#player-race-label").textContent = state.race === "saiyan" ? "SAIYAJIN" : state.race.toUpperCase();
    $("#player-level").textContent = state.level;
    $("#player-form").textContent = transformationInfo(state.currentForm).name.toUpperCase();
    $("#power-level").textContent = playerPower().toLocaleString("pt-BR");
    $("#hp-text").textContent = `${state.hp} / ${state.maxHp}`;
    $("#ki-text").textContent = `${state.ki} / ${state.maxKi}`;
    $("#hp-bar").style.width = `${hpRatio}%`;
    $("#ki-bar").style.width = `${kiRatio}%`;
    $("#xp-text").textContent = `${state.xp} / ${xpForLevel(state.level)}`;
    $("#xp-bar").style.width = `${xpRatio}%`;
    $("#stat-grid").innerHTML = [["FOR", state.strength], ["DEF", state.defense], ["VEL", state.speed], ["KI", state.kiPower]].map(([label, value]) => `<div class="stat-item"><span>${label}</span><b>${value}</b></div>`).join("");
    $("#combat-player-name").textContent = state.name;
    $("#combat-player-level").textContent = `NÍVEL ${String(state.level).padStart(2, "0")}`;
    $("#combat-player-hp-text").textContent = `${state.hp} / ${state.maxHp}`;
    $("#combat-player-ki-text").textContent = `${state.ki} / ${state.maxKi}`;
    $("#combat-player-hp-bar").style.width = `${hpRatio}%`;
    $("#combat-player-ki-bar").style.width = `${kiRatio}%`;
    $("#avatar-glyph use").setAttribute("href", "#icon-saiyan");
    $("#item-count").textContent = String(Object.values(state.inventory).reduce((sum, count) => sum + count, 0)).padStart(2, "0");
    $("#codex-count").textContent = String(state.codex.characters.length + state.codex.enemies.length + state.codex.techniques.length + state.codex.transformations.length).padStart(2, "0");
    $("#journal-count").textContent = String(state.journal.length).padStart(2, "0");
    renderSidebar();
  }

  function renderSidebar() {
    const allies = Object.entries(state.relationships).filter(([id]) => ["goku", "piccolo", "krillin", "gohan"].includes(id) && state.codex.characters.includes(id)).sort((a, b) => b[1] - a[1]);
    $("#ally-count").textContent = String(allies.length).padStart(2, "0");
    $("#ally-list").innerHTML = allies.slice(0, 4).map(([id, score]) => `<div class="ally-row"><span class="ally-glyph">${iconMarkup(fighterIcon(id))}</span><div><div class="ally-name">${characterInfo(id).name}</div><div class="ally-role">${characterInfo(id).personality.split(",")[0]}</div></div><span class="bond-score">${score > 0 ? "+" : ""}${score}</span></div>`).join("");
    $("#equipped-techniques").innerHTML = state.techniques.slice(0, 4).map(id => `<div class="tech-row"><b>${escapeHtml(techniqueInfo(id).name)}</b><small>${techniqueInfo(id).kiCost ? `${techniqueInfo(id).kiCost} KI` : "FÍSICO"}</small></div>`).join("");
  }

  function renderEvent() {
    const event = eventInfo(state.eventId);
    if (!event) return;
    $("#story-heading").textContent = event.title;
    $("#story-location").textContent = event.location.toUpperCase();
    $("#story-time").textContent = event.time;
    $("#story-text").innerHTML = event.text.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join("");
    $("#chapter-chip").textContent = `CAPÍTULO ${String(progressIndex() + 1).padStart(2, "0")}`;
    $("#arc-title").textContent = window.ARCS[state.arcId].title;
    $("#arc-subtitle").textContent = window.ARCS[state.arcId].subtitle;
    $("#arc-eyebrow").textContent = `ARCO 01 // ${event.location.split(" ").slice(-2).join(" ").toUpperCase()}`;
    const total = window.ARCS[state.arcId].chapters.length;
    const percent = (progressIndex() + 1) / total * 100;
    $("#arc-progress-text").innerHTML = `${String(progressIndex() + 1).padStart(2, "0")} <i>/</i> ${String(total).padStart(2, "0")}`;
    $("#arc-progress-bar").style.width = `${percent}%`;
    $("#objective-text").textContent = event.objective || event.choices?.[0]?.label || (event.id === "campaign_break" ? "A Saga Saiyajin foi concluída." : "Siga em frente.");
    $("#objective-step").textContent = `${String(progressIndex() + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
    $("#field-note-text").textContent = event.battle ? "Leia o padrão do adversário; Ki e defesa valem mais quando o turno importa." : (event.text[1] || event.text[0]).slice(0, 110);
    const availableChoices = (event.choices || []).filter(choice => !choice.hideWhenFlag || !state.flags[choice.hideWhenFlag]);
    $("#choice-list").innerHTML = availableChoices.map((choice, index) => `<button class="choice-button" data-choice="${index}"><b>${escapeHtml(choice.label)}</b><small>${escapeHtml(choice.detail || "")}</small><span class="choice-arrow">↗</span></button>`).join("");
    $("#story-continue").hidden = true;
    $("#chapter-label").textContent = `${event.location.toUpperCase()} // ${event.time}`;
    $("#battle-panel").hidden = !state.battle;
    $("#story-panel").classList.toggle("battle-story", Boolean(state.battle));
    $("#story-panel").hidden = Boolean(state.battle);
    if (event.battle && !state.battle && !state.battleEscaped) beginBattle(event.battle, event.objective);
  }

  function renderBattle() {
    if (!state?.battle) return;
    const battle = state.battle;
    const enemy = battle.enemy;
    $("#battle-panel").hidden = false;
    $("#story-panel").hidden = true;
    $("#battle-title").textContent = battle.resolved ? "VITÓRIA!" : "ENCONTRO HOSTIL";
    $("#enemy-name").textContent = enemy.name;
    $("#enemy-level").textContent = `NÍVEL ${String(enemy.level).padStart(2, "0")}`;
    $("#enemy-sigil").innerHTML = iconMarkup(enemyIcon(battle.enemyId));
    $("#enemy-hp-text").textContent = `${enemy.hp} / ${enemy.maxHp}`;
    $("#enemy-ki-text").textContent = `${enemy.ki} / ${enemy.maxKi}`;
    $("#enemy-hp-bar").style.width = `${Math.max(0, enemy.hp / enemy.maxHp * 100)}%`;
    $("#enemy-ki-bar").style.width = `${enemy.maxKi ? Math.max(0, enemy.ki / enemy.maxKi * 100) : 0}%`;
    $("#battle-phase").textContent = battle.enemyPhaseName || `FASE ${String(enemy.phaseIndex + 1).padStart(2, "0")}`;
    $("#turn-count").textContent = String(battle.turn).padStart(2, "0");
    $("#battle-log").innerHTML = battle.log.map(line => typeof line === "string" ? `<p class="battle-line">${escapeHtml(line)}</p>` : `<p class="battle-line ${line.kind || ""}">${escapeHtml(line.message)}</p>`).join("");
    $("#battle-log").scrollTop = $("#battle-log").scrollHeight;
    $$("#battle-actions button").forEach(button => { button.disabled = battle.resolved || actionLocked; });
    $("#battle-actions").classList.toggle("disabled-actions", battle.resolved);
    $("#transform-action-label").textContent = state.transformations.length > 1 ? `${state.transformations.length} forma(s) disponíveis` : "Nenhuma forma nova";
    renderPlayer();
  }

  function renderMap() {
    const places = window.ARCS[state.arcId].locations;
    const unlockedIndex = Math.min(places.length - 1, Math.floor(progressIndex() / window.ARCS[state.arcId].chapters.length * places.length));
    $("#map-view").innerHTML = `<div class="utility-title"><div><span class="eyebrow">NAVEGAÇÃO // ${window.ARCS[state.arcId].title}</span><h2>Mapa de campanha</h2></div><p>TERRA // SETOR NORTE</p></div><div class="map-grid">${places.map((place, index) => `<div class="map-stop ${index === unlockedIndex ? "active" : index < unlockedIndex ? "visited" : "locked"}"><b>${iconMarkup(index > unlockedIndex ? "capsule" : "map")}${escapeHtml(place)}</b><span>${index > unlockedIndex ? "BLOQUEADO" : index === unlockedIndex ? "LOCAL ATUAL" : "VISITADO"}</span><small>${index > unlockedIndex ? "SINAL INDISPONÍVEL" : `PONTO ${String(index + 1).padStart(2, "0")}`}</small></div>`).join("")}</div><div class="utility-title" style="margin-top:26px"><div><span class="eyebrow">ARQUIVOS DE CAMPANHA</span><h2>Arcos</h2></div><p>O restante da linha do tempo permanece selado.</p></div><div class="map-grid">${[["saiyan", "Saga Saiyajin"], ["frieza", "Saga Freeza"], ["android", "Saga Androides"], ["cell", "Saga Cell"], ["buu", "Saga Majin Boo"]].map(([id, title], index) => `<div class="map-stop ${id === state.arcId ? "active" : "locked"}"><b>${iconMarkup(id === state.arcId ? "dragon-ball" : "capsule")}${title}</b><span>${id === state.arcId ? (state.completed.includes(id) ? "CONCLUÍDO" : "EM ANDAMENTO") : "EM DESENVOLVIMENTO"}</span><small>ARCO ${String(index + 1).padStart(2, "0")}</small></div>`).join("")}</div>`;
  }

  function renderInventory() {
    const items = [["senzu", "Semente dos Deuses", "Recupera 75% da Vida máxima.", "senzu"], ["water", "Água fresca", "Recupera 35% do Ki máximo.", "ki"], ["scouter", "Rastreador danificado", "Um aparelho que detecta assinaturas de energia.", "scouter"]];
    $("#inventory-view").innerHTML = `<div class="utility-title"><div><span class="eyebrow">SUPRIMENTOS // ${Object.values(state.inventory).reduce((a, b) => a + b, 0)} UNIDADES</span><h2>Inventário</h2></div><p>Itens são consumidos dentro do combate.</p></div><div class="inventory-grid">${items.map(([id, name, description, icon]) => `<article class="inventory-item"><span class="item-icon">${iconMarkup(icon)}</span><div><b>${name}</b><p>${description}</p></div><strong class="item-qty">×${state.inventory[id] || (id === "scouter" ? 1 : 0)}</strong></article>`).join("")}</div><div class="utility-title" style="margin-top:26px"><div><span class="eyebrow">RECURSOS DE CAMPO</span><h2>Recuperação</h2></div><p>O carregamento de Ki recupera energia sem consumir item.</p></div><div class="field-note"><span class="note-mark">!</span><div><b>SEMENTE DOS DEUSES</b><p>Uso único por ação; restaura a maior parte da Vida e o inimigo age em seguida.</p></div></div>`;
  }

  function renderCodex() {
    const categories = ["PERSONAGENS", "INIMIGOS", "TÉCNICAS", "TRANSFORMAÇÕES", "ARCOS"];
    const list = currentCodexFilter === "PERSONAGENS" ? Object.entries(window.CHARACTERS).map(([id, item]) => ({ id, name: item.name, description: item.description, icon: fighterIcon(id), known: state.codex.characters.includes(id) }))
      : currentCodexFilter === "INIMIGOS" ? Object.entries(window.ENEMIES).map(([id, item]) => ({ id, name: item.name, description: `${item.ai.toUpperCase()} · NÍVEL ${item.level} · PODER ${item.powerLevel.toLocaleString("pt-BR")}`, icon: enemyIcon(id), known: state.codex.enemies.includes(id) }))
      : currentCodexFilter === "TÉCNICAS" ? Object.entries(window.ATTACKS).map(([id, item]) => ({ id, name: item.name, description: item.description, icon: item.type === "physical" ? "fist" : "ki", known: state.codex.techniques.includes(id) }))
      : currentCodexFilter === "TRANSFORMAÇÕES" ? Object.entries(window.TRANSFORMATIONS).map(([id, item]) => ({ id, name: item.name, description: `Multiplicador de poder ×${item.multiplier} · dreno ${item.kiDrain} Ki/turno`, icon: "saiyan", known: state.codex.transformations.includes(id) }))
      : Object.entries(window.ARCS).map(([id, item]) => ({ id, name: item.title, description: item.subtitle, icon: "dragon-ball", known: state.codex.arcs.includes(id) }));
    $("#codex-view").innerHTML = `<div class="utility-title"><div><span class="eyebrow">ARQUIVO DE INTELIGÊNCIA // ${state.codex.characters.length + state.codex.enemies.length} CONTATOS</span><h2>Codex</h2></div><p>Conhecimento encontrado ao longo da jornada.</p></div><div class="codex-tabs">${categories.map(category => `<button class="codex-filter ${currentCodexFilter === category ? "active" : ""}" data-codex-filter="${category}">${category}</button>`).join("")}</div><div class="codex-grid">${list.map(item => `<article class="codex-item ${item.known ? "" : "locked"}"><span class="item-icon">${iconMarkup(item.known ? item.icon : "unknown")}</span><div><b>${item.known ? escapeHtml(item.name) : "???"}</b><p>${item.known ? escapeHtml(item.description) : "Informações não descobertas."}</p></div></article>`).join("")}</div>`;
  }

  function renderJournal() {
    $("#journal-view").innerHTML = `<div class="utility-title"><div><span class="eyebrow">MEMÓRIA DE CAMPANHA // ${state.journal.length} REGISTROS</span><h2>Diário</h2></div><p>Os acontecimentos recentes aparecem primeiro.</p></div><div class="journal-list">${state.journal.map(entry => `<article class="journal-entry"><time>${escapeHtml(entry.day)}</time><p>${escapeHtml(entry.text)}</p></article>`).join("") || "<p class='modal-copy'>Nenhum registro ainda.</p>"}</div>`;
  }

  function renderBonds() {
    const people = Object.entries(window.CHARACTERS);
    $("#bonds-view").innerHTML = `<div class="utility-title"><div><span class="eyebrow">RELAÇÕES // ESCOLHAS E CONFIANÇA</span><h2>Vínculos</h2></div><p>Laços podem abrir diálogos, treino e apoio.</p></div><div class="bond-list">${people.map(([id, person]) => {
      const score = state.relationships[id] || 0;
      const bar = Math.max(0, Math.min(100, score + 50));
      return `<article class="bond-card"><div class="bond-card-head"><span class="ally-glyph">${iconMarkup(fighterIcon(id))}</span><h3>${person.name}</h3></div><p>${person.personality}</p><div class="bond-meter"><i style="width:${bar}%"></i></div><div class="bond-caption"><span>${score < -20 ? "TENSÃO" : score > 20 ? "CONFIANÇA" : "CAUTELO"}</span><b>${score > 0 ? "+" : ""}${score}</b></div></article>`;
    }).join("")}</div>`;
  }

  function renderUtilityViews() {
    renderMap(); renderInventory(); renderCodex(); renderJournal(); renderBonds();
  }

  function switchTab(tab) {
    if (!state) return;
    currentTab = tab;
    $$(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.tab === tab));
    $$(".content-view").forEach(view => view.hidden = view.id !== `${tab}-view`);
    if (tab === "story") renderEvent();
  }

  function updateCounts() {
    if (!state) return;
    $("#journal-count").textContent = String(state.journal.length).padStart(2, "0");
    $("#codex-count").textContent = String(state.codex.characters.length + state.codex.enemies.length + state.codex.techniques.length + state.codex.transformations.length).padStart(2, "0");
  }

  function renderAll() {
    if (!state) return;
    $("#title-screen").hidden = true;
    $("#creator-screen").hidden = true;
    $("#game-layout").hidden = false;
    renderPlayer();
    renderEvent();
    renderUtilityViews();
    if (state.battle) renderBattle();
    switchTab(currentTab);
  }

  function saveGame(showToast = true) {
    if (!state) return;
    state.lastSaved = new Date().toISOString();
    const snapshot = clone(state);
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
      $("#save-status").textContent = `SALVO LOCAL // ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
      if (showToast) toast("Partida salva neste navegador.", "good");
    } catch {
      if (showToast) toast("Não foi possível salvar neste navegador.", "bad");
    }
  }

  function loadGame(showToast = true) {
    try {
      const parsed = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!parsed || parsed.version !== 1 || !parsed.name) return false;
      state = { ...clone(defaults), ...parsed, version: 1 };
      state.relationships = { ...defaults.relationships, ...parsed.relationships };
      state.codex = { ...clone(defaults.codex), ...parsed.codex };
      if (state.battle?.resolved) state.battle = null;
      actionLocked = false;
      currentTab = "story";
      renderAll();
      if (showToast) toast(`Dados de ${state.name} carregados.`, "good");
      return true;
    } catch { return false; }
  }

  function updateContinueIndicator() {
    const exists = Boolean(localStorage.getItem(SAVE_KEY));
    $("#continue-indicator").textContent = exists ? "// DADOS ENCONTRADOS" : "// SEM DADOS";
    $("#continue-button").disabled = !exists;
    $("#continue-button").style.opacity = exists ? "1" : ".55";
  }

  function openTitle() {
    if (state) saveGame(false);
    state = null;
    $("#game-layout").hidden = true;
    $("#title-screen").hidden = false;
    $("#creator-screen").hidden = true;
    $("#modal-screen").hidden = true;
    updateContinueIndicator();
  }

  function showSettings() {
    showModal(`<div class="eyebrow">AJUSTES // PREFERÊNCIAS LOCAIS</div><h2 class="modal-heading">Configurações</h2><p class="modal-copy">Efeitos sonoros são sintetizados no navegador e permanecem desligados até você ativá-los. O salvamento usa armazenamento local deste dispositivo.</p><div class="modal-actions"><button class="modal-action" data-modal-action="sound">${soundEnabled ? "DESATIVAR" : "ATIVAR"} EFEITOS SONOROS</button><button class="modal-action" data-modal-action="save">SALVAR AGORA</button></div>`);
  }

  function showMenu() {
    if (!state) return openTitle();
    showModal(`<div class="eyebrow">PAUSA // CAMPANHA EM ANDAMENTO</div><h2 class="modal-heading">Menu da jornada</h2><p class="modal-copy">A campanha é salva automaticamente ao avançar eventos e terminar batalhas.</p><div class="modal-actions"><button class="modal-action" data-modal-action="save">SALVAR PARTIDA</button><button class="modal-action" data-modal-action="settings">CONFIGURAÇÕES</button><button class="modal-action" data-modal-action="title">VOLTAR AO MENU</button><button class="modal-action danger" data-modal-action="new">NOVO JOGO</button></div>`);
  }

  function makeSparks() {
    const container = $("#spark-field");
    for (let index = 0; index < 48; index += 1) {
      const spark = document.createElement("i");
      spark.className = "spark";
      spark.style.left = `${Math.random() * 100}%`;
      spark.style.top = `${Math.random() * 100}%`;
      spark.style.setProperty("--duration", `${3 + Math.random() * 7}s`);
      spark.style.setProperty("--delay", `${-Math.random() * 8}s`);
      container.append(spark);
    }
  }

  function bindEvents() {
    $("#new-game-button").addEventListener("click", () => { $("#title-screen").hidden = true; $("#creator-screen").hidden = false; });
    $("#continue-button").addEventListener("click", () => { if (!loadGame()) toast("Nenhum arquivo de campanha encontrado.", "bad"); });
    $("#settings-button").addEventListener("click", showSettings);
    $("#about-button").addEventListener("click", () => showModal(`<div class="eyebrow">SOBRE // ARQUIVO 01</div><h2 class="modal-heading">Uma nova linha do tempo</h2><p class="modal-copy">Uma aventura independente de RPG textual inspirada em Dragon Ball Z. As decisões, o personagem do jogador e os diálogos são originais. Esta primeira campanha acompanha a Saga Saiyajin; os sistemas de dados já estão organizados para novos arcos.</p><p class="modal-copy">Feito para jogar localmente, sem instalação e sem dependências de runtime.</p>`));
    $("#character-form").addEventListener("submit", event => {
      event.preventDefault();
      state = makeNewState(new FormData(event.currentTarget));
      state.version = 1;
      currentTab = "story";
      enterEvent("opening");
      saveGame(false);
    });
    $("#save-button").addEventListener("click", () => saveGame(true));
    $("#menu-button").addEventListener("click", showMenu);
    $("#sound-button").addEventListener("click", event => {
      soundEnabled = !soundEnabled;
      event.currentTarget.classList.toggle("sound-on", soundEnabled);
      event.currentTarget.setAttribute("aria-label", soundEnabled ? "Desativar efeitos sonoros" : "Ativar efeitos sonoros");
      toast(soundEnabled ? "Efeitos sonoros ativados." : "Efeitos sonoros desativados.");
      beep(460, 0.1);
    });
    $("#character-name").addEventListener("input", event => { event.currentTarget.value = event.currentTarget.value.replace(/[<>]/g, ""); });
    $$('[name="style"]').forEach(input => input.addEventListener("change", () => {
      $$(".style-choice").forEach(label => label.classList.toggle("selected", label.querySelector("input").checked));
    }));
    $$("[data-tab]").forEach(button => button.addEventListener("click", () => switchTab(button.dataset.tab)));
    $$('[data-open-tab]').forEach(button => button.addEventListener("click", () => switchTab(button.dataset.openTab)));
    $("#open-attributes").addEventListener("click", () => switchTab("codex"));
    $("#game-layout").addEventListener("click", event => {
      const choiceButton = event.target.closest("[data-choice]");
      if (choiceButton) {
        const choices = (eventInfo(state.eventId).choices || []).filter(item => !item.hideWhenFlag || !state.flags[item.hideWhenFlag]);
        const choice = choices[Number(choiceButton.dataset.choice)];
        chooseEvent(choice);
        return;
      }
      const actionButton = event.target.closest("[data-action]");
      if (actionButton) playerAction(actionButton.dataset.action);
      const filterButton = event.target.closest("[data-codex-filter]");
      if (filterButton) { currentCodexFilter = filterButton.dataset.codexFilter; renderCodex(); }
    });
    $("#story-continue").addEventListener("click", event => {
      const next = event.currentTarget.dataset.nextEvent;
      if (next) enterEvent(next);
      else if (state.pendingNextEvent) enterEvent(state.pendingNextEvent);
      else if (state.battle?.nextEvent) enterEvent(state.battle.nextEvent);
    });
    $("#modal-screen").addEventListener("click", event => {
      if (event.target === event.currentTarget || event.target.closest("[data-close-overlay]")) return closeModal();
      const technique = event.target.closest("[data-technique]");
      if (technique) return useTechnique(technique.dataset.technique);
      const form = event.target.closest("[data-transformation]");
      if (form) return transformTo(form.dataset.transformation);
      const item = event.target.closest("[data-item]");
      if (item) return consumeItem(item.dataset.item);
      const action = event.target.closest("[data-modal-action]")?.dataset.modalAction;
      if (!action) return;
      if (action === "retry") retryBattle();
      else if (action === "load") { closeModal(); if (!loadGame()) toast("Nenhum save disponível.", "bad"); }
      else if (action === "menu" || action === "title") { closeModal(); openTitle(); }
      else if (action === "save") { saveGame(); }
      else if (action === "settings") showSettings();
      else if (action === "sound") { soundEnabled = !soundEnabled; showSettings(); }
      else if (action === "new") { closeModal(); $("#title-screen").hidden = true; $("#creator-screen").hidden = false; }
    });
    $("#creator-screen [data-close-overlay]").addEventListener("click", () => { $("#creator-screen").hidden = true; $("#title-screen").hidden = false; });
    window.addEventListener("beforeunload", () => { if (state) saveGame(false); });
  }

  function initialize() {
    makeSparks();
    bindEvents();
    updateContinueIndicator();
  }

  initialize();
})();
