/* ==========================================================================
   トップページ：施工事例の自動ループスライダー（2026-11-18 追加・ライブラリなし）
   ・JavaScriptが動かない場合は、CSSの横スクロール（scroll-snap）のまま4枚を見られる。
   ・動きを減らす設定（prefers-reduced-motion: reduce）では自動再生しない（手動の横スクロールのまま）。
   ・つなぎ目をなくすため、4枚の複製を必要な数だけ後ろに並べ、1周分（4枚の幅）ずれた位置が
     同じ見た目になることを使って、表示を止めずに位置を巻き戻す。
   ・複製は aria-hidden と inert で、読み上げ・キーボード操作の対象から外す。
     画像のURLは元の4枚と同じなので、通信量は増えない。
   ・ホバー中・フォーカス中・指やマウスで操作中は止まり、操作後は約2.5秒で自然に再開する。
   ・画面外にあるとき・タブが非表示のときは描画処理を止める。
   ・縦方向の指の動きはブラウザに任せる（touch-action: pan-y）ので、ページの縦スクロールを妨げない。
   ========================================================================== */
(function () {
  "use strict";

  var section = document.getElementById("works-strip");
  if (!section || !("IntersectionObserver" in window) || !window.requestAnimationFrame || !window.matchMedia) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduceMotion.matches) return;

  var scroller = section.querySelector(".hw__scroller");
  var track = section.querySelector(".hw__track");
  var head = section.querySelector(".hw__head");
  if (!scroller || !track || !head) return;
  var originals = Array.prototype.slice.call(track.children);
  if (originals.length < 2) return;

  var RESUME_DELAY = 2500; // 操作が終わってから自動再生に戻るまで（ミリ秒）
  var EASE = 350; // 停止・再開時に速度をなめらかに変える時間の目安（ミリ秒）
  var FRICTION = 325; // 指を離した後の慣性が弱まる時間の目安（ミリ秒）

  var pos = 0; // 帯を左へずらしている量（px）
  var period = 0; // 1周分（4枚＋間隔）の幅
  var low = 0; // 位置を保つ範囲の始まり（この位置で1枚目が見出しの左端にそろう）
  var speedNow = 0; // 自動再生の現在の速さ（px/ミリ秒）
  var velocity = 0; // 指を離した後・キー操作時の慣性（px/ミリ秒）
  var inView = false;
  var started = false;
  var hovering = false;
  var focused = false;
  var userPaused = false;
  var drag = null;
  var resumeAt = 0;
  var lastTime = 0;
  var rafId = 0;
  var lastWidth = 0;
  var toggle = null;

  function targetSpeed() {
    return window.innerWidth >= 768 ? 0.048 : 0.036; // PC 48px/秒、スマホ 36px/秒
  }

  function wrap(value) {
    if (period <= 0) return value;
    var offset = (value - low) % period;
    if (offset < 0) offset += period;
    return low + offset;
  }

  function apply() {
    track.style.transform = "translate3d(" + (-pos).toFixed(2) + "px,0,0)";
  }

  function addCloneSet() {
    for (var i = 0; i < originals.length; i++) {
      var clone = originals[i].cloneNode(true);
      clone.classList.add("is-clone");
      clone.setAttribute("aria-hidden", "true");
      clone.setAttribute("inert", "");
      var img = clone.querySelector("img");
      if (img) {
        img.loading = "eager";
        img.alt = "";
      }
      track.appendChild(clone);
    }
  }

  // 複製の数と1周分の幅を測り直す（画面幅が変わったときも呼ぶ）
  function measure() {
    var ratio = period > 0 ? (pos - low) / period : 0;
    var old = track.querySelectorAll(".is-clone");
    for (var i = 0; i < old.length; i++) track.removeChild(old[i]);
    // カード幅を整数のpxにそろえる（端数があると、1周ずれた位置で写真の位置が1px未満ずれ、継ぎ目が見えるため）
    track.style.removeProperty("--hw-card-w");
    track.style.setProperty("--hw-card-w", Math.round(originals[0].getBoundingClientRect().width) + "px");
    addCloneSet();
    period = Math.round(track.children[originals.length].getBoundingClientRect().left - originals[0].getBoundingClientRect().left);
    if (!(period > 0)) return false;
    // 見えている範囲の右端が、常に並べた帯の中に収まる数だけ複製する
    var sets = 2 + Math.ceil(scroller.clientWidth / period);
    for (var s = 2; s < sets; s++) addCloneSet();
    var lead = head.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
    low = Math.max(0, period - lead);
    pos = wrap(low + ratio * period);
    lastWidth = scroller.clientWidth;
    apply();
    return true;
  }

  function isRunning(now) {
    return inView && !document.hidden && !hovering && !focused && !drag && !userPaused &&
      !reduceMotion.matches && now >= resumeAt;
  }

  function frame(now) {
    rafId = 0;
    var dt = lastTime ? Math.min(now - lastTime, 50) : 16;
    lastTime = now;
    var moved = false;

    if (drag) {
      speedNow = 0;
    } else if (Math.abs(velocity) > 0.01) {
      pos += velocity * dt;
      velocity *= Math.exp(-dt / FRICTION);
      speedNow = 0;
      moved = true;
    } else {
      velocity = 0;
      var target = isRunning(now) ? targetSpeed() : 0;
      speedNow += (target - speedNow) * (1 - Math.exp(-dt / EASE));
      if (speedNow < 0.002 && target === 0) speedNow = 0; // 2px/秒未満になったら完全に止める
      if (speedNow > 0) {
        pos += speedNow * dt;
        moved = true;
      }
    }

    if (moved) {
      pos = wrap(pos);
      apply();
    }
    schedule();
  }

  function schedule() {
    if (inView && !document.hidden) {
      if (!rafId) rafId = requestAnimationFrame(frame);
    } else {
      lastTime = 0;
    }
  }

  function pauseAfterInteraction() {
    resumeAt = performance.now() + RESUME_DELAY;
  }

  // --- 指・マウスでの横ドラッグ ---
  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, start: pos, active: false, lastX: e.clientX, lastT: e.timeStamp, v: 0 };
    velocity = 0;
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x;
    var dy = e.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        // 縦方向の動き：ページの縦スクロールに任せる
        drag = null;
        return;
      }
      drag.active = true;
      section.classList.add("is-dragging");
      try {
        scroller.setPointerCapture(e.pointerId);
      } catch (err) {
        /* 取得できなくても操作は続ける */
      }
    }
    var dtm = e.timeStamp - drag.lastT;
    if (dtm > 0) drag.v = 0.8 * (-(e.clientX - drag.lastX) / dtm) + 0.2 * drag.v;
    drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
    pos = wrap(drag.start - dx);
    apply();
  }

  function onPointerEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.active) {
      velocity = e.timeStamp - drag.lastT < 100 ? Math.max(-2.5, Math.min(2.5, drag.v)) : 0;
      pauseAfterInteraction();
    }
    drag = null;
    section.classList.remove("is-dragging");
    schedule();
  }

  function onWheel(e) {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // 縦のホイールはページのスクロールに任せる
    e.preventDefault();
    velocity = 0;
    pos = wrap(pos + e.deltaX * (e.deltaMode === 1 ? 16 : 1));
    apply();
    pauseAfterInteraction();
  }

  function onKeyDown(e) {
    var dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    var step = originals[1].offsetLeft - originals[0].offsetLeft;
    velocity = (dir * step) / FRICTION; // 慣性で約1枚分動く
    schedule();
  }

  function updateToggle() {
    toggle.classList.toggle("is-paused", userPaused);
    toggle.querySelector(".hw__toggle-text").textContent = userPaused ? "スライドを再生" : "スライドを一時停止";
  }

  function addToggle() {
    var more = section.querySelector(".hw__more");
    if (!more) return;
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "hw__toggle";
    toggle.innerHTML = '<span class="hw__toggle-icon" aria-hidden="true"></span><span class="hw__toggle-text"></span>';
    toggle.addEventListener("click", function () {
      userPaused = !userPaused;
      resumeAt = 0;
      updateToggle();
      schedule();
    });
    updateToggle();
    more.insertBefore(toggle, more.firstChild);
  }

  function start() {
    started = true;
    // 元の4枚も含め、帯の画像はこの時点で読み込む（同じURLなので複製分の通信は発生しない）
    for (var i = 0; i < originals.length; i++) {
      var img = originals[i].querySelector("img");
      if (img) img.loading = "eager";
    }
    section.classList.add("hw--loop");
    if (!measure()) {
      section.classList.remove("hw--loop");
      var clones = track.querySelectorAll(".is-clone");
      for (var c = 0; c < clones.length; c++) track.removeChild(clones[c]);
      return;
    }
    addToggle();

    scroller.addEventListener("pointerdown", onPointerDown);
    scroller.addEventListener("pointermove", onPointerMove);
    scroller.addEventListener("pointerup", onPointerEnd);
    scroller.addEventListener("pointercancel", onPointerEnd);
    scroller.addEventListener("wheel", onWheel, { passive: false });
    scroller.addEventListener("keydown", onKeyDown);
    scroller.addEventListener("pointerenter", function (e) {
      if (e.pointerType === "mouse") hovering = true;
    });
    scroller.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse") hovering = false;
    });
    scroller.addEventListener("focus", function () {
      focused = true;
    });
    scroller.addEventListener("blur", function () {
      focused = false;
    });
    track.addEventListener("dragstart", function (e) {
      e.preventDefault();
    });
    document.addEventListener("visibilitychange", schedule);

    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (scroller.clientWidth !== lastWidth) measure(); // 高さだけの変化（アドレスバーの出入り）では作り直さない
      }, 150);
    });
  }

  var observer = new IntersectionObserver(function (entries) {
    inView = entries[entries.length - 1].isIntersecting;
    if (inView && !started) start();
    schedule();
  }, { rootMargin: "200px 0px" });
  observer.observe(section);
})();
