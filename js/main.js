(function () {
  "use strict";

  /* ------------------------------------------------------------------
   * モバイルナビゲーション（ハンバーガーメニュー）
   * ------------------------------------------------------------------ */
  var toggle = document.getElementById("nav-toggle");
  var nav = document.getElementById("main-nav");
  var overlay = document.getElementById("nav-overlay");

  function closeNav() {
    if (!nav || !toggle || !overlay) return;
    nav.classList.remove("is-open");
    overlay.classList.remove("is-visible");
    overlay.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "メニューを開く");
    document.body.style.overflow = "";
  }

  function openNav() {
    if (!nav || !toggle || !overlay) return;
    nav.classList.add("is-open");
    overlay.hidden = false;
    // 次のフレームでtransitionを発火させる
    requestAnimationFrame(function () {
      overlay.classList.add("is-visible");
    });
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "メニューを閉じる");
    document.body.style.overflow = "hidden";
  }

  if (toggle && nav && overlay) {
    toggle.addEventListener("click", function () {
      var isOpen = toggle.getAttribute("aria-expanded") === "true";
      if (isOpen) {
        closeNav();
      } else {
        openNav();
      }
    });

    overlay.addEventListener("click", closeNav);

    nav.querySelectorAll(".nav-link, .btn--nav").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNav();
    });

    // デスクトップ幅にリサイズされたら状態をリセット
    var mq = window.matchMedia("(min-width: 1200px)");
    mq.addEventListener("change", function (e) {
      if (e.matches) closeNav();
    });
  }

  /* ------------------------------------------------------------------
   * ヘッダーの高さ分だけアンカーリンクのスクロール位置を補正
   * ------------------------------------------------------------------ */
  var header = document.getElementById("site-header");
  if (header && "CSS" in window && CSS.supports && CSS.supports("scroll-margin-top", "1px")) {
    var headerHeight = header.offsetHeight;
    document.querySelectorAll("main [id]").forEach(function (el) {
      el.style.scrollMarginTop = headerHeight + 16 + "px";
    });
  }

  /* ------------------------------------------------------------------
   * お問い合わせフォーム（Formspree 接続 / Ajax 送信）
   * エンドポイント: https://formspree.io/f/xaenobnw
   * ------------------------------------------------------------------ */
  var form = document.getElementById("contact-form");
  var note = document.getElementById("contact-form-note");

  if (form) {
    var submitBtn = form.querySelector(".contact-form__submit");
    var submitBtnDefaultText = submitBtn ? submitBtn.textContent : "";
    var isSubmitting = false;

    function setFieldError(id, message) {
      var errorEl = document.getElementById(id + "-error");
      if (errorEl) errorEl.textContent = message || "";
    }

    function clearErrors() {
      setFieldError("cf-name", "");
      setFieldError("cf-email", "");
      setFieldError("cf-privacy", "");
    }

    function hideNote() {
      if (!note) return;
      note.hidden = true;
      note.textContent = "";
      note.classList.remove("contact-form__note--success", "contact-form__note--error");
    }

    function showNote(message, isSuccess) {
      if (!note) return;
      note.textContent = message;
      note.hidden = false;
      note.classList.remove("contact-form__note--success", "contact-form__note--error");
      note.classList.add(isSuccess ? "contact-form__note--success" : "contact-form__note--error");
    }

    function validateForm() {
      var valid = true;
      var nameInput = document.getElementById("cf-name");
      var emailInput = document.getElementById("cf-email");
      var privacyInput = document.getElementById("cf-privacy");

      if (nameInput && !nameInput.value.trim()) {
        setFieldError("cf-name", "お名前を入力してください。");
        valid = false;
      }

      if (emailInput) {
        var emailValue = emailInput.value.trim();
        var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailValue) {
          setFieldError("cf-email", "メールアドレスを入力してください。");
          valid = false;
        } else if (!emailPattern.test(emailValue)) {
          setFieldError("cf-email", "メールアドレスの形式が正しくありません。");
          valid = false;
        }
      }

      if (privacyInput && !privacyInput.checked) {
        setFieldError("cf-privacy", "プライバシーポリシーへの同意が必要です。");
        valid = false;
      }

      return valid;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (isSubmitting) return;

      hideNote();
      clearErrors();

      if (!validateForm()) return;

      isSubmitting = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "送信中...";
      }

      fetch(form.action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
      })
        .then(function (response) {
          if (response.ok) {
            showNote(
              "お問い合わせありがとうございます。内容を確認のうえ、担当者よりご連絡いたします。",
              true
            );
            form.reset();
          } else {
            showNote("送信できませんでした。お手数ですが、時間をおいて再度お試しください。", false);
          }
        })
        .catch(function () {
          showNote("送信できませんでした。お手数ですが、時間をおいて再度お試しください。", false);
        })
        .finally(function () {
          isSubmitting = false;
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = submitBtnDefaultText;
          }
        });
    });
  }

  /* ------------------------------------------------------------------
   * WORKS（施工事例ギャラリーの横スライド・無限ループ）
   * 横スクロール自体はCSS（scroll-snap）で動く。ここでは
   *  1) HTML上のカード一式を前後に1セットずつ複製し（表示専用・読み上げ対象外）、
   *     「複製 / 本物 / 複製」の3セットを並べる
   *  2) スクロールが止まった時点で前後の複製セット側にいたら、
   *     見た目が同じ本物セットの位置へ瞬時に移す（1セット分だけずらすので画面は変わらない）
   *  3) 左右ボタンはカード1枚分ずつ送る（端でも無効化しない）
   * カード枚数はDOMから取得するため、.works-card を増やしてもこの処理の変更は不要。
   * ------------------------------------------------------------------ */
  var worksTrack = document.getElementById("works-track");
  if (worksTrack) {
    var worksSection = worksTrack.closest(".works");
    var worksPrev = worksSection.querySelector(".works__nav--prev");
    var worksNext = worksSection.querySelector(".works__nav--next");
    var worksOriginals = Array.prototype.slice.call(worksTrack.querySelectorAll(".works-card"));
    var worksCount = worksOriginals.length;
    var worksLoop = worksCount >= 2;

    function makeWorksClone(card) {
      var clone = card.cloneNode(true);
      clone.setAttribute("aria-hidden", "true");
      clone.setAttribute("inert", "");
      clone.classList.add("works-card--clone");
      clone.removeAttribute("data-case");
      Array.prototype.forEach.call(clone.querySelectorAll("img"), function (img) {
        img.setAttribute("alt", "");
      });
      return clone;
    }

    if (worksLoop) {
      var worksBefore = document.createDocumentFragment();
      var worksAfter = document.createDocumentFragment();
      worksOriginals.forEach(function (card) {
        worksBefore.appendChild(makeWorksClone(card));
        worksAfter.appendChild(makeWorksClone(card));
      });
      worksTrack.insertBefore(worksBefore, worksOriginals[0]);
      worksTrack.appendChild(worksAfter);
    }

    // カード左端のスクロール位置（scroll-padding 分を差し引いた、スナップ位置と同じ基準）
    function worksPos(card) {
      var padding = parseFloat(getComputedStyle(worksTrack).scrollPaddingLeft) || 0;
      return (
        card.getBoundingClientRect().left -
        worksTrack.getBoundingClientRect().left +
        worksTrack.scrollLeft -
        padding
      );
    }

    function worksStep() {
      var cards = worksTrack.querySelectorAll(".works-card");
      if (cards.length < 2) return worksTrack.clientWidth;
      return worksPos(cards[1]) - worksPos(cards[0]);
    }

    function worksSetWidth() {
      return worksStep() * worksCount;
    }

    // 前後の複製セットにいる場合、1セット分ずらして本物セットへ戻す（瞬時・見た目は同じ）
    function normalizeWorks() {
      if (!worksLoop) return;
      var start = worksPos(worksOriginals[0]);
      var setWidth = worksSetWidth();
      var x = worksTrack.scrollLeft;
      if (x < start - worksStep() / 2) {
        worksTrack.scrollLeft = x + setWidth;
      } else if (x >= start + setWidth - worksStep() / 2) {
        worksTrack.scrollLeft = x - setWidth;
      }
    }

    function moveWorks(direction) {
      normalizeWorks();
      worksTrack.scrollBy({ left: direction * worksStep(), behavior: "smooth" });
    }

    if (worksPrev) {
      worksPrev.addEventListener("click", function () {
        moveWorks(-1);
      });
    }
    if (worksNext) {
      worksNext.addEventListener("click", function () {
        moveWorks(1);
      });
    }

    // スクロールが止まったら位置を整える（scrollend 未対応ブラウザは一定時間の停止で判定）
    var worksIdleTimer = null;
    worksTrack.addEventListener(
      "scroll",
      function () {
        clearTimeout(worksIdleTimer);
        worksIdleTimer = setTimeout(normalizeWorks, 160);
      },
      { passive: true }
    );
    if ("onscrollend" in window) {
      worksTrack.addEventListener("scrollend", function () {
        clearTimeout(worksIdleTimer);
        normalizeWorks();
      });
    }

    // 初期表示・画面幅変更時は、本物セットの1枚目を左端に合わせる
    function resetWorks() {
      if (!worksLoop) return;
      worksTrack.scrollLeft = worksPos(worksOriginals[0]);
    }
    resetWorks();
    var worksResizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(worksResizeTimer);
      worksResizeTimer = setTimeout(normalizeWorks, 160);
    });
  }
})();
