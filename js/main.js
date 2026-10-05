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
   * WORKS（施工事例の横スライド）
   * 横スクロール自体はCSS（scroll-snap）で動くため、ここでは
   * 左右ボタン・表示中の番号・端でのボタン無効化だけを扱う。
   * カード（.works-card）を増やしても、この処理の変更は不要。
   * ------------------------------------------------------------------ */
  var worksTrack = document.getElementById("works-track");
  if (worksTrack) {
    var worksSection = worksTrack.closest(".works");
    var worksCards = worksTrack.querySelectorAll(".works-card");
    var worksPrev = worksSection.querySelector(".works__nav--prev");
    var worksNext = worksSection.querySelector(".works__nav--next");
    var worksCurrent = worksSection.querySelector(".works__count-current");
    var worksTotal = worksSection.querySelector(".works__count-total");

    function pad2(n) {
      return n < 10 ? "0" + n : String(n);
    }

    function worksStep() {
      if (worksCards.length < 2) return worksTrack.clientWidth;
      return worksCards[1].offsetLeft - worksCards[0].offsetLeft;
    }

    function updateWorks() {
      var maxScroll = worksTrack.scrollWidth - worksTrack.clientWidth;
      var step = worksStep();
      // 番号は「左端に表示中のカード」。右端まで送ったときは、
      // 画面内に並ぶ枚数（PC約3枚・スマホ1枚）を考慮して最後の位置に合わせる
      var visibleCount = Math.max(1, Math.round(worksTrack.clientWidth / step));
      var index = Math.round(worksTrack.scrollLeft / step);
      if (worksTrack.scrollLeft >= maxScroll - 2) index = worksCards.length - visibleCount;
      index = Math.max(0, Math.min(worksCards.length - 1, index));
      if (worksCurrent) worksCurrent.textContent = pad2(index + 1);
      if (worksPrev) worksPrev.disabled = worksTrack.scrollLeft <= 2;
      if (worksNext) worksNext.disabled = worksTrack.scrollLeft >= maxScroll - 2;
    }

    if (worksTotal) worksTotal.textContent = pad2(worksCards.length);

    if (worksPrev) {
      worksPrev.addEventListener("click", function () {
        worksTrack.scrollBy({ left: -worksStep(), behavior: "smooth" });
      });
    }
    if (worksNext) {
      worksNext.addEventListener("click", function () {
        worksTrack.scrollBy({ left: worksStep(), behavior: "smooth" });
      });
    }

    worksTrack.addEventListener("scroll", updateWorks, { passive: true });
    window.addEventListener("resize", updateWorks);
    updateWorks();
  }
})();
