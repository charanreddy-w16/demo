(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const game = $("#game"), layer = $("#ladooLayer"), player = $("#player");
  const scoreEl = $("#score"), highEl = $("#highScore"), levelEl = $("#level");
  const healthFill = $("#healthFill"), healthText = $("#healthText"), levelProgress = $("#levelProgress");
  const startOverlay = $("#startOverlay"), pauseOverlay = $("#pauseOverlay"), gameOverOverlay = $("#gameOverOverlay");
  const finalScore = $("#finalScore"), newRecord = $("#newRecord"), powerStatus = $("#powerStatus");

  let state = {
    running:false, paused:false, gameOver:false, score:0, health:100, level:1,
    lastTime:0, spawnTimer:0, spawnEvery:1350, id:0, playerX:50,
    speedBoost:1, shield:false, double:false, rapidUntil:0, shieldUntil:0, doubleUntil:0,
    active:[], particles:[], sound:true
  };

  const letters = "ASDFGHJKLQWERTYUIOPZXCVBNM";
  const types = [
    {name:"classic", hp:1, points:10, minLevel:1, speed:0.055},
    {name:"golden", hp:2, points:20, minLevel:2, speed:0.067},
    {name:"fiery", hp:3, points:35, minLevel:4, speed:0.082},
    {name:"crystal", hp:1, points:50, minLevel:6, speed:0.095}
  ];

  let audioCtx = null;
  function tone(freq, duration=.08, type="sine", volume=.035) {
    if (!state.sound) return;
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = type; o.frequency.value = freq; g.gain.value = volume;
      o.connect(g); g.connect(audioCtx.destination); o.start();
      g.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + duration);
      o.stop(audioCtx.currentTime + duration);
    } catch {}
  }
  function grabSound(){ tone(520,.06,"square"); setTimeout(()=>tone(760,.07,"sine"),35); }
  function powerSound(){ tone(420,.08,"triangle"); setTimeout(()=>tone(650,.08,"triangle"),65); setTimeout(()=>tone(900,.11,"triangle"),130); }
  function gameOverSound(){ tone(240,.16,"sawtooth"); setTimeout(()=>tone(150,.25,"sawtooth"),130); }

  function getHigh(){ return Number(localStorage.getItem("ladooCollectorHigh") || 0); }
  function setHigh(v){ localStorage.setItem("ladooCollectorHigh", String(v)); }
  highEl.textContent = getHigh();

  function clamp(n,a,b){ return Math.max(a,Math.min(b,n)); }
  function levelFromScore(s){ return 1 + Math.floor(s / 180); }

  function updateHUD() {
    scoreEl.textContent = state.score;
    levelEl.textContent = state.level;
    healthText.textContent = Math.max(0, Math.ceil(state.health));
    healthFill.style.width = clamp(state.health,0,100) + "%";
    const inLevel = state.score % 180;
    levelProgress.style.width = (inLevel / 180 * 100) + "%";
    highEl.textContent = getHigh();
  }

  function setPlayerX(pct) {
    state.playerX = clamp(pct, 7, 93);
    player.style.left = state.playerX + "%";
  }

  function makeLadoo() {
    if (!state.running || state.paused || state.gameOver) return;
    const eligible = types.filter(t => t.minLevel <= state.level);
    // Higher tiers become more likely as the level rises.
    let t = eligible[Math.floor(Math.random() * eligible.length)];
    if (state.level < 2) t = types[0];
    const letter = letters[Math.floor(Math.random() * letters.length)];
    const el = document.createElement("div");
    el.className = `ladoo ${t.name}`;
    el.dataset.letter = letter;
    el.dataset.hp = t.hp;
    el.dataset.maxHp = t.hp;
    el.dataset.points = t.points;
    el.dataset.speed = t.speed;
    el.dataset.id = ++state.id;
    el.innerHTML = `<div class="ball"><span class="letter">${letter}</span></div>`;
    const x = 7 + Math.random() * 86;
    el.style.left = x + "%";
    el.style.top = "-72px";
    layer.appendChild(el);
    state.active.push({el, y:-72, x, type:t, id:state.id, rot:(Math.random()*30-15)});
  }

  function destroyLadoo(item, hitX, hitY, points=true) {
    if (!item.el.isConnected) return;
    if (points) {
      const mult = state.double ? 2 : 1;
      state.score += item.type.points * mult;
      tone(item.type.name === "crystal" ? 980 : 720,.07,"sine");
      burst(hitX, hitY, item.type.name === "crystal" ? 18 : 12);
    } else {
      burst(hitX, hitY, 15);
    }
    item.el.remove();
    state.active = state.active.filter(x => x !== item);
    updateLevel();
  }

  function damageLadoo(item) {
    const hp = Number(item.el.dataset.hp) - 1;
    item.el.dataset.hp = hp;
    if (hp <= 0) {
      destroyLadoo(item, item.el.offsetLeft + item.el.offsetWidth/2, item.y + 30, true);
    } else {
      item.el.classList.remove("damaged"); void item.el.offsetWidth; item.el.classList.add("damaged");
      tone(180,.06,"square");
    }
  }

  function collectByLetter(letter) {
    if (!state.running || state.paused || state.gameOver) return;
    letter = letter.toUpperCase();
    const candidates = state.active.filter(x => x.el.dataset.letter === letter);
    if (!candidates.length) return;
    // Grab the lowest matching ladoo first.
    const item = candidates.sort((a,b)=>b.y-a.y)[0];
    player.classList.add("grabbing");
    setTimeout(()=>player.classList.remove("grabbing"), state.rapidUntil > performance.now() ? 70 : 150);
    damageLadoo(item);
    grabSound();
  }

  function burst(x,y,n=12) {
    for(let i=0;i<n;i++){
      const p=document.createElement("i");
      p.className="particle";
      p.style.left=x+"px"; p.style.top=y+"px";
      const a=Math.random()*Math.PI*2, d=30+Math.random()*80;
      p.style.setProperty("--dx", Math.cos(a)*d+"px");
      p.style.setProperty("--dy", Math.sin(a)*d+"px");
      p.style.background = ["#ffd84d","#ff4aa5","#42e9ff","#ffffff"][Math.floor(Math.random()*4)];
      $("#particles").appendChild(p);
      setTimeout(()=>p.remove(),600);
    }
  }

  function miss(item) {
    const x = item.el.offsetLeft + 30, y = game.clientHeight - 73;
    burst(x,y,16);
    item.el.remove();
    state.active = state.active.filter(x=>x!==item);
    if (state.shield && state.shieldUntil > performance.now()) {
      state.shield = false; state.shieldUntil = 0; tone(850,.1,"triangle");
      player.classList.add("hit"); setTimeout(()=>player.classList.remove("hit"),300);
    } else {
      state.health -= 20;
      player.classList.add("hit"); setTimeout(()=>player.classList.remove("hit"),300);
      tone(110,.13,"sawtooth");
      if (state.health <= 0) endGame();
    }
    updateHUD();
  }

  function updateLevel() {
    const next = levelFromScore(state.score);
    if (next !== state.level) {
      state.level = next;
      state.spawnEvery = Math.max(470, 1350 - (state.level-1)*105);
      burst(game.clientWidth/2, 90, 25);
      tone(580,.08,"triangle"); setTimeout(()=>tone(820,.1,"triangle"),80);
    }
    updateHUD();
  }

  function spawnPower() {
    // Powers appear as special collectible falling tokens, typed with P/S/D.
    const powers = [
      {kind:"rapid", letter:"P", icon:"⚡"},
      {kind:"shield", letter:"S", icon:"🛡️"},
      {kind:"double", letter:"D", icon:"×2"}
    ];
    const pow = powers[Math.floor(Math.random()*powers.length)];
    const el=document.createElement("div");
    el.className=`ladoo crystal power-${pow.kind}`;
    el.dataset.letter=pow.letter; el.dataset.hp=1; el.dataset.points=0;
    el.innerHTML=`<div class="ball"><span class="letter">${pow.icon}</span></div>`;
    el.style.left=(8+Math.random()*84)+"%"; el.style.top="-72px";
    layer.appendChild(el);
    const item={el,y:-72,x:0,type:{name:"power",points:0,speed:.055},power:pow,id:++state.id,rot:0};
    state.active.push(item);
  }

  function activatePower(kind) {
    const now=performance.now();
    if(kind==="rapid") state.rapidUntil=now+8500;
    if(kind==="shield"){state.shield=true;state.shieldUntil=now+12000;}
    if(kind==="double") state.doubleUntil=now+9000;
    state.double = kind==="double" ? true : state.double;
    powerSound();
    burst(game.clientWidth/2,120,20);
    updatePowerUI();
  }

  function updatePowerUI() {
    const now=performance.now();
    const data=[
      ["rapid",state.rapidUntil,"rapidTimer"],
      ["shield",state.shieldUntil,"shieldTimer"],
      ["double",state.doubleUntil,"doubleTimer"]
    ];
    powerStatus.innerHTML="";
    for(const [kind,until,id] of data){
      const left=Math.max(0,until-now);
      const active=left>0 || (kind==="shield" && state.shield);
      document.querySelector(`[data-power="${kind}"]`).classList.toggle("active",active);
      $("#"+id).textContent=left>0 ? (left/1000).toFixed(1)+"s" : "—";
      if(active){ const pill=document.createElement("span");pill.className=`status-pill ${kind}`;pill.textContent=kind==="rapid"?"⚡ RAPID":kind==="shield"?"🛡 SHIELD":"×2 SCORE";powerStatus.appendChild(pill); }
    }
    if(state.double && now>=state.doubleUntil) state.double=false;
    if(state.shield && now>=state.shieldUntil) state.shield=false;
  }

  function frame(now) {
    if (!state.running || state.gameOver) return;
    const dt=Math.min(40, now-state.lastTime||16);
    state.lastTime=now;
    if (!state.paused) {
      state.spawnTimer += dt;
      if(state.spawnTimer >= state.spawnEvery){
        state.spawnTimer=0; makeLadoo();
        if(Math.random() < Math.min(.22, .05+state.level*.015)) spawnPower();
      }

      const speedScale = 1 + (state.level-1)*.095;
      for(const item of [...state.active]){
        const pxPerMs = item.type.speed * speedScale * (state.rapidUntil>now ? 1.02 : 1);
        item.y += dt * pxPerMs;
        item.rot += dt*.03;
        item.el.style.transform=`translateY(${item.y}px) rotate(${item.rot}deg)`;
        const ground = game.clientHeight - 135;
        if(item.y > ground){
          if(item.power){
            // Powers disappear safely if missed.
            item.el.remove(); state.active=state.active.filter(x=>x!==item);
          } else miss(item);
        }
      }
      updatePowerUI();
    }
    requestAnimationFrame(frame);
  }

  function startGame() {
    // Clean previous objects.
    state.active.forEach(x=>x.el.remove());
    state.active=[];
    state.running=true;state.paused=false;state.gameOver=false;
    state.score=0;state.health=100;state.level=1;state.spawnEvery=1350;state.spawnTimer=0;
    state.playerX=50;state.shield=false;state.double=false;state.rapidUntil=0;state.shieldUntil=0;state.doubleUntil=0;
    setPlayerX(50); updateHUD(); updatePowerUI();
    startOverlay.classList.remove("active");pauseOverlay.classList.remove("active");gameOverOverlay.classList.remove("active");
    tone(520,.08,"triangle");setTimeout(()=>tone(780,.12,"triangle"),90);
    state.lastTime=performance.now();
    requestAnimationFrame(frame);
  }

  function pauseGame() {
    if(!state.running || state.gameOver) return;
    state.paused=true;pauseOverlay.classList.add("active");
  }
  function resumeGame() {
    if(!state.running || state.gameOver) return;
    state.paused=false;pauseOverlay.classList.remove("active");state.lastTime=performance.now();requestAnimationFrame(frame);
  }
  function endGame() {
    if(state.gameOver)return;
    state.gameOver=true;state.running=false;state.paused=false;
    const old=getHigh(), isNew=state.score>old;
    if(isNew)setHigh(state.score);
    finalScore.textContent=state.score;
    newRecord.classList.toggle("show",isNew);
    gameOverOverlay.classList.add("active");
    gameOverSound();
    burst(game.clientWidth/2,game.clientHeight/2,45);
    updateHUD();
  }

  function restart(){ startGame(); }

  // Keyboard gameplay.
  document.addEventListener("keydown", e=>{
    if(e.repeat)return;
    if(e.key===" "){ e.preventDefault(); state.paused?resumeGame():pauseGame(); return; }
    if(e.key==="Escape"){ if($("#helpModal").classList.contains("active")) $("#helpModal").classList.remove("active"); return; }
    if(!state.running || state.paused || state.gameOver)return;
    if(/^[a-z]$/i.test(e.key)) {
      const letter=e.key.toUpperCase();
      // Power-up letters have priority when the matching token is present.
      const p=state.active.find(x=>x.power && x.power.letter===letter);
      if(p){activatePower(p.power.kind);p.el.remove();state.active=state.active.filter(x=>x!==p);return;}
      collectByLetter(letter);
    }
  });

  // Touch controls.
  function moveBy(dir){ setPlayerX(state.playerX + dir*7); tone(220,.035,"sine"); }
  document.querySelectorAll(".touch-controls button").forEach(btn=>{
    const action=btn.dataset.action;
    btn.addEventListener("pointerdown",e=>{
      e.preventDefault();
      if(action==="left")moveBy(-1);
      else if(action==="right")moveBy(1);
      else {
        // Mobile GRAB: collect the lowest visible target.
        const item=state.active.filter(x=>!x.power).sort((a,b)=>b.y-a.y)[0];
        if(item) collectByLetter(item.el.dataset.letter);
      }
    });
  });

  // Clicking a ladoo is also a friendly accessibility fallback.
  layer.addEventListener("pointerdown",e=>{
    const el=e.target.closest(".ladoo");
    if(!el)return;
    if(el.dataset.letter) {
      const p=state.active.find(x=>x.el===el);
      if(p?.power){activatePower(p.power.kind);p.el.remove();state.active=state.active.filter(x=>x!==p);}
      else collectByLetter(el.dataset.letter);
    }
  });

  $("#startBtn").onclick=startGame;
  $("#restartBtn").onclick=restart;
  $("#restartSmallBtn").onclick=restart;
  $("#pauseBtn").onclick=()=>state.paused?resumeGame():pauseGame();
  $("#resumeBtn").onclick=resumeGame;
  $("#soundBtn").onclick=()=>{state.sound=!state.sound;$("#soundBtn").textContent=state.sound?"🔊":"🔇";};
  $("#helpBtn").onclick=()=>$("#helpModal").classList.add("active");
  $("#closeHelp").onclick=()=>$("#helpModal").classList.remove("active");
  $("#helpModal").addEventListener("pointerdown",e=>{if(e.target.id==="helpModal")$("#helpModal").classList.remove("active");});

  // Resize keeps the character in bounds.
  window.addEventListener("resize",()=>setPlayerX(state.playerX));

  updateHUD();
  updatePowerUI();
})();
